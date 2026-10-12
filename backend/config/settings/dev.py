from .base import *  # noqa: F401,F403
from .base import env, env_bool

DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = env("DJANGO_SECRET_KEY") or "dev-only-insecure-secret-key-do-not-use-in-production"
ALLOWED_HOSTS = ["*"]
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_ALWAYS_EAGER", True)
PAYMENTS_ALLOW_DEMO = True
PAYMENT_WEBHOOK_SECRET = env("PAYMENT_WEBHOOK_SECRET") or "dev-only-webhook-secret"
