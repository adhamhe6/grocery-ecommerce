"""Client IP resolution that cannot be spoofed by a request header.

`X-Forwarded-For` is only meaningful for the hops *we* operate. `TRUSTED_PROXY_COUNT` is the number of reverse proxies
between the internet and this process that each append the address they received the request from (the storefront's
`/api` proxy counts as one; a TLS terminator or load balancer in front of it adds another). With the default of 0 the
socket address is used and the header is ignored entirely, so a caller cannot choose their own throttle key, lockout key
or the address written to the audit log.
"""

from __future__ import annotations

from django.conf import settings


def client_ip(request) -> str | None:
    if request is None:
        return None
    remote = request.META.get("REMOTE_ADDR") or None
    trusted = int(getattr(settings, "TRUSTED_PROXY_COUNT", 0) or 0)
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if trusted <= 0 or not forwarded:
        return remote
    hops = [h.strip() for h in forwarded.split(",") if h.strip()]
    if not hops:
        return remote
    return hops[-min(trusted, len(hops))]
