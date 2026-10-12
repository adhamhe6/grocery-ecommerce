"""Cache helpers that never let a cache failure break a request.

Namespaced versioning gives O(1) invalidation: keys embed the namespace version and `bump()` increments it.
Prices, stock, carts, orders and payments are never cached through these helpers.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from django.core.cache import cache

logger = logging.getLogger(__name__)


def _version(namespace: str) -> int:
    try:
        return int(cache.get(f"ver:{namespace}") or 1)
    except Exception:  # noqa: BLE001 - cache outage must not break requests
        return 1


def key(namespace: str, *parts: Any) -> str:
    return f"{namespace}:v{_version(namespace)}:" + ":".join(str(p) for p in parts)


def bump(namespace: str) -> None:
    try:
        cache.set(f"ver:{namespace}", _version(namespace) + 1, None)
    except Exception:  # noqa: BLE001
        logger.warning("cache_bump_failed", extra={"namespace": namespace})


def get_or_set(namespace: str, parts: tuple, ttl: int, factory: Callable[[], Any]) -> Any:
    cache_key = key(namespace, *parts)
    try:
        hit = cache.get(cache_key)
    except Exception:  # noqa: BLE001
        hit = None
    if hit is not None:
        return hit
    value = factory()
    try:
        cache.set(cache_key, value, ttl)
    except Exception:  # noqa: BLE001
        logger.warning("cache_set_failed", extra={"namespace": namespace})
    return value
