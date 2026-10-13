"""Database side of `manage.py seed_perf`: turns the plans from `generate.py` into rows, finalises derived data,
and can remove exactly the rows it created. Everything runs in ONE transaction, so a failed run leaves nothing behind.
"""

from __future__ import annotations

import datetime as dt
import time
import zoneinfo
from collections import Counter
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.contrib.postgres.search import SearchVector
from django.core.exceptions import FieldDoesNotExist
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Brand, Category, Product, ProductImage, SaleUnit
from apps.catalog.search import SEARCH_CONFIG
from apps.core import cache as core_cache
from apps.core import rbac
from apps.core.models import StoreSettings
from apps.inventory.models import Batch, StockLevel, StockMovement
from apps.orders.models import Order, OrderItem, OrderStatusHistory
from apps.payments.models import Payment, Refund
from apps.promotions.models import Promotion
from apps.stores.models import Branch

from . import generate as gen
from .safety import BRAND_SLUG_PREFIX, EMAIL_DOMAIN, MOVEMENT_REF, PROMO_NAME_PREFIX, RACE_SKU, SKU_PREFIX

PLACEHOLDER_IMAGE = "products/perf/placeholder.webp"
PLACEHOLDER_WIDTHS = [320, 640, 1024]
RACE_STOCK = Decimal("5.000")
OPEN_PAYMENT_EXCLUDED = ("CANCELLED", "PAYMENT_FAILED", "PENDING_PAYMENT")
ANALYZE_MODELS = (
    Brand,
    Product,
    ProductImage,
    StockLevel,
    Batch,
    StockMovement,
    User,
    Order,
    OrderItem,
    OrderStatusHistory,
    Payment,
    Refund,
    Promotion,
)


class SeedProblem(Exception):  # noqa: N818 - surfaced to the operator as a CommandError
    """A precondition failed (missing reference data, bad option). The message tells the operator what to do."""


@dataclass
class SeedOptions:
    products: int = 20000
    customers: int = 5000
    orders: int = 60000
    seed: int = 20260101
    anchor: dt.datetime | None = None  # "now" for every relative date; default: the current time
    days: int = 90
    batch_size: int = 2000
    image_path: str = ""
    history: bool = True
    movements: bool = True


@contextmanager
def explicit_timestamps(*models) -> Iterator[None]:
    """Let bulk_create store the `created_at`/`updated_at` values we set (Django would overwrite them with now())."""
    saved = []
    for model in models:
        for name in ("created_at", "updated_at"):
            try:
                field = model._meta.get_field(name)
            except FieldDoesNotExist:
                continue
            saved.append((field, field.auto_now, field.auto_now_add))
            field.auto_now = field.auto_now_add = False
    try:
        yield
    finally:
        for field, auto_now, auto_now_add in saved:
            field.auto_now, field.auto_now_add = auto_now, auto_now_add


@contextmanager
def relaxed_durability() -> Iterator[None]:
    """`synchronous_commit = off` for this session (a crash may lose the last commits, never corrupt data)."""
    with connection.cursor() as cur:
        cur.execute("SHOW synchronous_commit")
        previous = cur.fetchone()[0]
        cur.execute("SELECT set_config('synchronous_commit', 'off', false)")
    try:
        yield
    finally:
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('synchronous_commit', %s, false)", [previous])


def chunks(items: list, size: int) -> Iterator[list]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def existing_counts() -> dict[str, int]:
    return {
        "products": Product.objects.filter(sku__startswith=SKU_PREFIX).count(),
        "customers": User.objects.filter(email__endswith=f"@{EMAIL_DOMAIN}", role=rbac.CUSTOMER).count(),
        "orders": Order.objects.filter(contact_email__endswith=f"@{EMAIL_DOMAIN}").count(),
    }


