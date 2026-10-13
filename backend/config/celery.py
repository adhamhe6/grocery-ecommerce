import os

from celery import Celery
from celery.signals import task_prerun

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
app = Celery("orchardrow")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@task_prerun.connect
def _activate_store_timezone(**_kwargs):
    """Workers have no request, so activate the store's timezone for each task (see StoreTimezoneMiddleware)."""
    from apps.core.middleware import activate_store_tz

    activate_store_tz()
