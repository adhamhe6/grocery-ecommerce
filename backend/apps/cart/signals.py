import logging

from django.contrib.auth.signals import user_logged_in
from django.core.exceptions import ValidationError as DjangoValidationError
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(user_logged_in)
def merge_guest_cart(sender, request, user, **kwargs):
    """Fold the visitor's guest basket (identified by cookie) into their account basket at sign-in/registration."""
    from .models import Cart, CartStatus
    from .services import CART_COOKIE, merge_into_user_cart

    if request is None or not user.pk:
        return
    token = request.COOKIES.get(CART_COOKIE)
    if not token:
        return
    try:
        guest = Cart.objects.filter(token=token, user__isnull=True, status=CartStatus.ACTIVE).first()
    except (ValueError, TypeError, DjangoValidationError):
        return
    if guest is not None:
        merge_into_user_cart(guest, user)
        logger.info("guest_cart_merged", extra={"user_id": user.pk, "lines": guest.items.count()})
