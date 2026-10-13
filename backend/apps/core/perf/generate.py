"""Pure-Python planning of synthetic data: no database access, fully deterministic for a given seed.

The seeder (`seeder.py`) feeds these planners with reference data read from the database (categories, brands, branches)
and turns the resulting plain dataclasses into model rows. Keeping the planning free of ORM calls makes it easy to
unit-test and guarantees that two runs with the same seed and anchor produce byte-identical data (apart from primary
keys, which come from database sequences, and the random suffix of the unusable password hash).

Every decision uses `random.Random(f"perf-seed:{seed}:{stream}")` with a *named stream* per entity type, so changing
`--orders` never changes which products exist and vice versa. Nothing here iterates a `set` (string hashing is
randomised per process), which would otherwise leak non-determinism between runs.
"""

from __future__ import annotations

import base64
import bisect
import datetime as dt
import hashlib
import math
import random
import string
import zoneinfo
from dataclasses import dataclass, field
from decimal import Decimal

from apps.core.money import money

from . import words
from .words import CategorySpec

CENT = Decimal("0.01")
MILLI = Decimal("0.001")
ZERO = Decimal("0")
ORDER_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"

P_VARIABLE_WEIGHT = 0.15
P_BATCH_TRACKED = 0.25
P_PROMO_CATEGORY = 0.10
P_GUEST_ORDER = 0.12
P_CARD = 0.65
P_DELIVERY = 0.70
PAYMENT_WINDOW_MINUTES = 15
USE_BY_SLUGS = ("meat-poultry", "seafood", "milk", "yogurt")


def make_rng(seed: int, stream: str) -> random.Random:
    return random.Random(f"perf-seed:{seed}:{stream}")


def q3(value) -> Decimal:
    return Decimal(value).quantize(MILLI)


def ean13(prefix12: str) -> str:
    digits = [int(c) for c in prefix12]
    total = sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits))
    return prefix12 + str((10 - total % 10) % 10)


def size_label(amount: int, unit: str) -> str:
    if unit == "g" and amount >= 1000 and amount % 1000 == 0:
        return f"{amount // 1000} kg"
    if unit == "ml" and amount >= 1000 and amount % 1000 == 0:
        return f"{amount // 1000} L"
    if unit == "l":
        return f"{amount} L"
    return f"{amount} {unit}"


def slugify_ascii(text: str) -> str:
    out = []
    for ch in text.lower():
        if ch.isascii() and ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")


# ----------------------------------------------------------------------------------------- reference inputs
@dataclass(frozen=True)
class CategoryRef:
    id: int
    slug: str
    name: str
    parent_name: str
    spec: CategorySpec
    promo: bool = False  # covered by a running category promotion


@dataclass(frozen=True)
class BrandRef:
    id: int
    name: str


@dataclass(frozen=True)
class ZoneRef:
    id: int
    prefix: str
    area: str
    fee: Decimal
    free_threshold: Decimal | None


@dataclass(frozen=True)
class BranchRef:
    id: int
    code: str
    name: str
    is_default: bool
    zones: tuple[ZoneRef, ...] = ()


@dataclass(frozen=True)
class StoreRef:
    currency: str = "USD"
    prices_include_tax: bool = True
    weight_tolerance_percent: Decimal = Decimal("10.00")
    tz: str = "UTC"


# ----------------------------------------------------------------------------------------- products
@dataclass(slots=True)
class ProductPlan:
    index: int
    sku: str
    slug: str
    name: str
    short_description: str
    description: str
    category: CategoryRef
    brand: BrandRef | None
    barcode: str | None
    product_type: str
    storage_type: str
    unit_code: str
    price: Decimal
    tax_rate: Decimal
    qty_min: Decimal
    qty_step: Decimal
    qty_max: Decimal | None
    net_content: Decimal | None
    net_content_unit: str | None
    is_variable_weight: bool
    tracks_batches: bool
    is_perishable: bool
    sell_buffer_days: int
    status: str
    is_available: bool
    is_featured: bool
    origin_country: str
    storage_instructions: str
    ingredients: str
    packaging: str
    manufacturer: str
    allergen_info_complete: bool
    created_at: dt.datetime
    expiry_kind: str = "BEST_BEFORE"
    pk: int = 0  # filled in after insertion
    image_name: str = ""

    @property
    def orderable(self) -> bool:
        return self.status == "ACTIVE" and self.is_available


def brand_word(name: str) -> str:
    tokens = name.split()
    if tokens and tokens[0] == "Perf":
        tokens = tokens[1:]
    return tokens[0] if tokens else name


