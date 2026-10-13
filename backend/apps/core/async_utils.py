"""Queueing that can never break the request that triggered it.

Celery's broker is a separate, optional-at-runtime dependency. Enqueueing happens *after* the database work has
committed, so a broker outage must degrade to "the side effect is retried later" and never to a 500 for an order
that already exists (or, for password reset, to a response that reveals whether an account exists).
"""

from __future__ import annotations

import logging

from django.db import transaction

logger = logging.getLogger(__name__)


def safe_delay(task, *args, **kwargs) -> bool:
    """`task.delay(...)`, returning False (and logging) instead of raising when the broker is unreachable."""
    try:
        task.delay(*args, **kwargs)
        return True
    except Exception:  # noqa: BLE001 - kombu/redis raise a wide range of connection errors
        logger.exception("task_enqueue_failed", extra={"task": getattr(task, "name", str(task))})
        return False


def enqueue_after_commit(task, *args, **kwargs) -> None:
    """Run `safe_delay` once the surrounding transaction commits (immediately when there is none)."""
    transaction.on_commit(lambda: safe_delay(task, *args, **kwargs))
