from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.catalog.models import Brand, Category, Product, SaleUnit
from apps.core import rbac
from apps.core.models import StoreSettings
from apps.stores.models import Branch, BranchHours, DeliveryZone


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def settings_obj(db):
    obj = StoreSettings.load()
    return obj


@pytest.fixture
def api():
    return APIClient(enforce_csrf_checks=False)


@pytest.fixture
def csrf_api():
    """Client that enforces CSRF like a real browser would."""
    return APIClient(enforce_csrf_checks=True)


def make_user(email="shopper@example.com", password="Orchard-Row-9!x", role=rbac.CUSTOMER, **extra):
    from apps.accounts.models import User

    return User.objects.create_user(
        email=email, password=password, full_name=extra.pop("full_name", "Test Shopper"), role=role, **extra
    )


@pytest.fixture
def user(db):
    return make_user()


@pytest.fixture
def other_user(db):
    return make_user(email="other@example.com", full_name="Other Shopper")


@pytest.fixture
def auth_api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def branch(db):
    b = Branch.objects.create(
        code="central",
        name="Central",
        slug="central",
        address_line1="1 Market Lane",
        city="Riverton",
        postal_code="RW1 1AA",
        is_default=True,
        prep_minutes=60,
    )
    for wd in range(7):
        BranchHours.objects.create(branch=b, weekday=wd, opens=dt.time(7, 0), closes=dt.time(22, 0))
    return b


@pytest.fixture
def second_branch(db):
    b = Branch.objects.create(
        code="north", name="North", slug="north", address_line1="9 North St", city="Riverton", postal_code="RW9 9ZZ"
    )
    for wd in range(7):
        BranchHours.objects.create(branch=b, weekday=wd, opens=dt.time(8, 0), closes=dt.time(20, 0))
    return b


@pytest.fixture
def zone(branch):
    return DeliveryZone.objects.create(
        branch=branch,
        name="Inner",
        postcode_prefixes=["RW1", "RW2"],
        areas=["old town"],
        delivery_fee=Decimal("4.00"),
        free_delivery_threshold=Decimal("60.00"),
        min_order_value=Decimal("15.00"),
    )


@pytest.fixture
def units(db):
    return {u.code: u for u in SaleUnit.objects.all()}


@pytest.fixture
def category(db):
    parent = Category.objects.create(name="Fresh produce", slug="fresh-produce")
    return Category.objects.create(name="Fruit", slug="fruit", parent=parent)


@pytest.fixture
def brand(db):
    return Brand.objects.create(name="Test Farm", slug="test-farm")


def make_product(category, units, *, sku, name, price="2.00", unit="each", **kw):
    defaults = dict(
        slug=sku.lower(),
        sku=sku,
        name=name,
        category=category,
        sale_unit=units[unit],
        price=Decimal(price),
    )
    defaults.update(kw)
    return Product.objects.create(**defaults)


@pytest.fixture
def product_factory(category, units):
    def factory(**kw):
        sku = kw.pop("sku", f"SKU{Product.objects.count() + 1:04d}")
        return make_product(kw.pop("category", category), units, sku=sku, name=kw.pop("name", f"Product {sku}"), **kw)

    return factory