# ----------------------------------------------------------------------------------------- reset
def reset_perf(log: Callable[[str], None] = lambda _msg: None) -> dict[str, int]:
    """Delete only rows this generator (or the checkout-race load scenario, same e-mail domain) created."""
    from django.db.models.signals import post_delete

    from apps.catalog.signals import product_deleted

    deleted: Counter[str] = Counter()
    perf_email = Q(contact_email__endswith=f"@{EMAIL_DOMAIN}")
    perf_orders = Order.objects.filter(perf_email)
    perf_products = Product.objects.filter(sku__startswith=SKU_PREFIX)

    def own(result: tuple[int, dict[str, int]], label: str) -> int:
        return result[1].get(label, 0)  # rows of the model itself, not rows removed by cascade

    with transaction.atomic(), relaxed_durability():
        log("reset: stock ledger")
        movements = StockMovement.objects.filter(Q(ref_type=MOVEMENT_REF) | Q(product__in=perf_products))
        deleted["stock movements"] = own(movements.delete(), "inventory.StockMovement")
        log("reset: refunds and payments")
        deleted["refunds"] = own(Refund.objects.filter(order__in=perf_orders).delete(), "payments.Refund")
        deleted["payments"] = own(Payment.objects.filter(order__in=perf_orders).delete(), "payments.Payment")
        log("reset: orders (items and history cascade)")
        ids = list(perf_orders.order_by("id").values_list("id", flat=True))
        for part in chunks(ids, 5000):
            deleted["orders"] += own(Order.objects.filter(id__in=part).delete(), "orders.Order")
        log("reset: batches, stock levels, images, products")
        deleted["batches"] = own(Batch.objects.filter(product__in=perf_products).delete(), "inventory.Batch")
        db = StockLevel.objects.db
        deleted["stock levels"] = StockLevel.objects.filter(product__in=perf_products)._raw_delete(db)
        deleted["product images"] = ProductImage.objects.filter(product__in=perf_products)._raw_delete(db)
        post_delete.disconnect(product_deleted, sender=Product)  # it would bump the cache once per product
        try:
            pids = list(perf_products.order_by("id").values_list("id", flat=True))
            for part in chunks(pids, 2000):
                deleted["products"] += own(Product.objects.filter(id__in=part).delete(), "catalog.Product")
        finally:
            post_delete.connect(product_deleted, sender=Product)
        brands = Brand.objects.filter(slug__startswith=BRAND_SLUG_PREFIX, is_demo=True).delete()
        deleted["brands"] = own(brands, "catalog.Brand")
        promos = Promotion.objects.filter(name__startswith=PROMO_NAME_PREFIX, is_demo=True).delete()
        deleted["promotions"] = own(promos, "promotions.Promotion")
        log("reset: customers")
        uids = list(
            User.objects.filter(email__endswith=f"@{EMAIL_DOMAIN}", role=rbac.CUSTOMER)
            .order_by("id")
            .values_list("id", flat=True)
        )
        for part in chunks(uids, 5000):
            deleted["customers"] += own(User.objects.filter(id__in=part).delete(), "accounts.User")
    core_cache.bump("catalog")
    core_cache.bump("home")
    return {k: v for k, v in deleted.items() if v}


