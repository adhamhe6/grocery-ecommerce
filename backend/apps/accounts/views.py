from __future__ import annotations

import contextlib
import hashlib
import logging

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.async_utils import safe_delay
from apps.core.exceptions import DomainError

from .models import Address, User
from .serializers import (
    AddressSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
    _validate_password,
)
from .tasks import send_password_reset_email

logger = logging.getLogger(__name__)

MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 15 * 60


def _client_ip(request) -> str:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR", "")) or "unknown"


def _email_fingerprint(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()[:12]


class CsrfView(APIView):
    """Sets the `csrftoken` cookie. The SPA echoes it back in `X-CSRFToken`."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class SessionView(APIView):
    """Who am I? Always 200: `{"user": null}` for a visitor, so the storefront can ask on every page load without
    producing a failing request (and a console error) for the vast majority of visitors. Also sets the CSRF cookie."""

    permission_classes = [AllowAny]

    @method_decorator(ensure_csrf_cookie)
    @extend_schema(responses={200: dict})
    def get(self, request):
        user = request.user if request.user.is_authenticated else None
        return Response({"user": UserSerializer(user).data if user else None})


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    @extend_schema(request=RegisterSerializer, responses=UserSerializer)
    def post(self, request):
        ser = RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = ser.save()
        login(request._request, user, backend="django.contrib.auth.backends.ModelBackend")
        logger.info("user_registered", extra={"user_id": user.pk})
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=LoginSerializer, responses=UserSerializer)
    def post(self, request):
        ser = LoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        email = ser.validated_data["email"].strip().lower()
        lock_key = f"loginfail:{_email_fingerprint(email)}:{_client_ip(request)}"
        if (cache.get(lock_key) or 0) >= MAX_FAILED_LOGINS:
            raise DomainError(
                "RATE_LIMITED",
                "Too many failed sign-in attempts. Please wait 15 minutes or reset your password.",
                status_code=429,
            )
        user = authenticate(request._request, username=email, password=ser.validated_data["password"])
        if user is None or not user.is_active:
            with contextlib.suppress(Exception):  # a cache outage must not turn a failed login into a 500
                cache.set(lock_key, (cache.get(lock_key) or 0) + 1, LOCKOUT_SECONDS)
            logger.warning("auth_failed", extra={"email_fp": _email_fingerprint(email), "ip": _client_ip(request)})
            raise DomainError(
                "INVALID_CREDENTIALS", "That email and password don't match. Please try again.", status_code=401
            )
        cache.delete(lock_key)
        login(request._request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request._request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=UserSerializer)
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    @extend_schema(request=ProfileUpdateSerializer, responses=UserSerializer)
    def patch(self, request):
        ser = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(UserSerializer(request.user).data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=PasswordChangeSerializer, responses={204: None})
    def post(self, request):
        ser = PasswordChangeSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        request.user.set_password(ser.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        update_session_auth_hash(request._request, request.user)  # keep this session, invalidate others
        logger.info("password_changed", extra={"user_id": request.user.pk})
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    @extend_schema(request=PasswordResetRequestSerializer, responses={202: None})
    def post(self, request):
        ser = PasswordResetRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=ser.validated_data["email"], is_active=True).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            # A queue outage must not change the response: a 500 only for real accounts would reveal which exist.
            safe_delay(send_password_reset_email, user.email, uid, default_token_generator.make_token(user))
        # Same response whether or not the account exists: no account enumeration through this endpoint.
        return Response(
            {"detail": "If an account exists for that email, a reset link is on its way."},
            status=status.HTTP_202_ACCEPTED,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    @extend_schema(request=PasswordResetConfirmSerializer, responses={204: None})
    def post(self, request):
        ser = PasswordResetConfirmSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        invalid = DomainError(
            "INVALID_RESET_LINK",
            "This reset link is invalid or has expired. Please request a new one.",
            status_code=400,
        )
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(ser.validated_data["uid"])), is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            raise invalid from None
        if not default_token_generator.check_token(user, ser.validated_data["token"]):
            raise invalid
        user.set_password(_validate_password(ser.validated_data["new_password"], user))
        user.save(update_fields=["password"])  # changing the hash also invalidates the token (single use)
        logger.info("password_reset_completed", extra={"user_id": user.pk})
        return Response(status=status.HTTP_204_NO_CONTENT)


class AddressViewSet(viewsets.ModelViewSet):
    serializer_class = AddressSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        # Ownership is enforced by the queryset: another customer's address is simply a 404.
        return Address.objects.filter(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="make-default")
    def make_default(self, request, pk=None):
        address = self.get_object()
        request.user.addresses.exclude(pk=address.pk).filter(is_default=True).update(is_default=False)
        address.is_default = True
        address.save(update_fields=["is_default", "updated_at"])
        return Response(self.get_serializer(address).data)
