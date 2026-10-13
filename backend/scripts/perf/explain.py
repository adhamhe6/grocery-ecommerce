#!/usr/bin/env python
"""EXPLAIN (ANALYZE, BUFFERS) the real queries behind Orchard Row's hottest operations and write a Markdown report.

    cd backend
    DJANGO_SETTINGS_MODULE=config.settings.dev DATABASE_URL=postgres://…/grocery_perf python scripts/perf/explain.py
    python scripts/perf/explain.py /tmp/plans.md --runs 5            # custom output path, more timed runs
    python scripts/perf/explain.py --only 3,8 --json /tmp/plans.json  # just search + dashboard, plus machine-readable output

The default report path is `<repo>/docs/perf-explain-<today>.md`.

What it measures (nothing is estimated; every number below comes from the database or from a stopwatch):
  1  product listing, default sort (page + count)        7  admin order queue / list with typical filters
  2  listing filtered by category+brand+price, + facets  8  dashboard aggregates (time + SQL list + EXPLAIN of the 3 slowest)
  3  text search (common word, prefix, typo)             9  expiry report (inventory/expiry + expiry-losses report)
  4  product detail incl. availability annotation       10  admin stock list
  5  search suggest                                     11  cart pricing load, 25 lines (`cart.services.load_lines`)
  6  customer order history

How: the real views / query classes are called IN-PROCESS (DRF's request factory, no HTTP, throttling disabled) while
Django records every SQL statement; each recorded SELECT is then run through `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`.
Queryset-shaped primary statements use `QuerySet.explain(analyze=True, buffers=True)` directly. Every statement is run
once as a warm-up and then `--runs` timed times; the plan shown is the median run.

This script NEVER modifies data: the session is opened with default_transaction_read_only=on, so an accidental write
would fail loudly. It uses an in-process cache (REDIS_URL is forced empty) so shared Redis is never touched and each
operation starts with a cold application cache. EXPLAIN ANALYZE really executes the queries - run it when the database
is otherwise quiet, and read the dataset-size warning at the top of the report before trusting any plan.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import statistics
import sys
import time
import traceback
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
os.environ["REDIS_URL"] = ""  # in-process cache only: cold start per operation, shared Redis never touched

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.contrib.auth.models import AnonymousUser  # noqa: E402
from django.core.cache import cache  # noqa: E402
from django.db import connection  # noqa: E402
from django.db.models import Count  # noqa: E402
from django.http import QueryDict  # noqa: E402
from django.test.utils import CaptureQueriesContext  # noqa: E402
from django.utils import timezone  # noqa: E402
from rest_framework.test import APIRequestFactory, force_authenticate  # noqa: E402
from rest_framework.throttling import SimpleRateThrottle  # noqa: E402

# read-only session, set before the first connection is opened (re-applied on every reconnect)
connection.settings_dict.setdefault("OPTIONS", {})["options"] = "-c default_transaction_read_only=on"
SimpleRateThrottle.allow_request = lambda self, request, view: True  # in-process calls must not trip rate limits

from apps.accounts.models import User  # noqa: E402
from apps.catalog.models import Product, ProductStatus  # noqa: E402
from apps.catalog.queries import ProductQuery, ProductQuerySerializer  # noqa: E402
from apps.catalog.views import (  # noqa: E402
    ProductDetailView,
    ProductListView,
    SuggestView,
    default_branch_id,
)
from apps.core.middleware import store_timezone  # noqa: E402
from apps.inventory.admin_api import ExpiryView, StockViewSet  # noqa: E402
from apps.orders.admin_api import OrderAdminViewSet  # noqa: E402
from apps.orders.models import Order  # noqa: E402
from apps.orders.views import OrderListView  # noqa: E402
from apps.promotions.engine import load_index  # noqa: E402
from apps.reports import queries as report_queries  # noqa: E402

BIG_TABLE_ROWS = 10_000  # a table above this size is "big"; a seq scan reading more rows than this is flagged
KEY_TABLES = [
    "catalog_product",
    "catalog_productimage",
    "catalog_brand",
    "catalog_category",
    "inventory_stocklevel",
    "inventory_batch",
    "inventory_stockmovement",
    "orders_order",
    "orders_orderitem",
    "orders_orderstatushistory",
    "payments_payment",
    "payments_refund",
    "accounts_user",
    "cart_cart",
    "cart_cartitem",
    "stores_deliveryslot",
    "promotions_promotion",
]
EXPLAIN_PREFIX = re.compile(r"^\s*EXPLAIN\s*\([^)]*\)\s*", re.I)


# ---------------------------------------------------------------------------------------------- plan parsing
@dataclass
class Scan:
    kind: str
    table: str
    index: str
    rows: float  # rows returned per loop x loops
    removed: float  # rows discarded by the filter per loop x loops
    loops: int

    @property
    def scanned(self) -> float:
        return self.rows + self.removed

    @property
    def is_seq(self) -> bool:
        return "Seq Scan" in self.kind


@dataclass
class Plan:
    text: str
    execution_ms: float | None
    planning_ms: float | None
    scans: list[Scan]
    buffers: str  # root node "Buffers:" line
    jit: bool


SCAN_RE = re.compile(
    r"(?P<kind>(?:Parallel )?(?:Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan|Bitmap Index Scan|Tid Scan|"
    r"CTE Scan|Function Scan|Subquery Scan))(?: Backward)?(?: using (?P<index>\S+))?(?: on (?P<table>\S+))?"
)
ACTUAL_RE = re.compile(r"\(actual time=[\d.]+\.\.[\d.]+ rows=(?P<rows>[\d.]+) loops=(?P<loops>\d+)\)")
REMOVED_RE = re.compile(r"Rows Removed by (?:Filter|Index Recheck): (?P<n>\d+)")


def parse_plan(text: str) -> Plan:
    scans: list[Scan] = []
    last: tuple[Scan, int] | None = None
    buffers, execution, planning, jit = "", None, None, False
    for line in text.splitlines():
        indent = len(line) - len(line.lstrip())
        if (m := re.search(r"Execution Time: ([\d.]+) ms", line)) is not None:
            execution = float(m.group(1))
        elif (m := re.search(r"Planning Time: ([\d.]+) ms", line)) is not None:
            planning = float(m.group(1))
        elif line.strip().startswith("JIT:"):
            jit = True
        elif line.strip().startswith("Buffers:") and not buffers:
            buffers = line.strip()
        removed = REMOVED_RE.search(line)
        if removed and last is not None and indent > last[1]:
            scan = last[0]
            scan.removed += float(removed.group("n")) * scan.loops
            continue
        node = SCAN_RE.search(line)
        if "(cost=" in line and node:
            actual = ACTUAL_RE.search(line)
            loops = int(actual.group("loops")) if actual else 0
            rows = float(actual.group("rows")) * loops if actual else 0.0
            kind = node.group("kind")
            index, table = node.group("index") or "", node.group("table") or ""
            if kind == "Bitmap Index Scan":
                index, table = table, ""
            scan = Scan(kind, table, index, rows, 0.0, loops)
            scans.append(scan)
            last = (scan, indent)
    return Plan(text, execution, planning, scans, buffers, jit)


# ---------------------------------------------------------------------------------------------- statements
@dataclass
class Stmt:
    label: str
    sql: str
    plan: Plan | None = None
    first_ms: float | None = None  # warm-up run
    timed_ms: list[float] = field(default_factory=list)
    django_ms: float | None = None  # as measured by Django's query log during the in-process view call
    always_detail: bool = False  # primary statements always get their full plan in the report
    error: str = ""

    @property
    def median_ms(self) -> float | None:
        return statistics.median(self.timed_ms) if self.timed_ms else self.first_ms

    def flagged(self) -> list[Scan]:
        return [s for s in (self.plan.scans if self.plan else []) if s.is_seq and s.scanned > BIG_TABLE_ROWS]


@dataclass
class Operation:
    key: str
    title: str
    what: str
    stmts: list[Stmt] = field(default_factory=list)
    view_cold_ms: list[float] = field(default_factory=list)  # in-process wall time, first call (cold app cache)
    view_warm_ms: list[float] = field(default_factory=list)  # in-process wall time, later calls (warm app cache)
    n_queries: int = 0
    sql_total_ms: float = 0.0
    notes: list[str] = field(default_factory=list)
    error: str = ""


def strip_explain(sql: str) -> str:
    return EXPLAIN_PREFIX.sub("", sql, count=1).strip()


def normalise(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def top_level_table(s: str) -> str:
    """The table of the outermost FROM (skips sub-selects, e.g. EXISTS(...) in the select list)."""
    depth, in_str = 0, False
    for i, ch in enumerate(s):
        if ch == "'":
            in_str = not in_str
        elif in_str:
            continue
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and s.startswith(' FROM "', i):
            m = re.match(r' FROM "([a-z_]+)"', s[i:])
            if m:
                return m.group(1)
    return "?"


def describe(sql: str) -> str:
    s = normalise(sql)
    first = top_level_table(s)
    if first == "?" and " FROM (" in s:
        first = "subquery of " + top_level_table(s[s.index(" FROM (") + 7 :])
    kind = (
        "count" if s.upper().startswith("SELECT COUNT(*)") else ("aggregate" if "GROUP BY" in s.upper() else "select")
    )
    extra = " (prefetch)" if re.search(r'WHERE "[a-z_]+"\."[a-z_]+" IN \(', s) and kind == "select" else ""
    return f"{kind} from {first}{extra}"


class Runner:
    def __init__(self, runs: int):
        self.runs = runs
        self.explained: set[str] = set()

    def _timed(self, run_once) -> tuple[Plan | None, float | None, list[float]]:
        """Warm-up once, then `runs` timed runs; return the median run's plan."""
        first = run_once()
        plans = [run_once() for _ in range(self.runs)]
        timed = [p.execution_ms for p in plans if p.execution_ms is not None]
        if not plans:
            return first, first.execution_ms, []
        order = sorted(plans, key=lambda p: p.execution_ms or 0.0)
        return order[len(order) // 2], first.execution_ms, timed

    def explain_sql(self, label: str, sql: str, django_ms: float | None = None) -> Stmt:
        stmt = Stmt(label, sql, django_ms=django_ms)

        def once() -> Plan:
            with connection.cursor() as cur:
                cur.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + sql)
                return parse_plan("\n".join(r[0] for r in cur.fetchall()))

        try:
            stmt.plan, stmt.first_ms, stmt.timed_ms = self._timed(once)
        except Exception as exc:  # noqa: BLE001 - report and carry on with the other statements
            stmt.error = f"{type(exc).__name__}: {exc}"
        self.explained.add(normalise(sql))
        return stmt

    def explain_queryset(self, label: str, qs) -> Stmt:
        """Primary statements: Django's own QuerySet.explain(analyze=True, buffers=True)."""
        with CaptureQueriesContext(connection) as ctx:
            first_text = qs.explain(analyze=True, buffers=True)
        sql = strip_explain(ctx.captured_queries[-1]["sql"])
        stmt = Stmt(label, sql, django_ms=float(ctx.captured_queries[-1]["time"]) * 1000, always_detail=True)
        try:
            plans = [parse_plan(first_text)] + [
                parse_plan(qs.explain(analyze=True, buffers=True)) for _ in range(self.runs)
            ]
            stmt.first_ms = plans[0].execution_ms
            timed = plans[1:]
            stmt.timed_ms = [p.execution_ms for p in timed if p.execution_ms is not None]
            ranked = sorted(timed or plans, key=lambda p: p.execution_ms or 0.0)
            stmt.plan = ranked[len(ranked) // 2]
        except Exception as exc:  # noqa: BLE001
            stmt.error = f"{type(exc).__name__}: {exc}"
        self.explained.add(normalise(sql))
        return stmt


def selects(captured) -> list[dict]:
    out = []
    for q in captured:
        sql = q["sql"].strip()
        if sql.upper().startswith(("SELECT", "WITH")):
            out.append(q)
    return out


def explain_count(runner: Runner, label: str, qs) -> Stmt:
    """The COUNT(*) DRF's paginator issues for `qs`."""
    with CaptureQueriesContext(connection) as cap:
        qs.count()
    q = cap.captured_queries[-1]
    stmt = runner.explain_sql(label, q["sql"], float(q["time"]) * 1000)
    stmt.always_detail = True
    return stmt


# ---------------------------------------------------------------------------------------------- calling real views
FACTORY = APIRequestFactory()


def call(view, path="/", params=None, user=None, **kwargs):
    request = FACTORY.get(path, params or {})
    if user is not None:
        force_authenticate(request, user=user)
    with timezone.override(store_timezone()):
        response = view(request, **kwargs)
        response.render()
    if response.status_code != 200:
        raise RuntimeError(f"{path} returned HTTP {response.status_code}: {response.content[:200]!r}")
    return response


def profile_call(
    runner: Runner, op: Operation, fn, *, skip_explained=True, explain_all=True, clear_cache=True
) -> list[dict]:
    """Run `fn` once with SQL capture (cold app cache), then time it `runs` more times (warm). Returns captured SELECTs."""
    if clear_cache:
        cache.clear()
    with CaptureQueriesContext(connection) as ctx:
        t0 = time.perf_counter()
        fn()
        first = (time.perf_counter() - t0) * 1000
    captured = selects(ctx.captured_queries)
    op.n_queries = len(ctx.captured_queries)
    op.sql_total_ms = sum(float(q["time"]) for q in ctx.captured_queries) * 1000
    op.view_cold_ms = [first]
    op.view_warm_ms = []
    for _ in range(runner.runs):
        if clear_cache:
            cache.clear()
        t0 = time.perf_counter()
        fn()
        op.view_warm_ms.append((time.perf_counter() - t0) * 1000)
    if explain_all:
        seen: set[str] = set()
        for q in captured:
            key = normalise(q["sql"])
            if key in seen or (skip_explained and key in runner.explained):
                continue
            seen.add(key)
            op.stmts.append(runner.explain_sql(describe(q["sql"]), q["sql"], float(q["time"]) * 1000))
    return captured


# ---------------------------------------------------------------------------------------------- scenario discovery
class Context:
    """Read-only discovery of realistic parameters from the data itself (no hard-coded ids or slugs)."""

    def __init__(self):
        self.branch_id = default_branch_id()
        self.admin = User.objects.filter(role__in=["SUPER_ADMIN", "ADMIN"], is_active=True).order_by("id").first()
        active = Product.objects.filter(status=ProductStatus.ACTIVE, is_available=True)
        self.n_products = active.count()
        # category with the most products, its top brand and its inter-quartile price range
        top = active.values("category__slug").annotate(n=Count("id")).order_by("-n", "category__slug").first()
        self.category = top["category__slug"] if top else None
        in_cat = active.filter(category__slug=self.category) if self.category else active.none()
        brands = (
            in_cat.exclude(brand__isnull=True)
            .values("brand__slug")
            .annotate(n=Count("id"))
            .order_by("-n", "brand__slug")[:2]
        )
        self.brands = [b["brand__slug"] for b in brands]
        prices = sorted(in_cat.values_list("price", flat=True))
        self.price_min = prices[len(prices) // 4] if prices else Decimal("0")
        self.price_max = prices[(3 * len(prices)) // 4] if prices else Decimal("100")
        names = list(active.order_by("id").values_list("name", flat=True)[:4000])
        freq = Counter(w for n in names for w in re.findall(r"[a-z]{4,}", n.lower()))
        ranked = [w for w, _ in freq.most_common()]
        self.common = ranked[min(5, len(ranked) - 1)] if ranked else "milk"
        longer = [w for w in ranked if len(w) >= 6] or [self.common]
        word = longer[min(3, len(longer) - 1)]
        self.prefix = word[:4]  # what a shopper has typed after four keystrokes
        t = list(word)
        t[1], t[2] = t[2], t[1]
        self.typo = "".join(t)  # a transposition typo, only the trigram branch can still match it
        popular = active.order_by("-popularity", "id")
        self.detail_plain = popular.filter(tracks_batches=False).values_list("slug", flat=True).first()
        self.detail_batch = popular.filter(tracks_batches=True).values_list("slug", flat=True).first()
        heavy = (
            Order.objects.filter(customer__isnull=False)
            .values("customer")
            .annotate(n=Count("id"))
            .order_by("-n")
            .first()
        )
        self.customer = User.objects.filter(pk=heavy["customer"]).first() if heavy else None
        self.customer_orders = heavy["n"] if heavy else 0
        pool = list(popular.filter(stock_mode="TRACKED").values_list("id", flat=True)[:400])
        self.cart_product_ids = pool[:: max(1, len(pool) // 25)][:25]


# ---------------------------------------------------------------------------------------------- operations
def listing_params(**kw) -> dict:
    data = QueryDict(mutable=True)
    for k, v in kw.items():
        data[k] = v
    ser = ProductQuerySerializer(data=data)
    ser.is_valid(raise_exception=True)
    return ser.validated_data


def merge(op: Operation, sub: Operation) -> None:
    op.stmts.extend(sub.stmts)
    op.n_queries += sub.n_queries
    op.sql_total_ms += sub.sql_total_ms
    op.view_cold_ms += sub.view_cold_ms
    op.view_warm_ms += sub.view_warm_ms


def op_listing(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "1",
        "Product listing, default sort",
        "`GET /api/v1/products/` (no filters, sort=relevance → popularity, name), page 1 of 24",
    )
    pq = ProductQuery(listing_params(), load_index(), ctx.branch_id)
    op.stmts.append(runner.explain_queryset("page query (LIMIT 24)", pq.listing()[:24]))
    op.stmts.append(explain_count(runner, "pagination count", pq.listing()))
    profile_call(runner, op, lambda: call(ProductListView.as_view(), "/api/v1/products/"))
    return op


def op_filtered(runner: Runner, ctx: Context) -> Operation:
    params = {"sort": "relevance", "facets": "true", "price_min": str(ctx.price_min), "price_max": str(ctx.price_max)}
    if ctx.category:
        params["category"] = ctx.category
    if ctx.brands:
        params["brand"] = ",".join(ctx.brands)
    query = "&".join(f"{k}={v}" for k, v in params.items())
    op = Operation(
        "2", "Listing filtered by category + brand + price range, with facets", f"`GET /api/v1/products/?{query}`"
    )
    pq = ProductQuery(listing_params(**params), load_index(), ctx.branch_id)
    op.stmts.append(runner.explain_queryset("page query (LIMIT 24)", pq.listing()[:24]))
    op.stmts.append(explain_count(runner, "pagination count", pq.listing()))
    profile_call(runner, op, lambda: call(ProductListView.as_view(), "/api/v1/products/", params))
    return op


def op_search(runner: Runner, ctx: Context, term: str, label: str, key: str) -> Operation:
    op = Operation(
        key,
        f"Text search: {label}",
        f"`GET /api/v1/products/?q={term}` - `apps/catalog/search.py::apply_search` (prefix tsquery OR trigram similarity OR exact SKU/barcode), ranked",
    )
    pq = ProductQuery(listing_params(q=term), load_index(), ctx.branch_id)
    op.stmts.append(runner.explain_queryset(f"page query q={term!r} (LIMIT 24)", pq.listing()[:24]))
    op.stmts.append(explain_count(runner, f"pagination count q={term!r}", pq.listing()))
    profile_call(runner, op, lambda: call(ProductListView.as_view(), "/api/v1/products/", {"q": term}))
    return op


def op_detail(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "4",
        "Product detail incl. availability annotation",
        "`GET /api/v1/products/<slug>/`: product + availability subqueries + prefetches + 6 related products",
    )
    for kind, slug in (("batch-tracked", ctx.detail_batch), ("plain stock level", ctx.detail_plain)):
        if not slug:
            op.notes.append(f"no {kind} product found; skipped")
            continue
        sub = Operation("4", "", "")
        profile_call(runner, sub, lambda s=slug: call(ProductDetailView.as_view(), f"/api/v1/products/{s}/", slug=s))
        for st in sub.stmts:
            st.label = f"[{kind}] {st.label}"
        merge(op, sub)
        op.notes.append(
            f"{kind} product `{slug}`: {sub.n_queries} queries, {sub.sql_total_ms:.1f} ms SQL (Django-measured), view median {statistics.median(sub.view_warm_ms):.1f} ms warm"
        )
    return op


def op_suggest(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "5",
        "Search suggest",
        f"`GET /api/v1/search/suggest/?q={ctx.prefix}` (result cache cleared before every call so the SQL really runs)",
    )
    profile_call(runner, op, lambda: call(SuggestView.as_view(), "/api/v1/search/suggest/", {"q": ctx.prefix}))
    return op


def op_order_history(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "6",
        "Customer order history",
        "`GET /api/v1/orders/` (`apps/orders/views.py::OrderListView`): heaviest customer in the data set, page 1 of 10",
    )
    if ctx.customer is None:
        op.error = "no customer with orders found"
        return op
    op.notes.append(
        f"customer `{ctx.customer.email}` has {ctx.customer_orders} orders (the heaviest in the data set - a worst case, not an average)"
    )
    profile_call(runner, op, lambda: call(OrderListView.as_view(), "/api/v1/orders/", user=ctx.customer))
    return op


def op_admin_orders(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "7",
        "Admin order queue / list",
        "`OrderAdminViewSet.list` and `.queue` (`apps/orders/admin_api.py`) with typical filters",
    )
    if ctx.admin is None:
        op.error = "no ADMIN/SUPER_ADMIN user found (run seed_demo)"
        return op
    branch = str(ctx.branch_id) if ctx.branch_id else ""
    scenarios = [
        ("default list (no filters)", "list", {}),
        (
            "filters: status=CONFIRMED,PICKING,PACKING + branch",
            "list",
            {"status": "CONFIRMED,PICKING,PACKING", "branch": branch},
        ),
        (
            "filters: placed in the last 7 days + payment_status=PAID",
            "list",
            {"placed_from": str(dt.date.today() - dt.timedelta(days=7)), "payment_status": "PAID"},
        ),
        ("search by customer e-mail fragment (icontains on 4 columns)", "list", {"search": "perf-user-0001"}),
        ("fulfilment queue (`/admin/orders/queue/`)", "queue", {}),
    ]
    for title, action, params in scenarios:
        sub = Operation("7", "", "")
        view = OrderAdminViewSet.as_view({"get": action})
        path = "/api/v1/admin/orders/" + ("queue/" if action == "queue" else "")
        try:
            profile_call(runner, sub, lambda v=view, p=path, q=params: call(v, p, q, user=ctx.admin))
        except Exception as exc:  # noqa: BLE001
            op.notes.append(f"{title}: FAILED {exc}")
            continue
        for st in sub.stmts:
            st.label = f"[{title}] {st.label}"
        merge(op, sub)
        op.notes.append(
            f"{title}: view median {statistics.median(sub.view_warm_ms):.1f} ms in-process (warm), {sub.n_queries} queries"
        )
    return op


def op_dashboard(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "8",
        "Dashboard aggregates",
        "`apps/reports/queries.py::dashboard(Period(last 30 days), branches=None)`: the function behind `GET /api/v1/admin/dashboard/` (the view caches it for 120 s; this measures the uncached cost)",
    )
    period = report_queries.Period(None, None)
    with timezone.override(store_timezone()):
        cache.clear()
        per_sql: dict[str, list[float]] = {}
        sql_by_key: dict[str, str] = {}
        walls = []
        for i in range(runner.runs + 1):
            with CaptureQueriesContext(connection) as cap:
                t0 = time.perf_counter()
                report_queries.dashboard(period, None)
                walls.append((time.perf_counter() - t0) * 1000)
            if i == 0:
                op.n_queries = len(cap.captured_queries)
                op.sql_total_ms = sum(float(q["time"]) for q in cap.captured_queries) * 1000
            for q in selects(cap.captured_queries):
                key = normalise(q["sql"])
                sql_by_key[key] = q["sql"]
                per_sql.setdefault(key, []).append(float(q["time"]) * 1000)
    op.view_cold_ms, op.view_warm_ms = walls[:1], walls[1:]
    ranked = sorted(per_sql.items(), key=lambda kv: -statistics.median(kv[1]))
    op.notes.append(
        f"{op.n_queries} SQL statements per call; Django-measured SQL time {op.sql_total_ms:.1f} ms of {walls[0]:.1f} ms wall (first call)"
    )
    table = ["| rank | median ms (Django) | statement |", "|---|---|---|"]
    for n, (key, times) in enumerate(ranked[:12], 1):
        table.append(f"| {n} | {statistics.median(times):.1f} | {describe(key)} |")
    op.notes.append(
        "Slowest statements by Django-measured median time (EXPLAIN ANALYZE of the top 3 follows):\n\n"
        + "\n".join(table)
    )
    for rank, (key, times) in enumerate(ranked[:3], 1):
        stmt = runner.explain_sql(f"slowest #{rank}: {describe(key)}", sql_by_key[key], statistics.median(times))
        stmt.always_detail = True
        op.stmts.append(stmt)
    return op


def op_expiry(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "9",
        "Expiry report",
        "`GET /api/v1/admin/inventory/expiry/` (`ExpiryView`) and the `expiry-losses` report (`reports/queries.py::report_expiry_losses`)",
    )
    if ctx.admin is None:
        op.error = "no ADMIN/SUPER_ADMIN user found (run seed_demo)"
        return op
    profile_call(runner, op, lambda: call(ExpiryView.as_view(), "/api/v1/admin/inventory/expiry/", user=ctx.admin))
    sub = Operation("9", "", "")
    period = report_queries.Period(None, None)

    def losses():
        with timezone.override(store_timezone()):
            report_queries.report_expiry_losses(period, None)

    profile_call(runner, sub, losses)
    for st in sub.stmts:
        st.label = f"[expiry-losses report] {st.label}"
    merge(op, sub)
    op.notes.append(
        f"expiry-losses report: {sub.n_queries} queries, function median {statistics.median(sub.view_warm_ms):.1f} ms warm"
    )
    return op


def op_stock(runner: Runner, ctx: Context) -> Operation:
    op = Operation(
        "10",
        "Admin stock list",
        "`GET /api/v1/admin/inventory/stock/` (`StockViewSet`): joins products and a MAX over the movement ledger per row",
    )
    if ctx.admin is None:
        op.error = "no ADMIN/SUPER_ADMIN user found (run seed_demo)"
        return op
    branch = str(ctx.branch_id) if ctx.branch_id else ""
    scenarios = [
        ("default list (ordered by product name)", {}),
        ("branch filter + status=low_or_out", {"branch": branch, "status": "low_or_out"}),
        ("search by product name (icontains)", {"search": ctx.common}),
    ]
    for title, params in scenarios:
        sub = Operation("10", "", "")
        view = StockViewSet.as_view({"get": "list"})
        try:
            profile_call(
                runner, sub, lambda v=view, q=params: call(v, "/api/v1/admin/inventory/stock/", q, user=ctx.admin)
            )
        except Exception as exc:  # noqa: BLE001
            op.notes.append(f"{title}: FAILED {exc}")
            continue
        for st in sub.stmts:
            st.label = f"[{title}] {st.label}"
        merge(op, sub)
        op.notes.append(
            f"{title}: view median {statistics.median(sub.view_warm_ms):.1f} ms in-process (warm), {sub.n_queries} queries"
        )
    return op


class _FakeItems:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class _FakeCart:
    """Stands in for a saved Cart so the measurement needs no writes: `load_lines` only reads `cart.items.all()`."""

    def __init__(self, items):
        self.items = _FakeItems(items)
        self.coupon_code = ""
        self.substitution_policy = "ALLOW"
        self.notices: list = []
        self.branch_id = None
        self.user_id = None


def op_cart(runner: Runner, ctx: Context) -> Operation:
    from apps.cart import services as cart_services
    from apps.cart.models import CartItem

    op = Operation(
        "11",
        "Cart pricing load (25 lines)",
        "`apps/cart/services.py::load_lines(cart, branch_id)` for a 25-line basket of popular products, plus `build_cart_payload` (adds product-card serialisation)",
    )
    products = {p.id: p for p in Product.objects.filter(pk__in=ctx.cart_product_ids)}
    items = [
        CartItem(product_id=pid, quantity=products[pid].qty_min) for pid in ctx.cart_product_ids if pid in products
    ]
    op.notes.append(
        f"{len(items)} lines ({sum(1 for pid in ctx.cart_product_ids if pid in products and products[pid].tracks_batches)} batch-tracked, {sum(1 for pid in ctx.cart_product_ids if pid in products and products[pid].is_variable_weight)} variable-weight); the basket is an in-memory stand-in - nothing is written"
    )
    cart = _FakeCart(items)
    profile_call(runner, op, lambda: cart_services.load_lines(cart, ctx.branch_id))
    sub = Operation("11", "", "")
    request = FACTORY.get("/")
    request.user = AnonymousUser()
    profile_call(runner, sub, lambda: cart_services.build_cart_payload(cart, request, ctx.branch_id), explain_all=False)
    op.notes.append(
        f"build_cart_payload (load_lines + coupon/total maths + 25 product-card serialisations): {sub.n_queries} queries, in-process median {statistics.median(sub.view_warm_ms):.1f} ms warm"
    )
    return op


# ---------------------------------------------------------------------------------------------- report
def fmt_ms(v: float | None) -> str:
    return "-" if v is None else f"{v:,.2f}"


def environment_section(ctx: Context) -> tuple[list[str], dict]:
    lines: list[str] = []
    info: dict = {}
    with connection.cursor() as cur:
        cur.execute("SELECT version()")
        info["version"] = cur.fetchone()[0]
        settings_wanted = [
            "shared_buffers", "work_mem", "effective_cache_size", "maintenance_work_mem", "random_page_cost",
            "max_parallel_workers_per_gather", "jit", "track_io_timing", "synchronous_commit", "fsync",
        ]  # fmt: skip
        pg = {}
        for name in settings_wanted:
            cur.execute("SELECT current_setting(%s, true)", [name])
            pg[name] = cur.fetchone()[0]
        info["pg_settings"] = pg
        tables = []
        for t in KEY_TABLES:
            try:
                cur.execute("SELECT to_regclass(%s) IS NOT NULL", [t])
                if not cur.fetchone()[0]:
                    continue
                cur.execute(f'SELECT count(*) FROM "{t}"')  # noqa: S608 - fixed list of table names
                exact = cur.fetchone()[0]
                cur.execute(
                    "SELECT c.reltuples::bigint, pg_size_pretty(pg_total_relation_size(c.oid)), "
                    "coalesce(s.n_mod_since_analyze, 0), coalesce(s.last_analyze, s.last_autoanalyze) "
                    "FROM pg_class c LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid WHERE c.oid = to_regclass(%s)",
                    [t],
                )
                est, size, mods, analyzed = cur.fetchone()
                tables.append(
                    {"table": t, "rows": exact, "estimate": est, "size": size, "mods": mods, "analyzed": analyzed}
                )
            except Exception as exc:  # noqa: BLE001
                tables.append({"table": t, "rows": None, "error": str(exc)})
        info["tables"] = tables
    info["db_name"] = connection.settings_dict.get("NAME")
    lines.append(f"- **PostgreSQL:** {info['version']}")
    lines.append(
        f"- **Database:** `{info['db_name']}` on `{connection.settings_dict.get('HOST')}:{connection.settings_dict.get('PORT')}`; Django settings `{os.environ.get('DJANGO_SETTINGS_MODULE')}`, `DEBUG={settings.DEBUG}`"
    )
    lines.append(
        "- **`SHOW shared_buffers, work_mem`:** "
        + f"`shared_buffers = {pg['shared_buffers']}`, `work_mem = {pg['work_mem']}`"
    )
    lines.append(
        "- **Other planner-relevant settings:** "
        + ", ".join(f"`{k} = {v}`" for k, v in pg.items() if k not in ("shared_buffers", "work_mem"))
    )
    lines.append(f"- **Store timezone:** `{store_timezone()}`; default branch id `{ctx.branch_id}`")
    lines.append("")
    lines.append(
        "| table | rows (exact `count(*)`) | planner estimate | total size | modified since last analyze | last analyze |"
    )
    lines.append("|---|---:|---:|---:|---:|---|")
    for t in tables:
        if t["rows"] is None:
            lines.append(f"| `{t['table']}` | error | | | | {t.get('error', '')[:60]} |")
        else:
            lines.append(
                f"| `{t['table']}` | {t['rows']:,} | {t['estimate']:,} | {t['size']} | {t['mods']:,} | {t['analyzed'] or 'never'} |"
            )
    return lines, info


def caveats(info: dict) -> list[str]:
    rows = {t["table"]: t.get("rows") or 0 for t in info["tables"]}
    out = []
    if rows.get("catalog_product", 0) < BIG_TABLE_ROWS or rows.get("orders_order", 0) < BIG_TABLE_ROWS:
        out.append(
            f"**Dataset is small** (products {rows.get('catalog_product', 0):,}, orders {rows.get('orders_order', 0):,}; "
            f"the seq-scan flag threshold is {BIG_TABLE_ROWS:,} rows). With so few rows PostgreSQL correctly prefers sequential scans "
            "and sorts, so these plans and timings say nothing reliable about behaviour at production volume. "
            "Seed a large data set (`manage.py seed_perf`) and re-run before drawing conclusions."
        )
    stale = [
        t["table"]
        for t in info["tables"]
        if t.get("estimate") is not None and t["rows"] and abs(t["rows"] - t["estimate"]) > 0.2 * t["rows"]
    ]
    if stale:
        out.append(
            "Planner row estimates differ from the real row count by more than 20% for: "
            + ", ".join(f"`{t}`" for t in stale)
            + ". Statistics are stale - run `ANALYZE` before trusting plan choices."
        )
    out.append(
        "EXPLAIN ANALYZE executes each query for real (and adds instrumentation overhead). Timings are from a shared development machine unless you ran this on an idle host; compare ratios, not absolute values."
    )
    return out


def render(
    ops: list[Operation],
    env_lines: list[str],
    info: dict,
    runs: int,
    started: dt.datetime,
    elapsed: float,
    full: bool = False,
) -> str:
    out = [f"# Query-plan report ({started:%Y-%m-%d})", ""]
    out.append(
        f"Generated by `backend/scripts/perf/explain.py` at {started:%Y-%m-%d %H:%M:%S} UTC in {elapsed:.0f}s. Each statement: 1 warm-up run + {runs} timed `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` runs; the plan shown is the median run. Read-only session."
    )
    out.append("")
    out.append("## Environment")
    out.append("")
    out += env_lines
    out.append("")
    out.append("### Read this first")
    out.append("")
    out += [f"- {c}" for c in caveats(info)]
    out.append("")
    out.append("## Summary")
    out.append("")
    out.append(
        "| # | Operation | SQL stmts per call | Django-measured SQL ms | in-process view/function ms (median [min-max]) | slowest stmt exec ms (median) | seq scans > 10k rows |"
    )
    out.append("|---|---|---:|---:|---|---:|---:|")
    for op in ops:
        if op.error and not op.stmts:
            out.append(f"| {op.key} | {op.title} | - | - | skipped: {op.error} | - | - |")
            continue
        stmts = [s for s in op.stmts if s.plan]
        slowest = max((s.median_ms or 0 for s in stmts), default=None)
        flagged = sum(len(s.flagged()) for s in stmts)
        warm = op.view_warm_ms
        view = f"{statistics.median(warm):.1f} [{min(warm):.1f}-{max(warm):.1f}]" if warm else "-"
        out.append(
            f"| {op.key} | {op.title} | {op.n_queries or '-'} | {op.sql_total_ms:.1f} | {view} | {fmt_ms(slowest)} | {flagged} |"
        )
    out.append("")
    out.append(
        "`in-process view ms` = wall clock of the real view/function (all SQL + Python + JSON rendering) with a warm application cache, excluding HTTP/WSGI. `Django-measured SQL ms` is the first (cold-cache) call."
    )
    out.append("")

    flagged_all = [(op, s, sc) for op in ops for s in op.stmts for sc in s.flagged()]
    out.append("## Sequential scans over more than 10,000 rows")
    out.append("")
    if flagged_all:
        out.append("| op | statement | table | rows examined | stmt exec ms |")
        out.append("|---|---|---|---:|---:|")
        for op, s, sc in flagged_all:
            out.append(f"| {op.key} | {s.label} | `{sc.table}` | {sc.scanned:,.0f} | {fmt_ms(s.median_ms)} |")
    else:
        out.append(
            "None found in the statements EXPLAINed (see the dataset-size caveat above: on a small data set this proves nothing)."
        )
    out.append("")

    for op in ops:
        out.append(f"## {op.key}. {op.title}")
        out.append("")
        out.append(op.what)
        out.append("")
        if op.error:
            out.append(f"**Skipped / failed:** {op.error}")
            out.append("")
        for note in op.notes:
            out.append(f"- {note}" if "\n" not in note else note)
        if op.notes:
            out.append("")
        if op.view_cold_ms or op.view_warm_ms:
            out.append(
                "In-process view/function wall time, ms: cold app cache "
                + (", ".join(f"{v:.1f}" for v in op.view_cold_ms) or "-")
                + "; warm app cache "
                + (", ".join(f"{v:.1f}" for v in op.view_warm_ms) or "-")
            )
            out.append("")
        if op.stmts:
            out.append("| # | statement | exec ms (median) | scans (kind: table [index], rows examined) |")
            out.append("|---|---|---:|---|")
            for n, s in enumerate(op.stmts, 1):
                if s.error or not s.plan:
                    out.append(f"| {n} | {s.label} | error | {s.error[:80]} |")
                    continue
                scans = "; ".join(
                    f"{sc.kind}: {sc.table or '-'}{f' [{sc.index}]' if sc.index else ''}, {sc.scanned:,.0f}"
                    + (" **SEQ>10k**" if sc.is_seq and sc.scanned > BIG_TABLE_ROWS else "")
                    for sc in s.plan.scans
                )
                out.append(f"| {n} | {s.label} | {fmt_ms(s.median_ms)} | {scans or '-'} |")
            out.append("")
        ranked_ms = sorted((s.median_ms or 0 for s in op.stmts if s.plan), reverse=True)
        cutoff = ranked_ms[min(2, len(ranked_ms) - 1)] if ranked_ms else 0
        for n, s in enumerate(op.stmts, 1):
            significant = s.always_detail or s.flagged() or (s.median_ms or 0) >= max(1.0, cutoff)
            if s.error or not s.plan or not (full or significant):
                continue
            plan = s.plan
            out.append(f"### {op.key}.{n} {s.label}")
            out.append("")
            out.append(
                f"- **Execution time (from the plan, median of {len(s.timed_ms)} timed runs):** {fmt_ms(plan.execution_ms)} ms; "
                f"warm-up run {fmt_ms(s.first_ms)} ms; all timed runs: {', '.join(f'{t:.2f}' for t in s.timed_ms) or '-'}; "
                f"planning {fmt_ms(plan.planning_ms)} ms"
                + (f"; Django-measured during the view call: {s.django_ms:.2f} ms" if s.django_ms is not None else "")
            )
            if plan.buffers:
                out.append(f"- **Root buffers:** `{plan.buffers}`")
            if plan.jit:
                out.append(
                    "- **JIT was used** for this statement (check the JIT timing at the bottom of the plan: "
                    "compilation can dominate short queries)."
                )
            out.append("")
            out.append("<details><summary>SQL</summary>\n\n```sql\n" + s.sql + "\n```\n</details>\n")
            out.append(
                "<details><summary>EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)</summary>\n\n```\n"
                + plan.text
                + "\n```\n</details>\n"
            )
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("output", nargs="?", help="Markdown report path (default: <repo>/docs/perf-explain-<date>.md)")
    ap.add_argument("--runs", type=int, default=3, help="timed runs per statement after one warm-up (default 3)")
    ap.add_argument("--only", help="comma-separated operation numbers to run, e.g. 3,8 (default: all 11)")
    ap.add_argument("--json", help="also write machine-readable results to this path")
    ap.add_argument(
        "--full",
        action="store_true",
        help="print SQL and plan for every statement (default: slow/primary/flagged only)",
    )
    args = ap.parse_args()

    started = dt.datetime.now(dt.UTC)
    t0 = time.perf_counter()
    runner = Runner(max(1, args.runs))
    only = {int(x) for x in args.only.split(",")} if args.only else set(range(1, 12))

    print("discovering scenario parameters (read-only)…", file=sys.stderr)
    timezone.activate(
        store_timezone()
    )  # "today" is the store's today, exactly as StoreTimezoneMiddleware does per request
    ctx = Context()
    env_lines, info = environment_section(ctx)
    print(
        f"  database {info['db_name']}: {ctx.n_products:,} purchasable products; category={ctx.category} brands={ctx.brands} search={ctx.common!r}/{ctx.prefix!r}/{ctx.typo!r}",
        file=sys.stderr,
    )

    plan: list[tuple[int, Callable[[], object]]] = [
        (1, lambda: op_listing(runner, ctx)),
        (2, lambda: op_filtered(runner, ctx)),
        (
            3,
            lambda: [
                op_search(runner, ctx, ctx.common, f"common word `{ctx.common}`", "3a"),
                op_search(runner, ctx, ctx.prefix, f"prefix `{ctx.prefix}` (prefix tsquery)", "3b"),
                op_search(runner, ctx, ctx.typo, f"typo `{ctx.typo}` (trigram)", "3c"),
            ],
        ),
        (4, lambda: op_detail(runner, ctx)),
        (5, lambda: op_suggest(runner, ctx)),
        (6, lambda: op_order_history(runner, ctx)),
        (7, lambda: op_admin_orders(runner, ctx)),
        (8, lambda: op_dashboard(runner, ctx)),
        (9, lambda: op_expiry(runner, ctx)),
        (10, lambda: op_stock(runner, ctx)),
        (11, lambda: op_cart(runner, ctx)),
    ]
    ops: list[Operation] = []
    for key, fn in plan:
        if key not in only:
            continue
        print(f"[{key}] running…", file=sys.stderr)
        try:
            result = fn()
            ops.extend(result if isinstance(result, list) else [result])
        except Exception as exc:  # noqa: BLE001 - one broken operation must not lose the rest of the report
            traceback.print_exc()
            ops.append(Operation(str(key), f"Operation {key}", "", error=f"{type(exc).__name__}: {exc}"))

    elapsed = time.perf_counter() - t0
    report = render(ops, env_lines, info, runner.runs, started, elapsed, full=args.full)
    out_path = Path(args.output) if args.output else BACKEND.parent / "docs" / f"perf-explain-{started:%Y-%m-%d}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report)
    print(f"wrote {out_path} ({len(report):,} bytes, {elapsed:.0f}s)", file=sys.stderr)
    if args.json:
        Path(args.json).write_text(
            json.dumps(
                {"started": started.isoformat(), "environment": info, "operations": [asdict(o) for o in ops]},
                default=str,
                indent=1,
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