# ----------------------------------------------------------------------------------------- seeding
class PerfSeeder:
    def __init__(self, opts: SeedOptions, log: Callable[[str], None] = lambda _msg: None):
        self.o = opts
        self.log = log
        self.anchor = (opts.anchor or timezone.now()).astimezone(dt.UTC).replace(microsecond=0)
        self.counts: Counter[str] = Counter()
        self.notes: list[str] = []
        self._t0 = time.monotonic()

    # -- plumbing --------------------------------------------------------------------------------------
    def phase(self, title: str) -> None:
        self.log(f"[{time.monotonic() - self._t0:7.1f}s] {title}")

    def run(self) -> dict:
        o = self.o
        if o.products < 1 or o.customers < 0 or o.orders < 0:
            raise SeedProblem("--products must be >= 1; --customers and --orders must be >= 0.")
        if o.orders and o.customers < 1:
            raise SeedProblem("--orders needs at least one customer (--customers >= 1).")
        started = time.monotonic()
        with (
            transaction.atomic(),
            relaxed_durability(),
            explicit_timestamps(
                Brand,
                Promotion,
                Product,
                ProductImage,
                StockLevel,
                Batch,
                StockMovement,
                User,
                Order,
                OrderItem,
                OrderStatusHistory,
                Payment,
                Refund,
            ),
        ):
            self._load_reference()
            self._brands_and_promotions()
            self._products()
            self._images()
            self._stock()
            self._customers()
            self._orders()
            self._finalise()
        self.phase("VACUUM (ANALYZE) on the touched tables")
        self._analyze()
        core_cache.bump("catalog")
        core_cache.bump("home")
        return {"counts": dict(self.counts), "notes": self.notes, "elapsed": time.monotonic() - started}

    # -- reference data -----------------------------------------------------------------------------------
    def _load_reference(self) -> None:
        self.phase("reading reference data (branches, categories, brands, units)")
        store = StoreSettings.load()
        self.store = gen.StoreRef(
            currency=store.currency,
            prices_include_tax=store.prices_include_tax,
            weight_tolerance_percent=store.weight_tolerance_percent,
            tz=store.timezone or "UTC",
        )
        self.tz = zoneinfo.ZoneInfo(self.store.tz)
        self.today = self.anchor.astimezone(self.tz).date()

        branches = list(Branch.objects.filter(is_active=True).prefetch_related("zones").order_by("-is_default", "id"))
        if not branches:
            raise SeedProblem(
                "No active branches. Run `python manage.py seed_demo --skip-images` in this database first."
            )
        if len(branches) < 2:
            self.notes.append("Only one active branch exists, so stock levels were created for one branch.")
        refs = []
        for b in branches:
            zones = tuple(
                gen.ZoneRef(
                    id=z.id,
                    prefix=(z.postcode_prefixes[0] if z.postcode_prefixes else "RW1"),
                    area=(z.areas[0].title() if z.areas else ""),
                    fee=z.delivery_fee,
                    free_threshold=z.free_delivery_threshold,
                )
                for z in sorted((z for z in b.zones.all() if z.is_active), key=lambda z: (z.priority, z.id))
            )
            refs.append(gen.BranchRef(b.id, b.code, b.name, b.is_default, zones))
        self.branches = refs
        self.branch_by_id = {b.id: b for b in refs}

        self.units = {u.code: u for u in SaleUnit.objects.all()}
        missing = [c for c in ("each", "pack", "box", "bundle", "dozen", "kg", "g", "ml", "l") if c not in self.units]
        if missing:
            raise SeedProblem(
                f"Sale units missing: {', '.join(missing)}. Run migrations, then seed_demo --skip-images."
            )

        cats = list(Category.objects.filter(is_active=True).select_related("parent").order_by("id"))
        parents = {c.parent_id for c in cats if c.parent_id}
        leaves = [c for c in cats if c.id not in parents and (c.parent_id is None or (c.parent and c.parent.is_active))]
        if not leaves:
            raise SeedProblem("No categories. Run `python manage.py seed_demo --skip-images` in this database first.")
        self.leaf_categories = leaves
        self.all_categories = cats

    def _brands_and_promotions(self) -> None:
        o, anchor = self.o, self.anchor
        self.phase("brands and promotions")
        existing_names = set(Brand.objects.values_list("name", flat=True))
        existing_slugs = set(Brand.objects.values_list("slug", flat=True))
        want = max(10, min(400, o.products // 150))
        names = gen.plan_brands(gen.make_rng(o.seed, "brands"), want)
        rows = []
        for name in names:
            slug = f"{BRAND_SLUG_PREFIX}{gen.slugify_ascii(name.removeprefix('Perf '))}"
            if name in existing_names or slug in existing_slugs:
                continue
            rows.append(
                Brand(
                    name=name,
                    slug=slug,
                    description="Synthetic brand for performance testing.",
                    is_demo=True,
                    created_at=anchor,
                    updated_at=anchor,
                )
            )
        Brand.objects.bulk_create(rows)
        self.counts["brands"] = len(rows)
        # all active brands take part: the demo brands are few, the perf brands add facet cardinality
        self.brands = [gen.BrandRef(b.id, b.name) for b in Brand.objects.filter(is_active=True).order_by("id")]

        # category-scoped promotions that are running now (demo ones + two of ours), so ~10% of products can sit on them
        rng = gen.make_rng(o.seed, "promotions")
        leaves = sorted(self.leaf_categories, key=lambda c: c.slug)
        perishable = [c for c in leaves if gen.words.spec_for(c.slug).perishable]
        dry = [c for c in leaves if not gen.words.spec_for(c.slug).perishable]
        picks = []
        if dry:
            picks.append(("PERF Pantry saver", rng.sample(dry, min(2, len(dry)))))
        if perishable:
            picks.append(("PERF Fresh deal", rng.sample(perishable, 1)))
        for name, cats in picks:
            if Promotion.objects.filter(name=name).exists():
                continue
            promo = Promotion.objects.create(
                name=name,
                label="15% off",
                kind="PERCENT_OFF",
                scope="CATEGORIES",
                percent=Decimal("15.00"),
                starts_at=anchor - dt.timedelta(days=1),
                ends_at=anchor + dt.timedelta(days=400),
                is_active=True,
                is_demo=True,
                created_at=anchor,
                updated_at=anchor,
            )
            promo.categories.set(cats)
            self.counts["promotions"] += 1
        running = (
            Promotion.objects.filter(is_active=True, scope="CATEGORIES", starts_at__lte=anchor)
            .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=anchor))
            .prefetch_related("categories")
        )
        promo_ids: list[int] = []
        for promo in running:
            promo_ids.extend(c.id for c in promo.categories.all())
        # a promotion on a department also covers its categories
        promo_set = set(promo_ids)  # membership tests only
        covered = {c.id for c in self.all_categories if c.id in promo_set or c.parent_id in promo_set}
        self.promo_category_ids = covered

    # -- products ------------------------------------------------------------------------------------------
    def _category_refs(self) -> list[gen.CategoryRef]:
        return [
            gen.CategoryRef(
                id=c.id,
                slug=c.slug,
                name=c.name,
                parent_name=c.parent.name if c.parent_id and c.parent else "",
                spec=gen.words.spec_for(c.slug),
                promo=c.id in self.promo_category_ids,
            )
            for c in sorted(self.leaf_categories, key=lambda c: c.slug)
        ]

    @staticmethod
    def _search_text(p: gen.ProductPlan) -> str:
        cat = p.category
        parts = [p.brand.name if p.brand else "", cat.name, cat.parent_name, p.sku, p.origin_country]
        return " ".join(x for x in parts if x)  # same recipe as apps.catalog.search.refresh_search_text

    def _products(self) -> None:
        o = self.o
        self.phase(f"products ({o.products})")
        self.plans = gen.plan_products(
            gen.make_rng(o.seed, "products"), o.products, self._category_refs(), self.brands, self.anchor
        )
        unit_ids = {code: u.id for code, u in self.units.items()}
        for batch in chunks(self.plans, o.batch_size):
            rows = []
            for p in batch:
                rows.append(
                    Product(
                        sku=p.sku,
                        slug=p.slug,
                        name=p.name,
                        short_description=p.short_description,
                        description=p.description,
                        category_id=p.category.id,
                        brand_id=p.brand.id if p.brand else None,
                        barcode=p.barcode,
                        product_type=p.product_type,
                        storage_type=p.storage_type,
                        sale_unit_id=unit_ids[p.unit_code],
                        price=p.price,
                        tax_rate=p.tax_rate,
                        qty_min=p.qty_min,
                        qty_step=p.qty_step,
                        qty_max=p.qty_max,
                        net_content=p.net_content,
                        net_content_unit_id=unit_ids[p.net_content_unit] if p.net_content_unit else None,
                        is_variable_weight=p.is_variable_weight,
                        stock_mode="TRACKED",
                        tracks_batches=p.tracks_batches,
                        is_perishable=p.is_perishable,
                        sell_buffer_days=p.sell_buffer_days,
                        status=p.status,
                        is_available=p.is_available,
                        is_featured=p.is_featured,
                        origin_country=p.origin_country,
                        storage_instructions=p.storage_instructions,
                        ingredients=p.ingredients,
                        packaging=p.packaging,
                        manufacturer=p.manufacturer,
                        allergen_info_complete=p.allergen_info_complete,
                        search_text=self._search_text(p),
                        is_demo=True,
                        created_at=p.created_at,
                        updated_at=p.created_at,
                    )
                )
            created = Product.objects.bulk_create(rows)
            for plan, row in zip(batch, created, strict=True):
                plan.pk = row.pk
        self.counts["products"] = len(self.plans)

        # one fixture product for the checkout-race scenario (kept out of orders, batches and popularity)
        leaf = sorted(self.leaf_categories, key=lambda c: c.slug)[0]
        race = Product.objects.create(
            sku=RACE_SKU,
            slug="perf-race-last-units",
            name="Perf Race Fixture Last Units",
            short_description="Fixture for the checkout-race load scenario.",
            category=leaf,
            sale_unit=self.units["each"],
            price=Decimal("1.99"),
            stock_mode="TRACKED",
            search_text=f"{leaf.name} {RACE_SKU}",
            is_demo=True,
            created_at=self.anchor,
            updated_at=self.anchor,
        )
        self.race_product = race
        self.counts["products"] += 1

        Product.objects.filter(sku__startswith=SKU_PREFIX).update(
            search_vector=SearchVector("name", weight="A", config=SEARCH_CONFIG)
            + SearchVector("search_text", weight="B", config=SEARCH_CONFIG)
            + SearchVector("short_description", weight="C", config=SEARCH_CONFIG)
            + SearchVector("description", weight="D", config=SEARCH_CONFIG)
        )

    def _images(self) -> None:
        o = self.o
        self.phase("product images (rows only, no files)")
        name, widths = o.image_path, PLACEHOLDER_WIDTHS
        if not name:
            existing = (
                ProductImage.objects.exclude(product__sku__startswith=SKU_PREFIX)
                .order_by("id")
                .only("image", "image_widths")
                .first()
            )
            if existing is not None:
                name, widths = existing.image.name, list(existing.image_widths)
            else:
                name = PLACEHOLDER_IMAGE
                self.notes.append(
                    f"No product image exists in this database, so image rows point at {PLACEHOLDER_IMAGE} (no file). "
                    "Image URLs will 404; API cost is unaffected. Pass --image-path to point at a real file."
                )
        self.image_name, self.image_widths = name, widths
        for batch in chunks(self.plans, o.batch_size * 2):
            ProductImage.objects.bulk_create(
                [
                    ProductImage(
                        product_id=p.pk,
                        image=name,
                        image_widths=widths,
                        alt_text=p.name[:200],
                        sort_order=0,
                        created_at=p.created_at,
                        updated_at=p.created_at,
                    )
                    for p in batch
                ]
            )
            for p in batch:
                p.image_name = name
        self.counts["product images"] = len(self.plans)

    # -- stock and batches --------------------------------------------------------------------------------------
    def _stock(self) -> None:
        o, anchor = self.o, self.anchor
        self.phase("stock levels and batches")
        levels, batches = gen.plan_stock(gen.make_rng(o.seed, "stock"), self.plans, self.branches, self.today)
        for part in chunks(levels, o.batch_size * 2):
            StockLevel.objects.bulk_create(
                [
                    StockLevel(
                        product_id=lv.product.pk,
                        branch_id=lv.branch.id,
                        on_hand=lv.on_hand,
                        reserved=lv.reserved,
                        low_stock_threshold=lv.threshold,
                        reorder_quantity=lv.reorder,
                        created_at=lv.product.created_at,
                        updated_at=anchor,
                    )
                    for lv in part
                ]
            )
        race_rows = [
            StockLevel(
                product_id=self.race_product.pk,
                branch_id=b.id,
                on_hand=RACE_STOCK,
                reserved=Decimal("0"),
                low_stock_threshold=Decimal("0"),
                reorder_quantity=Decimal("0"),
                created_at=anchor,
                updated_at=anchor,
            )
            for b in self.branches
        ]
        StockLevel.objects.bulk_create(race_rows)
        self.counts["stock levels"] = len(levels) + len(race_rows)

        for part in chunks(batches, o.batch_size):
            created = Batch.objects.bulk_create(
                [
                    Batch(
                        product_id=b.product.pk,
                        branch_id=b.branch.id,
                        lot_code=b.lot_code,
                        received_on=b.received_on,
                        expiry_date=b.expiry_date,
                        expiry_kind=b.expiry_kind,
                        sellable_until=b.sellable_until,
                        qty_received=b.qty,
                        qty_remaining=b.qty,
                        qty_reserved=b.reserved,
                        unit_cost=b.unit_cost,
                        status=b.status,
                        quality_status=b.quality_status,
                        notes="Perf seed lot",
                        is_demo=True,
                        created_at=self._at(b.received_on, 6, 30),
                        updated_at=self._at(b.received_on, 6, 30),
                    )
                    for b in part
                ]
            )
            if o.movements:
                StockMovement.objects.bulk_create(
                    [
                        StockMovement(
                            product_id=b.product.pk,
                            branch_id=b.branch.id,
                            batch_id=row.pk,
                            kind="RECEIPT",
                            qty_delta=b.qty,
                            on_hand_after=Decimal("0"),
                            unit_cost=b.unit_cost,
                            note="Perf seed lot receipt",
                            ref_type=MOVEMENT_REF,
                            ref_id=b.lot_code,
                            created_at=self._at(b.received_on, 6, 30),
                        )
                        for b, row in zip(part, created, strict=True)
                    ]
                )
        self.counts["batches"] = len(batches)

    def _at(self, day: dt.date, hour: int, minute: int = 0) -> dt.datetime:
        return dt.datetime.combine(day, dt.time(hour, minute), tzinfo=self.tz).astimezone(dt.UTC)

    # -- customers -------------------------------------------------------------------------------------------------
    def _customers(self) -> None:
        o = self.o
        self.phase(f"customers ({o.customers})")
        self.customers = gen.plan_customers(gen.make_rng(o.seed, "customers"), o.customers, self.anchor)
        unusable = make_password(None)  # one unusable hash for all: nobody can sign in as a perf customer
        for part in chunks(self.customers, o.batch_size * 2):
            created = User.objects.bulk_create(
                [
                    User(
                        email=c.email,
                        full_name=c.full_name,
                        phone=c.phone,
                        role=rbac.CUSTOMER,
                        is_active=True,
                        is_staff=False,
                        is_superuser=False,
                        marketing_opt_in=c.marketing_opt_in,
                        password=unusable,
                        created_at=c.created_at,
                        updated_at=c.created_at,
                    )
                    for c in part
                ]
            )
            for plan, row in zip(part, created, strict=True):
                plan.pk = row.pk
        self.counts["customers"] = len(self.customers)

    # -- orders ---------------------------------------------------------------------------------------------------------
    def _orders(self) -> None:
        o = self.o
        if o.orders == 0:
            return
        self.phase(f"orders ({o.orders}) with items, payments, history")
        planner = gen.OrderPlanner(
            o.seed,
            self.plans,
            self.customers,
            self.branches,
            self.store,
            self.anchor,
            history=o.history,
        )
        stamps = gen.plan_timestamps(gen.make_rng(o.seed, "order-times"), o.orders, self.anchor, o.days, self.store.tz)
        unit_by_code = {code: (u.symbol, u.name) for code, u in self.units.items()}
        status_count: Counter[str] = Counter()
        done = 0
        for chunk_start in range(0, o.orders, o.batch_size):
            plans = [
                planner.plan(i, stamps[i - 1])
                for i in range(chunk_start + 1, min(chunk_start + o.batch_size, o.orders) + 1)
            ]
            self._insert_orders(plans, unit_by_code)
            status_count.update(p.status for p in plans)
            done += len(plans)
            if done % (o.batch_size * 5) == 0 or done == o.orders:
                self.phase(f"  {done}/{o.orders} orders")
        self.counts["orders"] = o.orders
        for status, n in sorted(status_count.items()):
            self.counts[f"orders {status}"] = n

    def _insert_orders(self, plans: list[gen.OrderPlan], unit_by_code: dict) -> None:
        o = self.o
        rows = [
            Order(
                number=p.number,
                customer_id=p.customer.pk if p.customer else None,
                contact_name=p.contact_name,
                contact_email=p.contact_email,
                contact_phone=p.contact_phone,
                tracking_token=p.tracking_token,
                branch_id=p.branch.id,
                fulfilment_type=p.fulfilment_type,
                zone_id=p.zone.id if p.zone else None,
                slot_starts_at=p.slot_starts_at,
                slot_ends_at=p.slot_ends_at,
                substitution_policy=p.substitution_policy,
                customer_note=p.customer_note,
                currency=p.currency,
                subtotal=p.subtotal,
                promo_savings=p.promo_savings,
                delivery_fee=p.delivery_fee,
                tax_total=p.tax_total,
                total=p.total,
                authorized_amount=p.authorized_amount,
                final_total=p.final_total,
                weights_finalized_at=p.weights_finalized_at,
                status=p.status,
                payment_status=p.payment_status,
                payment_method=p.payment_method,
                checkout_key=p.checkout_key,
                reservation_expires_at=p.reservation_expires_at,
                placed_at=p.placed_at,
                confirmed_at=p.confirmed_at,
                picking_started_at=p.picking_started_at,
                packed_at=p.packed_at,
                ready_at=p.ready_at,
                dispatched_at=p.dispatched_at,
                completed_at=p.completed_at,
                cancelled_at=p.cancelled_at,
                cancel_reason=p.cancel_reason,
                is_demo=True,
                created_at=p.placed_at,
                updated_at=p.updated_at or p.placed_at,
                **p.ship,
            )
            for p in plans
        ]
        created = Order.objects.bulk_create(rows, batch_size=o.batch_size)
        for plan, row in zip(plans, created, strict=True):
            plan.pk = row.pk

        items, history, payments = [], [], []
        sales = []
        for p in plans:
            for it in p.items:
                prod = it.product
                symbol, uname = unit_by_code[prod.unit_code]
                items.append(
                    OrderItem(
                        order_id=p.pk,
                        product_id=prod.pk,
                        name=prod.name,
                        sku=prod.sku,
                        image_path=prod.image_name,
                        unit_symbol=symbol,
                        unit_name=uname,
                        is_variable_weight=prod.is_variable_weight,
                        tax_rate=prod.tax_rate,
                        base_unit_price=it.base_unit_price,
                        unit_price=it.unit_price,
                        promo_label=it.promo_label,
                        promo_kind=it.promo_kind,
                        promo_params=it.promo_params,
                        ordered_qty=it.qty,
                        picked_qty=it.picked_qty,
                        line_total_estimated=it.line_total_estimated,
                        line_total_final=it.line_total_final,
                        status=it.status,
                        picked_at=it.picked_at,
                        created_at=p.placed_at,
                        updated_at=p.updated_at or p.placed_at,
                    )
                )
                if o.movements and p.status == "COMPLETED" and it.picked_qty:
                    sales.append(
                        StockMovement(
                            product_id=prod.pk,
                            branch_id=p.branch.id,
                            kind="SALE",
                            qty_delta=-it.picked_qty,
                            on_hand_after=Decimal("0"),
                            ref_type=MOVEMENT_REF,
                            ref_id=p.number,
                            created_at=it.picked_at or p.placed_at,
                        )
                    )
            for h in p.history:
                history.append(
                    OrderStatusHistory(
                        order_id=p.pk,
                        from_status=h.from_status,
                        to_status=h.to_status,
                        actor_label=h.actor_label[:254],
                        public_note=h.public_note,
                        created_at=h.at,
                    )
                )
            pay = p.payment
            payments.append(
                Payment(
                    order_id=p.pk,
                    provider=pay["provider"],
                    method=pay["method"],
                    state=pay["state"],
                    amount=pay["amount"],
                    captured_amount=pay["captured"],
                    refunded_amount=pay["refunded"],
                    currency=p.currency,
                    provider_reference=pay["reference"],
                    attempt=pay["attempt"],
                    idempotency_key=f"perf-{p.number}",
                    failure_code=pay["failure_code"],
                    failure_message=pay["failure_message"],
                    captured_at=pay["captured_at"],
                    is_demo=True,
                    created_at=p.placed_at,
                    updated_at=pay["updated_at"],
                )
            )
        OrderItem.objects.bulk_create(items, batch_size=o.batch_size)
        self.counts["order items"] += len(items)
        if history:
            OrderStatusHistory.objects.bulk_create(history, batch_size=o.batch_size)
            self.counts["order status history"] += len(history)
        created_payments = Payment.objects.bulk_create(payments, batch_size=o.batch_size)
        self.counts["payments"] += len(payments)
        refunds = []
        for p, pay_row in zip(plans, created_payments, strict=True):
            if p.refund:
                refunds.append(
                    Refund(
                        payment_id=pay_row.pk,
                        order_id=p.pk,
                        amount=p.refund["amount"],
                        reason=p.refund["reason"],
                        status="SUCCEEDED",
                        method="PROVIDER",
                        provider_refund_id=f"perf_re_{p.number}",
                        idempotency_key=f"perf-refund-{p.number}",
                        completed_at=p.refund["completed_at"],
                        created_at=p.refund["completed_at"],
                        updated_at=p.refund["completed_at"],
                    )
                )
        if refunds:
            Refund.objects.bulk_create(refunds)
            self.counts["refunds"] += len(refunds)
        if sales:
            StockMovement.objects.bulk_create(sales, batch_size=o.batch_size)
            self.counts["stock movements (sales)"] += len(sales)

    # -- derived data ------------------------------------------------------------------------------------------
    def _finalise(self) -> None:
        o = self.o
        self.phase("popularity from generated order lines")
        since = self.anchor - dt.timedelta(days=30)
        pr, oi, od = Product._meta.db_table, OrderItem._meta.db_table, Order._meta.db_table
        with connection.cursor() as cur:
            cur.execute(
                f"""
                UPDATE {pr} p SET popularity = s.total::integer
                FROM (
                    SELECT i.product_id, ROUND(SUM(i.ordered_qty)) AS total
                    FROM {oi} i JOIN {od} o ON o.id = i.order_id
                    WHERE o.contact_email LIKE %(email)s AND o.placed_at >= %(since)s
                      AND o.status <> ALL(%(excluded)s) AND i.substitute_for_id IS NULL
                    GROUP BY i.product_id
                ) s
                WHERE p.id = s.product_id AND p.sku LIKE %(sku)s
                """,  # noqa: S608 - table names come from model metadata, values are bound parameters
                {
                    "email": f"%@{EMAIL_DOMAIN}",
                    "since": since,
                    "excluded": list(OPEN_PAYMENT_EXCLUDED),
                    "sku": f"{SKU_PREFIX}%",
                },
            )
            self.counts["products with popularity > 0"] = Product.objects.filter(
                sku__startswith=SKU_PREFIX, popularity__gt=0
            ).count()
        if not o.movements:
            return
        self.phase("stock ledger: opening balances and running totals")
        sm, sl = StockMovement._meta.db_table, StockLevel._meta.db_table
        opening = self.anchor - dt.timedelta(days=o.days + 10)
        with connection.cursor() as cur:
            # opening receipt per product x branch so that (receipts - sales) == the stock level's on_hand
            cur.execute(
                f"""
                INSERT INTO {sm} (product_id, branch_id, batch_id, kind, qty_delta, on_hand_after, unit_cost,
                                  reason_code, note, actor_id, ref_type, ref_id, created_at)
                SELECT l.product_id, l.branch_id, NULL, 'RECEIPT',
                       l.on_hand + COALESCE(s.sold, 0) - COALESCE(b.received, 0), 0, NULL,
                       '', 'Perf seed opening balance', NULL, %(ref)s, 'opening', %(ts)s
                FROM {sl} l
                JOIN {pr} p ON p.id = l.product_id
                LEFT JOIN (SELECT product_id, branch_id, SUM(-qty_delta) AS sold FROM {sm}
                           WHERE ref_type = %(ref)s AND kind = 'SALE' GROUP BY product_id, branch_id) s
                       ON s.product_id = l.product_id AND s.branch_id = l.branch_id
                LEFT JOIN (SELECT product_id, branch_id, SUM(qty_delta) AS received FROM {sm}
                           WHERE ref_type = %(ref)s AND kind = 'RECEIPT' AND batch_id IS NOT NULL
                           GROUP BY product_id, branch_id) b
                       ON b.product_id = l.product_id AND b.branch_id = l.branch_id
                WHERE p.sku LIKE %(sku)s
                  AND l.on_hand + COALESCE(s.sold, 0) - COALESCE(b.received, 0) > 0
                """,  # noqa: S608
                {"ref": MOVEMENT_REF, "ts": opening, "sku": f"{SKU_PREFIX}%"},
            )
            cur.execute(
                f"""
                UPDATE {sm} m SET on_hand_after = x.bal
                FROM (SELECT id, SUM(qty_delta) OVER (PARTITION BY product_id, branch_id ORDER BY created_at, id) AS bal
                      FROM {sm} WHERE ref_type = %(ref)s) x
                WHERE m.id = x.id
                """,  # noqa: S608
                {"ref": MOVEMENT_REF},
            )
        self.counts["stock movements (total)"] = StockMovement.objects.filter(ref_type=MOVEMENT_REF).count()

    def _analyze(self) -> None:
        """VACUUM (ANALYZE) when possible (sets the visibility map, so index-only scans become available, as in a
        settled production database); plain ANALYZE inside an enclosing transaction (VACUUM cannot run there)."""
        qn = connection.ops.quote_name
        command = "ANALYZE" if connection.in_atomic_block else "VACUUM (ANALYZE)"
        with connection.cursor() as cur:
            for model in ANALYZE_MODELS:
                cur.execute(f"{command} {qn(model._meta.db_table)}")  # noqa: S608 - fixed command, quoted table name
