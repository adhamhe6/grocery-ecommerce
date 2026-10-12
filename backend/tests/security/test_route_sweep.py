"""Access control, proven for every route rather than a sample.

The sweep enumerates the real URL configuration (via the OpenAPI endpoint enumerator, so a new route is covered
automatically) and asserts that no staff endpoint answers an anonymous visitor or a customer — whatever the method.
"""

from __future__ import annotations

import re

import pytest
from drf_spectacular.generators import EndpointEnumerator
from rest_framework.test import APIClient

from tests.conftest import make_user

pytestmark = pytest.mark.django_db

PARAM = re.compile(r"\{[^}]+\}")


def _endpoints():
    seen = set()
    for path, _regex, method, _cb in EndpointEnumerator().get_api_endpoints():
        if method in {"OPTIONS", "HEAD"}:
            continue
        concrete = PARAM.sub("1", path)
        if (concrete, method) not in seen:
            seen.add((concrete, method))
            yield concrete, method


ADMIN = sorted((p, m) for p, m in _endpoints() if p.startswith("/api/v1/admin/"))
ACCOUNT_ONLY = [
    ("/api/v1/account/me/", "GET"),
    ("/api/v1/account/password/", "POST"),
    ("/api/v1/addresses/", "GET"),
    ("/api/v1/addresses/", "POST"),
    ("/api/v1/orders/", "GET"),
    ("/api/v1/lists/", "GET"),
    ("/api/v1/favorites/", "GET"),
    ("/api/v1/account/comparison/", "GET"),
]


def _call(client, path, method):
    kwargs = {"format": "json"} if method in {"POST", "PUT", "PATCH", "DELETE"} else {}
    data = {} if kwargs else None
    return getattr(client, method.lower())(path, data, **kwargs) if kwargs else getattr(client, method.lower())(path)


def test_the_sweep_actually_found_the_staff_api():
    # Guards against the enumerator silently returning nothing (which would make every test below vacuous).
    paths = {p for p, _ in ADMIN}
    assert len(ADMIN) > 120
    for expected in (
        "/api/v1/admin/orders/",
        "/api/v1/admin/products/",
        "/api/v1/admin/inventory/adjust/",
        "/api/v1/admin/audit/",
        "/api/v1/admin/settings/",
    ):
        assert expected in paths


@pytest.mark.parametrize(("path", "method"), ADMIN, ids=[f"{m} {p}" for p, m in ADMIN])
def test_staff_endpoints_refuse_anonymous_visitors(path, method):
    response = _call(APIClient(), path, method)
    assert response.status_code in (401, 403), (
        f"{method} {path} answered {response.status_code} to an anonymous visitor"
    )


@pytest.mark.parametrize(("path", "method"), ADMIN, ids=[f"{m} {p}" for p, m in ADMIN])
def test_staff_endpoints_refuse_customers(path, method):
    customer = make_user(email="customer-sweep@example.com")
    client = APIClient()
    client.force_authenticate(customer)
    response = _call(client, path, method)
    assert response.status_code == 403, f"{method} {path} answered {response.status_code} to a customer"


@pytest.mark.parametrize(("path", "method"), ACCOUNT_ONLY, ids=[f"{m} {p}" for p, m in ACCOUNT_ONLY])
def test_personal_endpoints_need_a_session(path, method):
    response = _call(APIClient(), path, method)
    assert response.status_code in (401, 403)