def _price(rng: random.Random, median: float, ceiling: float) -> Decimal:
    value = median * math.exp(rng.gauss(0, 0.45))
    value = min(max(value, 0.29), ceiling)
    cents = int(round(value * 100))
    style = rng.random()
    if style < 0.45 and cents >= 100:
        cents = (cents // 100) * 100 + 99
    elif style < 0.70:
        cents = max(29, int(round(cents / 5) * 5))
    return Decimal(cents) / 100


def _pools(categories: list[CategoryRef]) -> dict[tuple[bool, bool, bool], tuple[list[CategoryRef], list[float]]]:
    """(variable weight, batch tracked, promo-eligible) -> (categories, cumulative weights)."""
    pools = {}
    for vw in (False, True):
        for batch in (False, True):
            for promo in (False, True):
                cats, weights = [], []
                for c in categories:
                    if c.promo != promo:
                        continue
                    if vw and not c.spec.weight_capable:
                        continue
                    if batch and not c.spec.perishable:
                        continue
                    w = c.spec.share
                    if not vw and not batch and c.spec.perishable:
                        w *= 0.3  # most perishables are batch tracked, so only a few appear untracked
                    cats.append(c)
                    weights.append(w)
                cum, total = [], 0.0
                for w in weights:
                    total += w
                    cum.append(total)
                pools[(vw, batch, promo)] = (cats, cum)
    return pools


def _pick(rng: random.Random, cats: list[CategoryRef], cum: list[float]) -> CategoryRef:
    return cats[bisect.bisect_left(cum, rng.random() * cum[-1])]


def _zipf_cumulative(n: int, s: float = 1.0, shift: int = 3) -> list[float]:
    cum, total = [], 0.0
    for i in range(1, n + 1):
        total += (i + shift) ** -s
        cum.append(total)
    return cum


def plan_brands(rng: random.Random, n: int) -> list[str]:
    """Distinct synthetic brand names, e.g. `Perf Alderbrook Foods`."""
    names: list[str] = []
    seen: set[str] = set()  # membership only; never iterated
    attempts = 0
    while len(names) < n and attempts < n * 50:
        attempts += 1
        name = f"Perf {rng.choice(words.BRAND_WORDS_A)} {rng.choice(words.BRAND_WORDS_B)}"
        if name not in seen:
            seen.add(name)
            names.append(name)
    return names


def plan_products(
    rng: random.Random,
    n: int,
    categories: list[CategoryRef],
    brands: list[BrandRef],
    anchor: dt.datetime,
    sku_prefix: str = "PERF-",
) -> list[ProductPlan]:
    if not categories:
        raise ValueError("no categories to attach products to")
    pools = _pools(categories)
    brand_cum = _zipf_cumulative(len(brands), s=0.9, shift=2) if brands else []
    plans: list[ProductPlan] = []
    for i in range(1, n + 1):
        vw = rng.random() < P_VARIABLE_WEIGHT
        batch = rng.random() < P_BATCH_TRACKED
        want_promo = rng.random() < P_PROMO_CATEGORY
        pool = None
        # relax impossible combinations in a fixed order so the result stays deterministic
        for vw_try, batch_try in ((vw, batch), (vw, False), (False, batch), (False, False)):
            for promo_try in (want_promo, not want_promo):
                cats, cum = pools[(vw_try, batch_try, promo_try)]
                if cats:
                    pool, vw, batch = (cats, cum), vw_try, batch_try
                    break
            if pool:
                break
        assert pool is not None
        cat = _pick(rng, *pool)
        spec = cat.spec

        brand = (
            brands[bisect.bisect_left(brand_cum, rng.random() * brand_cum[-1])]
            if brands and rng.random() > 0.12
            else None
        )
        if vw:
            unit_code = "kg"
            qty_min, qty_step, qty_max = (
                Decimal("0.250"),
                Decimal("0.250"),
                Decimal("5.000") if rng.random() < 0.8 else None,
            )
            price = _price(rng, spec.kg_price or spec.count_price * 3, 79.99)
            net_content = net_unit = None
            size_text = ""
        else:
            unit_code = rng.choice(spec.units)
            qty_min, qty_step = Decimal("1.000"), Decimal("1.000")
            qty_max = rng.choice((None, Decimal("12.000"), Decimal("24.000"), Decimal("6.000")))
            price = _price(rng, spec.count_price, 39.99)
            if spec.packs and unit_code != "dozen":
                amount, net_unit = rng.choice(spec.packs)
                net_content = Decimal(amount)
                size_text = size_label(amount, net_unit)
            else:
                net_content = net_unit = None
                size_text = "12 pack" if unit_code == "dozen" else ""

        noun, variant, adj = rng.choice(spec.nouns), rng.choice(spec.variants), rng.choice(words.ADJECTIVES)
        if variant == adj:
            adj = rng.choice(words.ADJECTIVES)
        r = rng.random()
        if r < 0.35:
            parts = [adj, variant, noun]
        elif r < 0.60:
            parts = [variant, noun]
        elif r < 0.80 and brand is not None:
            parts = [brand_word(brand.name), noun, variant]
        else:
            parts = [adj, noun]
        if size_text and rng.random() < 0.85:
            parts.append(size_text)
        name = " ".join(parts)[:140]

        sku = f"{sku_prefix}{i:06d}"
        origin = rng.choice(words.ORIGINS) if cat.spec.ptype == "LOOSE_PRODUCE" and rng.random() < 0.7 else ""
        packaged = spec.ptype not in ("LOOSE_PRODUCE",)
        ingredients = (
            ", ".join(rng.sample(words.INGREDIENT_WORDS, rng.randint(3, 6))).capitalize()
            if packaged and rng.random() < 0.6
            else ""
        )
        days_ago = rng.uniform(0, 30) if rng.random() < 0.07 else rng.uniform(31, 600)
        created = anchor - dt.timedelta(days=days_ago)
        status_roll = rng.random()
        status = "ACTIVE" if status_roll < 0.96 else ("INACTIVE" if status_roll < 0.985 else "ARCHIVED")
        is_available = not (status == "ACTIVE" and rng.random() < 0.015)
        tax = Decimal(rng.choices(("0", "5", "8"), weights=(70, 15, 15))[0])
        expiry_kind = "USE_BY" if cat.slug in USE_BY_SLUGS else "BEST_BEFORE"
        product_type = "PACKAGED" if spec.ptype == "LOOSE_PRODUCE" and not vw else spec.ptype
        buffer_days = 2 if spec.storage == "CHILLED" else (30 if spec.storage == "FROZEN" else (14 if batch else 1))
        short = (
            f"{variant} {noun.lower()}"
            + (f", {size_text}" if size_text else "")
            + ". "
            + rng.choice(words.DESCRIPTION_OPENERS)
        )
        description = " ".join(
            (
                rng.choice(words.DESCRIPTION_OPENERS),
                f"{adj} {noun.lower()} in the {variant.lower()} style, supplied for the {cat.name.lower()} aisle.",
                rng.choice(words.DESCRIPTION_MIDDLES),
                words.STORAGE_TEXT[spec.storage],
            )
        )
        plans.append(
            ProductPlan(
                index=i,
                sku=sku,
                slug=f"{slugify_ascii(name)[:110]}-{i:06d}",
                name=name,
                short_description=short[:220],
                description=description,
                category=cat,
                brand=brand,
                barcode=ean13(f"29{i:010d}") if rng.random() < 0.9 else None,
                product_type=product_type,
                storage_type=spec.storage,
                unit_code=unit_code,
                price=price,
                tax_rate=tax,
                qty_min=qty_min,
                qty_step=qty_step,
                qty_max=qty_max,
                net_content=net_content,
                net_content_unit=net_unit,
                is_variable_weight=vw,
                tracks_batches=batch,
                is_perishable=spec.perishable or batch,
                sell_buffer_days=buffer_days,
                status=status,
                is_available=is_available,
                is_featured=rng.random() < 0.02,
                origin_country=origin,
                storage_instructions=words.STORAGE_TEXT[spec.storage],
                ingredients=ingredients,
                packaging=rng.choice(words.PACKAGING_TEXT) if packaged else "",
                manufacturer=brand.name if brand else "",
                allergen_info_complete=rng.random() < 0.4,
                created_at=created,
                expiry_kind=expiry_kind,
            )
        )
    return plans


# ----------------------------------------------------------------------------------------- stock and batches
@dataclass(slots=True)
class LevelPlan:
    product: ProductPlan
    branch: BranchRef
    on_hand: Decimal
    reserved: Decimal
    threshold: Decimal
    reorder: Decimal


@dataclass(slots=True)
class BatchPlan:
    product: ProductPlan
    branch: BranchRef
    lot_code: str
    received_on: dt.date
    expiry_date: dt.date
    sellable_until: dt.date
    qty: Decimal  # qty_received == qty_remaining (lots are fresh; sales are modelled at product level)
    reserved: Decimal
    unit_cost: Decimal
    status: str
    quality_status: str
    expiry_kind: str


# (upper bound of days-to-expiry bucket, probability) — "days left" is drawn uniformly inside the bucket.
_EXPIRY_BUCKETS = {
    "CHILLED": ((-1, 0.05, -8), (1, 0.07, 0), (3, 0.10, 2), (7, 0.20, 4), (14, 0.35, 8), (30, 0.23, 15)),
    "AMBIENT": ((-1, 0.02, -20), (1, 0.01, 0), (3, 0.02, 2), (7, 0.03, 4), (30, 0.12, 8), (365, 0.80, 31)),
    "FROZEN": ((-1, 0.01, -10), (1, 0.01, 0), (3, 0.01, 2), (7, 0.02, 4), (60, 0.10, 8), (400, 0.85, 61)),
}


def _days_left(rng: random.Random, storage: str) -> int:
    buckets = _EXPIRY_BUCKETS[storage]
    r, acc = rng.random(), 0.0
    for upper, p, lower in buckets:
        acc += p
        if r < acc:
            return rng.randint(lower, upper)
    upper, _, lower = buckets[-1]
    return rng.randint(lower, upper)


def _stock_qty(rng: random.Random, p: ProductPlan, lo: float, hi: float) -> Decimal:
    value = rng.uniform(lo, hi)
    if p.is_variable_weight:
        return q3(max(0.5, round(value * 2) / 2))
    return q3(max(1, round(value)))


def plan_stock(
    rng: random.Random, products: list[ProductPlan], branches: list[BranchRef], today: dt.date
) -> tuple[list[LevelPlan], list[BatchPlan]]:
    levels: list[LevelPlan] = []
    batches: list[BatchPlan] = []
    for p in products:
        for branch in branches:
            if p.is_variable_weight:
                threshold = q3(rng.randint(3, 20))
            else:
                threshold = q3(rng.randint(4, 30))
            reorder = q3(float(threshold) * rng.uniform(2, 4))
            if p.tracks_batches:
                on_hand, reserved = ZERO, ZERO
                n_lots = 0 if rng.random() < 0.06 else rng.choices((1, 2, 3), weights=(50, 35, 15))[0]
                storage = p.category.spec.storage
                for k in range(1, n_lots + 1):
                    days_left = _days_left(rng, storage)
                    expiry = today + dt.timedelta(days=days_left)
                    received = min(today - dt.timedelta(days=rng.randint(0, 10)), expiry - dt.timedelta(days=1))
                    qty = _stock_qty(rng, p, 4, 60) if not p.is_variable_weight else _stock_qty(rng, p, 2, 25)
                    quarantined = rng.random() < 0.01
                    expired = days_left < 0
                    status = (
                        "QUARANTINED" if quarantined else ("EXPIRED" if expired and rng.random() < 0.7 else "ACTIVE")
                    )
                    quality = "PASSED"
                    if quarantined:
                        quality = rng.choice(("FAILED", "PENDING"))
                    reserved_qty = ZERO
                    if status == "ACTIVE" and not expired and rng.random() < 0.10:
                        reserved_qty = q3(math.floor(float(qty) * rng.uniform(0, 0.3)))
                    on_hand += qty
                    reserved += reserved_qty
                    batches.append(
                        BatchPlan(
                            product=p,
                            branch=branch,
                            lot_code=f"{p.sku}-B{branch.id}-{k}",
                            received_on=received,
                            expiry_date=expiry,
                            sellable_until=expiry - dt.timedelta(days=p.sell_buffer_days),
                            qty=qty,
                            reserved=reserved_qty,
                            unit_cost=Decimal(int(float(p.price) * rng.uniform(0.5, 0.75) * 10000)) / 10000,
                            status=status,
                            quality_status=quality,
                            expiry_kind=p.expiry_kind,
                        )
                    )
            else:
                roll = rng.random()
                if roll < 0.06:
                    on_hand, reserved = ZERO, ZERO
                elif roll < 0.14:
                    on_hand = q3(rng.randint(1, max(1, int(threshold))))
                    reserved = q3(rng.randint(0, int(on_hand) // 2))
                else:
                    on_hand = _stock_qty(rng, p, float(threshold) * 1.5, float(threshold) * 10)
                    reserved = q3(math.floor(float(on_hand) * rng.uniform(0, 0.25)))
            if reserved > on_hand:  # defensive: the table has CHECK (reserved <= on_hand)
                reserved = on_hand
            levels.append(LevelPlan(p, branch, on_hand, reserved, threshold, reorder))
    return levels, batches


# ----------------------------------------------------------------------------------------- customers
@dataclass(slots=True)
class CustomerPlan:
    index: int
    email: str
    full_name: str
    phone: str
    marketing_opt_in: bool
    created_at: dt.datetime
    pk: int = 0


def plan_customers(rng: random.Random, n: int, anchor: dt.datetime) -> list[CustomerPlan]:
    out = []
    for i in range(1, n + 1):
        first, last = rng.choice(words.FIRST_NAMES), rng.choice(words.LAST_NAMES)
        out.append(
            CustomerPlan(
                index=i,
                email=f"perf-user-{i:05d}@perf.invalid",
                full_name=f"{first} {last}",
                phone=f"+1 555 {rng.randint(200, 999)} {rng.randint(1000, 9999)}",
                marketing_opt_in=rng.random() < 0.3,
                created_at=anchor - dt.timedelta(days=rng.uniform(0, 400)),
            )
        )
    return out


# ----------------------------------------------------------------------------------------- orders
@dataclass(slots=True)
class ItemPlan:
    product: ProductPlan
    qty: Decimal
    base_unit_price: Decimal
    unit_price: Decimal
    promo_label: str
    promo_kind: str
    promo_params: dict | None
    line_total_estimated: Decimal
    status: str = "PENDING"
    picked_qty: Decimal | None = None
    line_total_final: Decimal | None = None
    picked_at: dt.datetime | None = None


@dataclass(slots=True)
class HistoryPlan:
    from_status: str
    to_status: str
    at: dt.datetime
    actor_label: str
    public_note: str


@dataclass(slots=True)
class OrderPlan:
    index: int
    number: str
    tracking_token: str
    checkout_key: str
    customer: CustomerPlan | None
    contact_name: str
    contact_email: str
    contact_phone: str
    branch: BranchRef
    zone: ZoneRef | None
    fulfilment_type: str
    payment_method: str
    substitution_policy: str
    customer_note: str
    ship: dict
    placed_at: dt.datetime
    slot_starts_at: dt.datetime
    slot_ends_at: dt.datetime
    status: str
    payment_status: str
    items: list[ItemPlan]
    subtotal: Decimal
    promo_savings: Decimal
    delivery_fee: Decimal
    tax_total: Decimal
    total: Decimal
    authorized_amount: Decimal
    final_total: Decimal | None
    reservation_expires_at: dt.datetime | None = None
    confirmed_at: dt.datetime | None = None
    picking_started_at: dt.datetime | None = None
    packed_at: dt.datetime | None = None
    ready_at: dt.datetime | None = None
    dispatched_at: dt.datetime | None = None
    completed_at: dt.datetime | None = None
    cancelled_at: dt.datetime | None = None
    cancel_reason: str = ""
    weights_finalized_at: dt.datetime | None = None
    updated_at: dt.datetime | None = None
    history: list[HistoryPlan] = field(default_factory=list)
    payment: dict | None = None
    refund: dict | None = None
    currency: str = "USD"
    pk: int = 0  # filled in after insertion


class ZipfSampler:
    """Draws distinct item indexes with probability ∝ (rank + shift)^-s: a few staples, a long tail."""

    def __init__(self, n: int, rng: random.Random, s: float = 0.85, shift: int = 20):
        self.n = n
        order = list(range(n))
        rng.shuffle(order)  # which product holds which popularity rank
        self.order = order
        self.cum = _zipf_cumulative(n, s=s, shift=shift)

    def draw(self, rng: random.Random, k: int) -> list[int]:
        k = min(k, self.n)
        chosen: list[int] = []
        seen: set[int] = set()
        total = self.cum[-1]
        while len(chosen) < k:
            idx = self.order[bisect.bisect_left(self.cum, rng.random() * total)]
            if idx not in seen:
                seen.add(idx)
                chosen.append(idx)
        return chosen


_DAY_WEIGHT = {0: 0.9, 1: 0.9, 2: 0.95, 3: 1.0, 4: 1.2, 5: 1.35, 6: 1.15}  # Monday=0
_HOUR_WEIGHT = [0.05] * 6 + [0.5, 0.5, 0.6] + [1.0] * 3 + [0.9, 0.9] + [0.7] * 3 + [1.5] * 4 + [0.7, 0.7, 0.15]


def plan_timestamps(rng: random.Random, n: int, anchor: dt.datetime, days: int, tz_name: str) -> list[dt.datetime]:
    """`n` placement times over the last `days` days: weekend/evening peaks, mild growth, sorted oldest first."""
    tz = zoneinfo.ZoneInfo(tz_name)
    local_anchor = anchor.astimezone(tz)
    day_choices = list(range(days))  # days ago
    weights = []
    for d in day_choices:
        date = (local_anchor - dt.timedelta(days=d)).date()
        trend = 1.15 - 0.30 * d / max(1, days - 1)
        weights.append(_DAY_WEIGHT[date.weekday()] * trend)
    picked_days = rng.choices(day_choices, weights=weights, k=n)
    picked_hours = rng.choices(range(24), weights=_HOUR_WEIGHT, k=n)
    out = []
    for d, h in zip(picked_days, picked_hours, strict=True):
        base = (local_anchor - dt.timedelta(days=d)).replace(hour=h, minute=0, second=0, microsecond=0)
        placed = base + dt.timedelta(minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))
        if placed > local_anchor:
            placed = local_anchor - dt.timedelta(minutes=rng.randint(1, 600))
        out.append(placed.astimezone(dt.UTC))
    out.sort()
    return out


class OrderPlanner:
    def __init__(
        self,
        seed: int,
        products: list[ProductPlan],
        customers: list[CustomerPlan],
        branches: list[BranchRef],
        store: StoreRef,
        anchor: dt.datetime,
        promo_percent: Decimal = Decimal("15.00"),
        history: bool = True,
    ):
        self.rng = make_rng(seed, "orders")
        self.seed = seed
        self.products = [p for p in products if p.orderable]
        if not self.products:
            raise ValueError("no orderable products to build orders from")
        self.customers = customers
        self.branches = branches
        self.store = store
        self.anchor = anchor
        self.tz = zoneinfo.ZoneInfo(store.tz)
        self.promo_percent = promo_percent
        self.history = history
        self.sampler = ZipfSampler(len(self.products), make_rng(seed, "orders-popularity"))
        self.used_numbers: set[str] = set()
        self.branch_cum = []
        total = 0.0
        for b in branches:
            total += 0.6 if b.is_default else 0.4 / max(1, len(branches) - 1)
            self.branch_cum.append(total)

    # -- helpers -------------------------------------------------------------------------------------
    def _number(self, placed: dt.datetime) -> str:
        rng = self.rng
        while True:
            number = "OR-" + placed.strftime("%y%m%d") + "-" + "".join(rng.choice(ORDER_ALPHABET) for _ in range(5))
            if number not in self.used_numbers:
                self.used_numbers.add(number)
                return number

    def _token(self, i: int) -> str:
        digest = hashlib.sha256(f"perf-token:{self.seed}:{i}".encode()).digest()
        return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:40]

    def _quantity(self, p: ProductPlan) -> Decimal:
        rng = self.rng
        if p.is_variable_weight:
            qty = q3(Decimal("0.25") * rng.choices(range(1, 9), weights=(14, 22, 16, 18, 8, 10, 6, 6))[0])
        else:
            qty = q3(rng.choices((1, 2, 3, 4, 5, 6), weights=(60, 24, 8, 4, 2, 2))[0])
        if p.qty_max is not None and qty > p.qty_max:
            qty = p.qty_max
        return max(qty, p.qty_min)

    def _line(self, p: ProductPlan) -> ItemPlan:
        qty = self._quantity(p)
        unit = p.price
        label = kind = ""
        params = None
        if p.category.promo and self.rng.random() < 0.6:
            unit = money(p.price * (Decimal(100) - self.promo_percent) / Decimal(100))
            label, kind, params = (
                f"{self.promo_percent.normalize():f}% off",
                "PERCENT_OFF",
                {"percent": str(self.promo_percent)},
            )
        return ItemPlan(p, qty, p.price, unit, label, kind, params, money(unit * qty))

    # -- the order ------------------------------------------------------------------------------------
    def plan(self, i: int, placed: dt.datetime) -> OrderPlan:
        rng = self.rng
        guest = rng.random() < P_GUEST_ORDER or not self.customers
        if guest:
            customer = None
            first, last = rng.choice(words.FIRST_NAMES), rng.choice(words.LAST_NAMES)
            name, email = f"{first} {last}", f"perf-guest-{i:06d}@perf.invalid"
            phone = f"+1 555 {rng.randint(200, 999)} {rng.randint(1000, 9999)}"
        else:
            customer = self.customers[int(len(self.customers) * rng.random() ** 1.3)]
            name, email, phone = customer.full_name, customer.email, customer.phone
        branch = self.branches[bisect.bisect_left(self.branch_cum, rng.random() * self.branch_cum[-1])]
        delivery = rng.random() < P_DELIVERY
        card = rng.random() < P_CARD
        fulfilment = "DELIVERY" if delivery else "PICKUP"
        method = "CARD" if card else "COD"
        zone = None
        ship: dict = {}
        if delivery:
            if branch.zones:
                zone = branch.zones[0] if rng.random() < 0.6 or len(branch.zones) == 1 else rng.choice(branch.zones)
            postal = (
                f"{zone.prefix} {rng.randint(1, 9)}{rng.choice('ABDEFGHJLNPQRSTUWXYZ')}{rng.choice('ABDEFGHJLNPQRSTUWXYZ')}"
                if zone
                else "RW1 1AA"
            )
            ship = {
                "ship_recipient": name,
                "ship_phone": phone,
                "ship_line1": f"{rng.randint(1, 199)} {rng.choice(words.STREETS)} Street",
                "ship_line2": f"Flat {rng.randint(1, 20)}" if rng.random() < 0.15 else "",
                "ship_city": "Riverton",
                "ship_area": zone.area if zone else "",
                "ship_postal_code": postal,
                "ship_instructions": "Leave with neighbour if out." if rng.random() < 0.05 else "",
            }

        # lines (popularity-weighted, distinct products)
        picks = self.sampler.draw(rng, rng.randint(3, 8))
        items = [self._line(self.products[k]) for k in picks]
        subtotal = money(sum((it.line_total_estimated for it in items), ZERO))
        promo_savings = money(sum((it.base_unit_price * it.qty - it.line_total_estimated for it in items), ZERO))
        fee = ZERO
        if zone is not None:
            fee = zone.fee
            if zone.free_threshold is not None and subtotal >= zone.free_threshold:
                fee = ZERO
        tax = ZERO
        for it in items:
            rate = it.product.tax_rate
            if rate:
                base = it.line_total_estimated
                tax += (
                    money(base * rate / (Decimal(100) + rate))
                    if self.store.prices_include_tax
                    else money(base * rate / Decimal(100))
                )
        tax = money(tax)
        total = money(subtotal + fee + (ZERO if self.store.prices_include_tax else tax))
        vw_total = sum((it.line_total_estimated for it in items if it.product.is_variable_weight), ZERO)
        authorized = money(total + money(vw_total * self.store.weight_tolerance_percent / Decimal(100)))

        # slot window (local time, 2h, 08:00-20:00), then state at the anchor
        local = placed.astimezone(self.tz) + dt.timedelta(minutes=rng.randint(150, 2400))
        if local.hour < 8:
            local = local.replace(hour=8)
        elif local.hour > 19:
            local = (local + dt.timedelta(days=1)).replace(hour=9)
        slot_start = local.replace(minute=0, second=0, microsecond=0).astimezone(dt.UTC)
        slot_end = slot_start + dt.timedelta(hours=2)

        number = self._number(placed)
        order = OrderPlan(
            index=i,
            number=number,
            tracking_token=self._token(i),
            checkout_key=f"perf-co-{i:08d}",
            customer=customer,
            contact_name=name,
            contact_email=email,
            contact_phone=phone,
            branch=branch,
            zone=zone,
            fulfilment_type=fulfilment,
            payment_method=method,
            substitution_policy=rng.choices(("ALLOW", "CONTACT", "NONE"), weights=(60, 25, 15))[0],
            customer_note="Please pack cold items together." if rng.random() < 0.05 else "",
            ship=ship,
            placed_at=placed,
            slot_starts_at=slot_start,
            slot_ends_at=slot_end,
            status="CONFIRMED",
            payment_status="UNPAID",
            items=items,
            subtotal=subtotal,
            promo_savings=promo_savings,
            delivery_fee=fee,
            tax_total=tax,
            total=total,
            authorized_amount=authorized,
            final_total=None,
            currency=self.store.currency,
        )
        self._lifecycle(order)
        return order

    # -- state machine --------------------------------------------------------------------------------
    def _final_status(self, o: OrderPlan) -> str:
        rng, anchor = self.rng, self.anchor
        card = o.payment_method == "CARD"
        delivery = o.fulfilment_type == "DELIVERY"
        ready = "READY_FOR_DISPATCH" if delivery else "READY_FOR_PICKUP"
        if o.slot_ends_at <= anchor - dt.timedelta(hours=2):
            r = rng.random()
            if r < 0.935:
                return "COMPLETED"
            if r < 0.98:
                return "CANCELLED"
            return "PAYMENT_FAILED" if card else "CANCELLED"
        if card and anchor - o.placed_at < dt.timedelta(minutes=12) and rng.random() < 0.5:
            return "PENDING_PAYMENT"
        if o.slot_starts_at > anchor + dt.timedelta(hours=3):
            return "CONFIRMED" if rng.random() < 0.93 else "CANCELLED"
        if o.slot_starts_at > anchor - dt.timedelta(minutes=30):
            return rng.choices(("PICKING", "PACKING", "CONFIRMED", ready), weights=(40, 30, 20, 10))[0]
        if delivery:
            return rng.choices(
                ("OUT_FOR_DELIVERY", ready, "PACKING", "COMPLETED", "CANCELLED"), weights=(45, 20, 10, 20, 5)
            )[0]
        return rng.choices((ready, "COMPLETED", "CANCELLED"), weights=(65, 30, 5))[0]

    def _lifecycle(self, o: OrderPlan) -> None:  # noqa: C901
        rng, anchor = self.rng, self.anchor
        card = o.payment_method == "CARD"
        delivery = o.fulfilment_type == "DELIVERY"
        final = self._final_status(o)
        o.status = final
        ready_status = "READY_FOR_DISPATCH" if delivery else "READY_FOR_PICKUP"

        def clamp(ts: dt.datetime) -> dt.datetime:
            return min(ts, anchor)

        t_conf = o.placed_at + (dt.timedelta(seconds=rng.randint(30, 150)) if card else dt.timedelta(0))
        t_pick = max(t_conf + dt.timedelta(minutes=10), o.slot_starts_at - dt.timedelta(minutes=rng.randint(60, 200)))
        t_pack = t_pick + dt.timedelta(minutes=rng.randint(15, 50))
        t_ready = t_pack + dt.timedelta(minutes=rng.randint(2, 12))
        if delivery:
            t_dispatch = max(t_ready, o.slot_starts_at - dt.timedelta(minutes=15)) + dt.timedelta(
                minutes=rng.randint(0, 15)
            )
            t_done = t_dispatch + dt.timedelta(minutes=rng.randint(10, 75))
        else:
            t_dispatch = None
            t_done = max(t_ready, o.slot_starts_at) + dt.timedelta(minutes=rng.randint(5, 100))
        if rng.random() < 0.07:  # a late finish
            t_done += dt.timedelta(minutes=rng.randint(25, 60))

        ladder = (
            ["CONFIRMED", "PICKING", "PACKING", ready_status]
            + (["OUT_FOR_DELIVERY"] if delivery else [])
            + ["COMPLETED"]
        )
        stamps = {
            "CONFIRMED": t_conf,
            "PICKING": t_pick,
            "PACKING": t_pack,
            ready_status: t_ready,
            "OUT_FOR_DELIVERY": t_dispatch,
            "COMPLETED": t_done,
        }
        reached: list[str]
        if final in ladder:
            reached = ladder[: ladder.index(final) + 1]
        elif final == "CANCELLED":
            stage = rng.choices(("PENDING_PAYMENT", "CONFIRMED", "PICKING"), weights=(10 if card else 0, 70, 20))[0]
            if o.slot_ends_at > anchor:  # cancelled while the slot is still ahead: it cannot be later than "now"
                stage = rng.choice(("PENDING_PAYMENT" if card else "CONFIRMED", "CONFIRMED"))
            reached = [] if stage == "PENDING_PAYMENT" else ladder[: ladder.index(stage) + 1]
            horizon = stamps[stage] if stage != "PENDING_PAYMENT" else o.placed_at + dt.timedelta(minutes=5)
            o.cancelled_at = clamp(horizon + dt.timedelta(minutes=rng.randint(1, 30)))
            o.cancel_reason = rng.choice(words.CANCEL_REASONS)
        else:  # PENDING_PAYMENT or PAYMENT_FAILED
            reached = []

        # timestamps on the order row
        if "CONFIRMED" in reached:
            o.confirmed_at = clamp(t_conf)
        if "PICKING" in reached:
            o.picking_started_at = clamp(t_pick)
        if ready_status in reached:
            o.packed_at, o.ready_at = clamp(t_pack), clamp(t_ready)
        if "OUT_FOR_DELIVERY" in reached:
            o.dispatched_at = clamp(t_dispatch)
        if final == "COMPLETED":
            o.completed_at = clamp(t_done)
        if card and final in ("PENDING_PAYMENT", "PAYMENT_FAILED"):
            o.reservation_expires_at = o.placed_at + dt.timedelta(minutes=PAYMENT_WINDOW_MINUTES)
        last = max(
            (
                ts
                for ts in (
                    o.confirmed_at,
                    o.picking_started_at,
                    o.packed_at,
                    o.ready_at,
                    o.dispatched_at,
                    o.completed_at,
                    o.cancelled_at,
                )
                if ts
            ),
            default=o.placed_at,
        )
        o.updated_at = last

        # history rows (mirror what the real checkout + state machine write)
        if self.history:
            actor = o.contact_email if o.customer else "guest"
            first = "PENDING_PAYMENT" if card else "CONFIRMED"
            h = o.history
            h.append(HistoryPlan("", first, o.placed_at, actor, "Order placed"))
            if card and "CONFIRMED" in reached:
                h.append(
                    HistoryPlan(
                        "PENDING_PAYMENT", "CONFIRMED", clamp(t_conf), "system", "Payment received - order confirmed"
                    )
                )
            prev = "CONFIRMED"
            for step in reached[1:]:
                h.append(HistoryPlan(prev, step, clamp(stamps[step]), "perf-staff", ""))
                prev = step
            if final == "CANCELLED":
                h.append(HistoryPlan(prev if reached else first, "CANCELLED", o.cancelled_at, actor, o.cancel_reason))
            elif final == "PAYMENT_FAILED":
                h.append(
                    HistoryPlan(
                        "PENDING_PAYMENT", "PAYMENT_FAILED", o.reservation_expires_at, "system", "Payment not completed"
                    )
                )

        self._items_and_money(o, final)
        self._payment(o, final)

    def _items_and_money(self, o: OrderPlan, final: str) -> None:
        rng = self.rng
        picked_stage = {"PACKING", "READY_FOR_PICKUP", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "COMPLETED"}
        if final not in picked_stage and final != "PICKING":
            return
        for k, it in enumerate(o.items):
            p = it.product
            if final == "PICKING" and k >= len(o.items) // 2:
                continue
            roll = rng.random()
            if final == "COMPLETED" and roll < 0.015:
                it.status, it.picked_qty, it.line_total_final = "UNAVAILABLE", ZERO, Decimal("0.00")
            elif final == "COMPLETED" and roll < 0.035 and it.qty > p.qty_min:
                picked = q3(it.qty - p.qty_step)
                it.status, it.picked_qty = "SHORT", picked
                it.line_total_final = money(it.unit_price * picked)
            else:
                picked = it.qty
                if p.is_variable_weight:
                    picked = q3(it.qty * Decimal(str(round(rng.uniform(0.96, 1.04), 4))))
                it.status, it.picked_qty = "PICKED", picked
                it.line_total_final = money(it.unit_price * picked)
            it.picked_at = min(
                (o.picking_started_at or o.placed_at) + dt.timedelta(minutes=rng.randint(1, 30)), self.anchor
            )
        if final == "COMPLETED":
            lines = sum((it.line_total_final or ZERO for it in o.items), ZERO)
            o.final_total = money(lines + o.delivery_fee + (ZERO if self.store.prices_include_tax else o.tax_total))
            if any(it.product.is_variable_weight for it in o.items):
                o.weights_finalized_at = o.ready_at

    def _payment(self, o: OrderPlan, final: str) -> None:
        rng = self.rng
        card = o.payment_method == "CARD"
        amount = o.authorized_amount
        pay = {
            "provider": "demo" if card else "cod",
            "method": o.payment_method,
            "amount": amount,
            "captured": ZERO,
            "refunded": ZERO,
            "reference": f"perf_{o.number}" if card else "",
            "attempt": 1,
            "failure_code": "",
            "failure_message": "",
            "captured_at": None,
            "updated_at": o.updated_at or o.placed_at,
        }
        if final == "PENDING_PAYMENT":
            pay["state"], o.payment_status = "REQUIRES_ACTION", "UNPAID"
        elif final == "PAYMENT_FAILED":
            pay["state"], o.payment_status = "FAILED", "FAILED"
            pay["failure_code"], pay["failure_message"] = "card_declined", "The card was declined (perf seed)."
            pay["updated_at"] = o.reservation_expires_at
        elif final == "CANCELLED":
            if card and o.confirmed_at:
                pay["state"], o.payment_status = "VOIDED", "VOIDED"
            else:
                pay["state"], o.payment_status = "CANCELLED", "UNPAID"
            pay["updated_at"] = o.cancelled_at
        elif final == "COMPLETED":
            captured = min(o.final_total or o.total, amount)
            pay["captured"] = captured
            pay["state"], o.payment_status = "CAPTURED", "PAID"
            pay["captured_at"] = (o.ready_at or o.completed_at) if card else o.completed_at
            if card and captured > Decimal("5.00") and rng.random() < 0.03:
                refunded = money(captured * Decimal(str(round(rng.uniform(0.05, 0.5), 3))))
                refunded = max(Decimal("0.01"), min(refunded, captured))
                pay["refunded"] = refunded
                pay["state"], o.payment_status = "PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED"
                done = min((o.completed_at or o.placed_at) + dt.timedelta(hours=rng.randint(1, 48)), self.anchor)
                o.refund = {"amount": refunded, "completed_at": done, "reason": "Item quality complaint (perf seed)"}
                pay["updated_at"] = done
        else:  # an open order
            if card:
                pay["state"], o.payment_status = "AUTHORIZED", "AUTHORIZED"
            else:
                pay["state"], o.payment_status = "PENDING_COLLECTION", "PENDING_COLLECTION"
        o.payment = pay
