"""Production error responses are safe: no stack traces, SQL, or internal messages; always a request id to quote."""

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_unexpected_exceptions_return_a_generic_envelope_without_internals(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("secret-internal-detail: SELECT * FROM accounts_user WHERE password='hunter2'")

    monkeypatch.setattr("apps.catalog.views.ProductQuery.listing", boom)
    client = APIClient(raise_request_exception=False)
    response = client.get("/api/v1/products/")
    assert response.status_code == 500
    body = response.content.decode()
    assert "secret-internal-detail" not in body and "hunter2" not in body and "Traceback" not in body
    error = response.json()["error"]
    assert error["code"] == "INTERNAL_ERROR"
    assert error["request_id"] and response["X-Request-ID"] == error["request_id"]


def test_unknown_api_paths_and_methods_do_not_leak_framework_pages():
    client = APIClient()
    assert client.get("/api/v1/definitely-not-a-route/").status_code == 404
    response = client.delete("/api/v1/products/")
    assert response.status_code in (401, 403, 405)
    assert "Django" not in response.content.decode()  # no debug/technical 404 or 405 page


def test_sql_metacharacters_in_search_are_just_text(api, product_factory, branch):
    product_factory(sku="SQL1", name="Plain oats")
    for nasty in ("'; DROP TABLE catalog_product; --", "oats' OR '1'='1", "\\", "%", "a" * 600, "(((", "!!&|:*"):
        response = api.get("/api/v1/products/", {"q": nasty})
        assert response.status_code in (200, 400), (nasty, response.status_code, response.content[:200])
    assert api.get("/api/v1/products/", {"q": "oats"}).json()["count"] == 1  # the table is intact and search works
