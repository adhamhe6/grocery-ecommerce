from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import env, env_bool, env_int

DEBUG = False
if not SECRET_KEY or SECRET_KEY.startswith("dev-only") or len(SECRET_KEY) < 40:  # noqa: F405
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set to a strong random value (>= 40 chars) in production")
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:  # noqa: F405
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list explicit hosts in production")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = env_bool(
    "USE_X_FORWARDED_HOST", True
)  # the storefront proxies /api, so the public host arrives forwarded
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
# Secure by default. Only a local, plain-HTTP trial of the production stack (docker compose on localhost) turns these off.
SECURE_COOKIES = env_bool("SECURE_COOKIES", True)
SESSION_COOKIE_SECURE = SECURE_COOKIES
CSRF_COOKIE_SECURE = SECURE_COOKIES
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

# The demo payment adapter must be enabled explicitly, never by accident.
if env("PAYMENT_PROVIDER", "demo") == "demo" and not PAYMENTS_ALLOW_DEMO:  # noqa: F405
    PAYMENT_PROVIDER = "unconfigured"
