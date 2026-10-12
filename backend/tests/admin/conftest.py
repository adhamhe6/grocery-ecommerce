import itertools

import pytest
from rest_framework.test import APIClient

from tests.conftest import make_user

_counter = itertools.count(1)


@pytest.fixture
def staff():
    """staff(role, branches=(...), all_branches=False) -> APIClient authenticated as a fresh staff user."""

    def _make(role="ADMIN", branches=(), **kw):
        user = make_user(email=f"{role.lower()}{next(_counter)}@staff.example.com", role=role, **kw)
        if branches:
            user.branches.set(branches)
        client = APIClient()
        client.force_authenticate(user)
        client.user = user
        return client

    return _make


@pytest.fixture
def admin(staff):
    return staff("ADMIN")


def results(res):
    body = res.json()
    return body["results"] if isinstance(body, dict) and "results" in body else body
