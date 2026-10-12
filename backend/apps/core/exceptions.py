"""Single error contract for the API.

Every error response has the shape::

    {"error": {"code": "INSUFFICIENT_STOCK", "message": "...", "details": {...}, "request_id": "..."}}
"""

from __future__ import annotations

import logging

from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework import exceptions as drf_exc
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .logging import get_request_id

logger = logging.getLogger(__name__)


class ErrorCode:
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    PRODUCT_UNAVAILABLE = "PRODUCT_UNAVAILABLE"
    INSUFFICIENT_STOCK = "INSUFFICIENT_STOCK"
    INVALID_QUANTITY = "INVALID_QUANTITY"
    INVALID_COUPON = "INVALID_COUPON"
    ADDRESS_NOT_SERVICEABLE = "ADDRESS_NOT_SERVICEABLE"
    DELIVERY_SLOT_UNAVAILABLE = "DELIVERY_SLOT_UNAVAILABLE"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    INVALID_ORDER_TRANSITION = "INVALID_ORDER_TRANSITION"
    SUBSTITUTION_REQUIRES_APPROVAL = "SUBSTITUTION_REQUIRES_APPROVAL"
    SUBSTITUTION_NOT_ALLOWED = "SUBSTITUTION_NOT_ALLOWED"
    WEIGHT_OUT_OF_TOLERANCE = "WEIGHT_OUT_OF_TOLERANCE"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    IDEMPOTENCY_KEY_REQUIRED = "IDEMPOTENCY_KEY_REQUIRED"
    CART_EMPTY = "CART_EMPTY"
    CART_CHANGED = "CART_CHANGED"
    MIN_ORDER_NOT_MET = "MIN_ORDER_NOT_MET"
    BRANCH_CLOSED = "BRANCH_CLOSED"
    INVALID_STATE = "INVALID_STATE"
    DUPLICATE_RECEIPT = "DUPLICATE_RECEIPT"
    REFUND_NOT_ALLOWED = "REFUND_NOT_ALLOWED"
    PAYMENT_PROVIDER_UNAVAILABLE = "PAYMENT_PROVIDER_UNAVAILABLE"
    INVALID_WEBHOOK = "INVALID_WEBHOOK"
    BATCH_BLOCKED = "BATCH_BLOCKED"


class DomainError(Exception):
    """A business-rule violation that should be shown to the caller."""

    def __init__(self, code: str, message: str, *, status_code: int = 400, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def _body(code: str, message: str, details=None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}, "request_id": get_request_id()}}


def _flatten_validation(detail):
    if isinstance(detail, dict):
        return {k: _flatten_validation(v) for k, v in detail.items()}
    if isinstance(detail, list):
        return [_flatten_validation(v) for v in detail]
    return str(detail)


def api_exception_handler(exc, context):
    if isinstance(exc, DomainError):
        return Response(_body(exc.code, exc.message, exc.details), status=exc.status_code)
    if isinstance(exc, Http404):
        return Response(_body(ErrorCode.NOT_FOUND, "The requested resource was not found."), status=404)
    if isinstance(exc, PermissionDenied):
        return Response(_body(ErrorCode.FORBIDDEN, "You do not have permission to perform this action."), status=403)

    response = exception_handler(exc, context)
    if response is None:
        logger.exception("unhandled_api_exception", extra={"path": getattr(context.get("request"), "path", "")})
        return Response(
            _body(ErrorCode.INTERNAL_ERROR, "Something went wrong on our side. Please try again."),
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if isinstance(exc, drf_exc.ValidationError):
        response.data = _body(
            ErrorCode.VALIDATION_ERROR, "Please correct the highlighted fields.", _flatten_validation(exc.detail)
        )
    elif isinstance(exc, (drf_exc.NotAuthenticated, drf_exc.AuthenticationFailed)):
        response.status_code = 401
        response.data = _body(ErrorCode.NOT_AUTHENTICATED, "Please sign in to continue.")
    elif isinstance(exc, drf_exc.PermissionDenied):
        response.data = _body(
            ErrorCode.FORBIDDEN, str(exc.detail) if exc.detail else "You do not have permission to perform this action."
        )
    elif isinstance(exc, drf_exc.NotFound):
        response.data = _body(ErrorCode.NOT_FOUND, "The requested resource was not found.")
    elif isinstance(exc, drf_exc.Throttled):
        wait = int(exc.wait) if exc.wait else None
        response.data = _body(
            ErrorCode.RATE_LIMITED, "Too many requests. Please wait a moment and try again.", {"retry_after": wait}
        )
    else:
        response.data = _body(getattr(exc, "default_code", "ERROR").upper(), str(getattr(exc, "detail", exc)))
    return response
