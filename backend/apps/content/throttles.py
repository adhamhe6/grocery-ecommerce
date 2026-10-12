"""Throttles for the public write endpoints.

`ScopedRateThrottle` refuses to run when a scope has no configured rate; these fall back to a safe default so a
missing `THROTTLE_*` setting can never leave a public form unthrottled (or crash it).
"""

from django.core.exceptions import ImproperlyConfigured
from rest_framework.throttling import ScopedRateThrottle

DEFAULT_RATES = {"newsletter": "10/hour", "contact": "5/hour"}


class PublicFormThrottle(ScopedRateThrottle):
    def get_rate(self):
        try:
            return super().get_rate()
        except ImproperlyConfigured:
            return DEFAULT_RATES[self.scope]
