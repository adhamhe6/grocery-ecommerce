"""List endpoints must not run a query per row (the plan's "no N+1" rule): the query count may not grow with the data."""

from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.catalog.models import ProductImage, Review
from apps.content.models import Article, Banner, ContactMessage, NewsletterSubscriber
from apps.orders.models import SupportCase
from apps.payments.models import Payment
from apps.promotions.models import Coupon, Promotion
from tests.conftest import make_user

pytestmark = pytest.mark.django_db
D = Decimal
BASE = "/api/v1/admin/"


def queries_for(client, url):
    with CaptureQueriesContext(connection) as ctx:
        res = client.get(BASE + url)
    assert res.status_code == 200, res.content
    return len(ctx)


@pytest.fixture
def grow(product_factory, order_factory, branch, category, brand):
    """grow[name](n) adds n more rows of that kind, each with its related rows (images, products, orders…)."""
    counter = iter(range(10_000))

    def products(n):
        for _ in range(n):
            i = next(counter)
            p = product_factory(sku=f"QC{i}", name=f"Product {i}", brand=brand)
            ProductImage.objects.create(product=p, image=f"products/{i}.webp", alt_text="x")

    def promotions(n):
        items = [product_factory(sku=f"PQ{next(counter)}", name="p") for _ in range(2)]
        for _ in range(n):
            promo = Promotion.objects.create(name="P", label="10% off", kind="PERCENT_OFF", percent=D("10"))
            promo.products.add(*items)

    def coupons(n):
        for _ in range(n):
            Coupon.objects.create(code=f"QC{next(counter)}", kind="FIXED", value=D("1"))

    def articles(n):
        item = product_factory(sku=f"AQ{next(counter)}", name="a")
        for _ in range(n):
            a = Article.objects.create(slug=f"a-{next(counter)}", kind="RECIPE", title="t", summary="s", body="b")
            a.products.add(item)

    def banners(n):
        for _ in range(n):
            Banner.objects.create(title=f"b{next(counter)}")

    def reviews(n):
        item = product_factory(sku=f"RQ{next(counter)}", name="r")
        for _ in range(n):
            Review.objects.create(product=item, user=make_user(email=f"q{next(counter)}@example.com"), rating=4)

    def customers(n):
        item = product_factory(sku=f"CQ{next(counter)}", name="c")
        for _ in range(n):
            user = make_user(email=f"cust{next(counter)}@example.com")
            order_factory([(item, 1)], customer=user, status="COMPLETED", total=D("5"), final_total=D("5"))

    def staff(n):
        for _ in range(n):
            member = make_user(email=f"st{next(counter)}@staff.example.com", role="STORE_MANAGER")
            member.branches.set([branch])

    def cases(n):
        item = product_factory(sku=f"KQ{next(counter)}", name="k")
        for _ in range(n):
            order, items = order_factory([(item, 1)], status="COMPLETED", total=D("5"), final_total=D("5"))
            Payment.objects.create(
                order=order,
                provider="demo",
                method="CARD",
                state="CAPTURED",
                amount=D("5"),
                captured_amount=D("5"),
                currency="USD",
            )
            SupportCase.objects.create(order=order, order_item=items[item.id], kind="DAMAGED", description="x")

    def contact_messages(n):
        for _ in range(n):
            ContactMessage.objects.create(name="n", email="e@example.com", message="hello there")

    def newsletter(n):
        for _ in range(n):
            NewsletterSubscriber.objects.create(
                email=f"n{next(counter)}@example.com", token=f"t{next(counter)}", confirmed_at=timezone.now()
            )

    return {
        k: v for k, v in locals().items() if callable(v) and k not in ("product_factory", "order_factory", "make_user")
    }


CASES = [
    ("products", "products/", "products"),
    ("promotions", "promotions/", "promotions"),
    ("coupons", "coupons/", "coupons"),
    ("articles", "articles/", "articles"),
    ("banners", "banners/", "banners"),
    ("reviews", "reviews/", "reviews"),
    ("customers", "customers/", "customers"),
    ("staff", "staff/", "staff"),
    ("cases", "cases/", "cases"),
    ("contact-messages", "contact-messages/", "contact_messages"),
    ("newsletter", "newsletter/", "newsletter"),
]


@pytest.mark.parametrize(("name", "url", "kind"), CASES, ids=[c[0] for c in CASES])
def test_query_count_does_not_grow_with_the_number_of_rows(name, url, kind, admin, grow):
    grow[kind](2)
    admin.get(BASE + url)  # warm one-off caches (content types, settings…)
    few = queries_for(admin, url)
    grow[kind](12)
    many = queries_for(admin, url)
    assert many <= few, f"{name}: {few} queries for 2 rows but {many} for 14"


def test_category_and_brand_lists_are_constant_too(admin, category, brand, product_factory):
    from apps.catalog.models import Brand, Category

    admin.get(BASE + "categories/")
    few = queries_for(admin, "categories/") + queries_for(admin, "brands/")
    for n in range(10):
        c = Category.objects.create(name=f"C{n}", slug=f"c{n}", parent=category.parent)
        product_factory(sku=f"B{n}", name=f"B{n}", category=c)
        Brand.objects.create(name=f"Brand {n}", slug=f"brand-{n}")
    assert queries_for(admin, "categories/") + queries_for(admin, "brands/") <= few
