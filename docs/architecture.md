# Orchard Row — Architecture

How the system is put together and why. It complements `docs/implementation-plan.md` (scope, business rules, phases)
and `docs/data-model.md` (tables, constraints, state machines). `docs/legacy-analysis.md` explains what was
replaced.

**How to read this document.** It describes the working tree as of 2026-10-12. Statements were checked against the
source, and the file that proves each one is named. The test suite was **not** run for this document, so nothing here is a claim that a test
passes; where a behaviour is exercised by a test, the test file is named. Things that are designed but absent, or that
exist but could not be verified, are collected in [§14 Not implemented / known gaps](#14-not-implemented--known-gaps).
Paths are relative to the repository root.

## Contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [System context](#2-system-context)
3. [Container view](#3-container-view)
4. [Module map (Django apps)](#4-module-map-django-apps)
5. [Request lifecycle](#5-request-lifecycle)
6. [API conventions](#6-api-conventions)
7. [Access control (RBAC)](#7-access-control-rbac)
8. [Background jobs](#8-background-jobs)
9. [Caching and graceful degradation](#9-caching-and-graceful-degradation)
10. [Frontend architecture](#10-frontend-architecture)
11. [Observability](#11-observability)
12. [Configuration reference](#12-configuration-reference)
13. [Key design decisions](#13-key-design-decisions)
14. [Not implemented / known gaps](#14-not-implemented--known-gaps)

---

## 1. Goals and non-goals

### Goals

| Goal | Where it is enforced |
|---|---|
| Never oversell stock or overbook a delivery slot, even under concurrent checkouts | Row locks in `apps/inventory/services.py`; conditional `UPDATE` in `apps/stores/services.py`; CHECK constraints `stock_reserved_le_on_hand`, `slot_not_overbooked` |
| Money and quantities are exact decimals end to end | `Decimal` fields; `apps/core/money.py`; `apps/core/renderers.py` (no float ever reaches JSON) |
| The server is the only authority on prices, totals, quantity rules and permissions | `apps/cart/pricing.py`, `apps/orders/checkout.py` (`expected_total` is only compared, never trusted), `apps/core/permissions.py` |
| An order is confirmed only by a verified provider event, never by a browser redirect | `apps/payments/services.py` (`handle_webhook`, `apply_event`) |
| Retries are safe | `Idempotency-Key` on checkout, idempotent goods receiving, refunds and webhooks (§6.3) |
| Every consequential staff action is attributable | `AuditLog` (`apps/core/audit.py`), `StockMovement` ledger, `OrderStatusHistory` |
| Boots from an empty database and keeps running when Redis is down | Migrations include reference data; cache and throttle failures are swallowed (§9) |
| One API for every client (storefront, dashboard, later POS/mobile) | Versioned `/api/v1`, single error envelope (§6) |
| Honest labelling | Only `verified` product claims are shown (`ProductClaim`); demo data and demo payments are flagged (`is_demo`, `StoreSettings.demo_mode`, `Payment.is_demo`) |

### Non-goals

* **Microservices or an event bus.** One deployable backend; cross-module consistency comes from database
  transactions (§13.1).
* **An external search engine.** Search is PostgreSQL full-text plus trigram similarity (§13.4).
* **Token (JWT) authentication or a cross-origin API.** Browsers use first-party session cookies through a same-origin
  proxy; there is no CORS configuration (§13.2, §13.3).
* **Multi-tenancy or multi-currency.** `StoreSettings` is a singleton (`pk=1`) with one currency; each `Order`
  records the currency it was placed in.
* **A tax engine.** Tax is a flat per-product `tax_rate`, either included in or added to prices
  (`StoreSettings.prices_include_tax`).
* **Push updates.** There is no WebSocket or server-sent-event channel; pages poll with TanStack Query
  `refetchInterval` (order page 15 s until terminal, dashboard 60 s, checkout quote 60 s).
* **Native apps or POS.** The API is versioned so they can be added; none exists.
* **Verified live card payments.** The Stripe adapter exists but has never run against a real Stripe account
  (`apps/payments/providers/stripe_provider.py`, docstring).

---

## 2. System context

```mermaid
flowchart LR
    shopper["Shopper<br/>guest or signed-in customer"]
    staff["Staff<br/>8 roles, capability-gated"]
    subgraph orchard["Orchard Row"]
        web["Storefront and staff dashboard<br/>Next.js 15"]
        api["API and business rules<br/>Django 5.2 + DRF"]
    end
    pay["Card payment provider<br/>Stripe (unverified) or built-in demo adapter"]
    smtp["SMTP server<br/>console backend by default"]
    shopper -->|HTTPS| web
    staff -->|HTTPS| web
    web -->|"/api and /media, same origin"| api
    api -->|"create, capture, void, refund"| pay
    pay -->|"signed webhook"| api
    api -->|"order and account email"| smtp
```

External dependencies and what happens without them:

| Dependency | Used for | If unavailable |
|---|---|---|
| PostgreSQL 16 | All state | Hard failure; `/readyz` returns 503 |
| Redis 7 | Cache, sessions cache, throttle counters, Celery broker | Degrades (§9); `/readyz` returns 200 `degraded` |
| Payment provider | Card authorisation, capture, void, refund | `PAYMENT_PROVIDER_UNAVAILABLE` (503) at checkout; cash-on-delivery still works |
| SMTP | Order, password-reset and newsletter email | Emails are recorded as queued and retried (§8) |

There is no error-monitoring service, CDN or object storage in the current tree.

---

## 3. Container view

```mermaid
flowchart TB
    browser["Browser"]
    subgraph web_tier["frontend container: node:22-alpine, port 3000"]
        next["Next.js 15 standalone server<br/>SSR / Server Components, static assets<br/>rewrites /api/* and /media/* to Django"]
    end
    subgraph app_tier["backend image: python:3.13-slim, non-root uid 10001"]
        gunicorn["backend: gunicorn config.wsgi<br/>3 workers x 2 threads, port 8000"]
        worker["worker: celery worker<br/>concurrency 2"]
        beat["beat: celery beat<br/>interval schedule"]
        migrate["migrate: one-shot<br/>manage.py migrate"]
    end
    pg[("PostgreSQL 16<br/>source of truth")]
    redis[("Redis 7<br/>db 0 cache and sessions cache<br/>db 1 Celery broker")]
    media[("media volume<br/>/data/media, FileSystemStorage")]
    browser -->|"HTTP :3000"| next
    next -->|"rewrite and server-side fetch<br/>BACKEND_INTERNAL_URL"| gunicorn
    gunicorn --> pg
    gunicorn --> redis
    gunicorn --> media
    worker --> pg
    worker --> redis
    worker --> media
    beat -->|"enqueue on schedule"| redis
    migrate --> pg
```

| Container (Compose service) | Image / command | Notes |
|---|---|---|
| `frontend` | `frontend/Dockerfile`, `node server.js` (Next `output: "standalone"`) | Only service published on all interfaces (`3000`). `BACKEND_INTERNAL_URL` is a **build argument** because Next bakes rewrite destinations into the build. |
| `backend` | `backend/Dockerfile`, `gunicorn config.wsgi:application --workers 3 --threads 2 --timeout 30 --max-requests 2000 --max-requests-jitter 200` | Published on `127.0.0.1:8000` only. `HEALTHCHECK` calls `/healthz`. Static files via WhiteNoise (collected at image build). `/media` is served by Django only when `SERVE_MEDIA=true` (demo/single-host). `/django-admin/` is mounted only when `DJANGO_ADMIN_ENABLED` is true (default follows `DEBUG`, so off in production). |
| `worker` | `celery -A config worker --concurrency=2` | Healthcheck: `celery inspect ping`. |
| `beat` | `celery -A config beat --schedule=/tmp/celerybeat-schedule` | Run exactly one instance. There is no leader election; the tasks are written to be idempotent, so a duplicate beat causes redundant work, not corruption. |
| `migrate` | `manage.py migrate --noinput` | `backend`, `worker` and `beat` wait for it (`service_completed_successfully`). |
| `postgres` | `postgres:16-alpine` | Volume `pgdata`. |
| `redis` | `redis:7-alpine`, `appendonly yes`, `maxmemory 256mb`, `maxmemory-policy allkeys-lru` | Volume `redisdata`. One instance holds cache **and** broker (see §14). |
| `seed` (profile `tools`) | `manage.py seed_demo --force` | One-off. `--force` is required because `DEBUG` is off in the production image; the command refuses to run without it. Creates demo data and demo accounts only. |

Settings modules: `config.settings.dev` (default for `manage.py` and Celery), `config.settings.prod` (default for
WSGI/ASGI, set explicitly in Compose), `config.settings.test` (pytest). Docker and CI facts come from
`docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile` and `.github/workflows/ci.yml`.

---

## 4. Module map (Django apps)

The backend is a modular monolith: fourteen apps under `backend/apps/`, all in `INSTALLED_APPS`
(`backend/config/settings/base.py`). URL composition: `config/urls.py` (health, schema, and Django admin when enabled) →
`config/api_urls.py` (`/api/v1/`, one include per app) → `config/admin_urls.py` (`/api/v1/admin/`, split into
`admin_urls_ops.py` and `admin_urls_crud.py` so independent workstreams do not edit the same file).

| App | Responsibility | Models | Key modules |
|---|---|---|---|
| `core` | Singleton `StoreSettings`, append-only `AuditLog`, `IdempotencyRecord`; error contract; request-ID middleware and JSON logging; cache helpers; RBAC matrix and DRF permissions; money helpers; health endpoints; shared staff-API base classes; demo seeding (`seed/`, `seed_demo`) | 3 | `exceptions.py`, `rbac.py`, `permissions.py`, `cache.py`, `audit.py`, `admin_api.py`, `admin_utils.py` |
| `accounts` | Email-login `User` with a role and branch assignments, `Address`; register/login/logout/CSRF/password flows; customer and staff administration | 2 | `views.py`, `admin_api.py` |
| `stores` | `Branch`, opening hours, closures, `DeliveryZone`, `SlotTemplate`, `DeliverySlot`; zone matching; slot generation; capacity-safe booking | 6 | `services.py` |
| `catalog` | Two-level categories, brands, `SaleUnit`, `Product` and its images/claims/allergens/nutrition, `Review`, `Collection`; search; unit prices; image pipeline; popularity | 12 | `queries.py`, `search.py`, `pricing_info.py`, `images.py`, `signals.py`, `reference.py` |
| `inventory` | `StockLevel`, `Batch`, `StockMovement`, `Allocation`; reserve → commit → release; FEFO; adjust/waste/transfer; expiry sweep | 4 | `services.py`, `availability.py` |
| `purchasing` | Suppliers, purchase orders, goods receipts; PO state machine; idempotent receiving; replenishment suggestions; supplier performance | 6 | `services.py` |
| `promotions` | Automatic `Promotion`s, `Coupon`s, `CouponRedemption`; best-price engine; coupon evaluation and race-safe redemption | 3 | `engine.py`, `coupons.py` |
| `cart` | Cart and lines (guest by cookie, signed-in by user), favourites, comparison, shopping lists; the pricing engine (quantity validation, totals) | 6 | `pricing.py`, `services.py`, `signals.py` |
| `orders` | `Order`, `OrderItem`, status history, substitutions, support cases; quote and place order; the status state machine; picking, weighing, substitution and packing | 5 | `checkout.py`, `workflow.py`, `fulfilment.py`, `support.py` |
| `payments` | `Payment`, `PaymentEvent`, `Refund`; provider adapters (demo, Stripe); webhook processing; capture, void, refund; reconciliation | 3 | `services.py`, `providers/` |
| `content` | Banners, pages, articles, FAQs, newsletter, contact messages; public and staff APIs; sitemap data | 6 | `views.py`, `admin_api.py` |
| `notifications` | In-app notifications; email via Celery; outbox sweep | 1 | `services.py`, `tasks.py` |
| `reports` | No models. Metric definitions, aggregate queries, CSV export | 0 | `queries.py`, `views.py` |
| `loyalty` | **Declared in `INSTALLED_APPS` but empty**: no models, no migrations, no code | 0 | — |

### 4.1 Dependency direction

The graph below is derived from the imports in the code (not from intent). It shows **module-level imports in the
domain layer** — models, services, pricing, queries, tasks — with `views.py`, `serializers.py`, `admin_*.py` and
`urls.py` excluded. An arrow `A --> B` means "A imports B". Every app that has code also imports `core`; those edges are omitted.
Dashed arrows are **function-level (late) imports** that point against the grain.

```mermaid
flowchart BT
    orders --> cart
    orders --> payments
    orders --> inventory
    orders --> promotions
    orders --> catalog
    orders --> stores
    orders --> accounts
    orders --> notifications
    reports --> orders
    reports --> payments
    reports --> purchasing
    reports --> inventory
    reports --> catalog
    reports --> promotions
    reports --> stores
    purchasing --> inventory
    purchasing --> catalog
    cart --> catalog
    cart --> inventory
    cart --> promotions
    catalog --> inventory
    catalog --> promotions
    payments -.-> orders
    payments -.-> notifications
    inventory -.-> orders
    inventory -.-> catalog
    promotions -.-> orders
    catalog -.-> orders
    core -.-> accounts
```

With the dashed edges removed, the domain-layer graph is acyclic. This was computed with an AST walk over
`backend/apps/**/*.py`, excluding migrations, seed code, and the HTTP-layer files named above.

### 4.2 Conventions that keep it acyclic

1. **Dependencies point from commerce towards reference data**: `core` → (`accounts`, `stores`, `notifications`) →
   (`inventory`, `promotions`, `payments`) → `catalog` → (`purchasing`, `cart`) → `orders` → `reports`. A lower app's
   models and services do not import a higher one at module level.
2. **Foreign keys across apps are written as strings** (`"catalog.Product"`, `"orders.OrderItem"`), so `models.py`
   modules import only `apps.core`. The single exception is `orders/models.py`, which imports the enums
   `SubstitutionPolicy` and `ItemSubstitutionPref` from `apps/cart/models.py`.
3. **Back-references use function-level imports.** The complete list in the domain layer:

   | Function | Late import |
   |---|---|
   | `core.audit.record` | `accounts.models.User` (to recognise a user actor) |
   | `inventory.services.release_order` | `orders.models.OrderItem` |
   | `inventory.availability.availability_map` | `catalog.models.Product` |
   | `promotions.coupons._has_prior_orders` | `orders.models` |
   | `payments.services.apply_event`, `_complete_refund` | `orders.workflow`, `notifications.services` |
   | `catalog.tasks.refresh_popularity` | `orders.models` |
   | `orders.workflow` (`confirm_after_payment`, `after_payment_failed`, `_unwind`, `cancel_order`, `expire_unpaid`) | `notifications`, `inventory`, `payments`, `promotions`, `stores` — `workflow.py` is imported by `checkout.py`, `fulfilment.py` and `payments`, so it defers its own imports |
   | `orders.checkout.place_order` | `notifications.services.notify_order` |

   `orders` ⇄ `payments` is the one genuine mutual dependency: `orders` imports `payments.services` at module level
   (`checkout.py`, `fulfilment.py`); `payments.services` reaches back into `orders.workflow` only inside functions.
4. **The HTTP layer sits on top and may import across apps freely.** Examples: `payments/views.py` imports
   `orders.views` and `orders.serializers`; `catalog/views.py` imports `inventory`, `promotions` and `stores`;
   `core/admin_utils.py` and `core/admin_views.py` import `catalog.images`; `accounts/admin_api.py` imports `orders`
   and `stores`. Nothing imports these modules except URL configurations (and a few HTTP-to-HTTP calls such as
   `payments.views` → `orders.views.get_order_for_request`).
5. **Cross-app reactions use Django signals registered in `AppConfig.ready()`**: `catalog/signals.py` (search index
   rebuild and cache bump on `Product`/`Brand`/`Category` save, rating aggregate on `Review`),
   `promotions/apps.py` (cache bump), `cart/signals.py` (merge the guest cart on `user_logged_in`).

Two smells worth knowing: `cart/services.py` imports `catalog.serializers.ProductCardSerializer` at module level and
`catalog.views.default_branch_id` inside `resolve_branch_id` (a service reaching into a view module).

### 4.3 HTTP surface by app

| Prefix under `/api/v1/` | Provided by |
|---|---|
| `store/` | `core.views.StorePublicView` (public store identity and policy) |
| `auth/…`, `account/…`, `addresses/` | `accounts` |
| `products/`, `categories/`, `brands/`, `collections/`, `search/suggest/`, `home/` | `catalog` |
| `branches/`, `delivery/check/`, `delivery-slots/` | `stores` |
| `cart/…`, `favorites/`, `compare/`, `account/comparison/`, `lists/…` | `cart` |
| `checkout/`, `checkout/quote/`, `orders/…` | `orders` |
| `payments/webhook/<provider>/`, `payments/demo/<ref>/`, `payments/orders/<n>/retry/` | `payments` |
| `pages/`, `articles/`, `faqs/`, `newsletter/…`, `contact/`, `seo/sitemap/` | `content` |
| `admin/…` | Staff API, see §7.5 |

Outside `/api/v1/`: `/healthz`, `/readyz`, `/django-admin/` (only when `DJANGO_ADMIN_ENABLED`), `/api/schema/`, `/api/docs/` (OpenAPI via
`drf-spectacular`).

---

## 5. Request lifecycle

### 5.1 Middleware order

From `MIDDLEWARE` in `config/settings/base.py`, outermost first:

| # | Middleware | Role |
|---|---|---|
| 1 | `django.middleware.security.SecurityMiddleware` | HTTPS redirect, HSTS, nosniff, referrer policy (the secure flags are set in `prod.py`) |
| 2 | `whitenoise.middleware.WhiteNoiseMiddleware` | Static files (`CompressedStaticFilesStorage`) |
| 3 | `apps.core.middleware.RequestIDMiddleware` | Accepts an incoming `X-Request-ID` only if it matches `^[A-Za-z0-9._-]{8,64}$`, otherwise generates a UUID hex; stores it in a context variable for logs; echoes it as `X-Request-ID` |
| 4 | `apps.core.middleware.StoreTimezoneMiddleware` | Runs the request inside `timezone.override(<store timezone>)` so `timezone.localdate()` means the store's "today" (expiry buffers, slot windows and reports are decided in the store's timezone). Falls back to the process default if the setting is unreadable. Celery workers get the same effect from a `task_prerun` hook in `config/celery.py`. |
| 5 | `SessionMiddleware` | Session cookie (`sessionid`) |
| 6 | `CommonMiddleware` | |
| 7 | `CsrfViewMiddleware` | DRF views are `csrf_exempt`; CSRF is enforced by the authentication class (§5.2) |
| 8 | `AuthenticationMiddleware` | `request.user` for non-DRF views (Django admin) |
| 9 | `MessageMiddleware` | Django admin only |
| 10 | `XFrameOptionsMiddleware` | `X_FRAME_OPTIONS = "DENY"` in prod |

Because the request ID is assigned at step 3, a redirect issued by `SecurityMiddleware` (HTTPS redirect) or a static
file response does not carry one.

### 5.2 Authentication, sessions and CSRF

* **Session cookie, no tokens in JavaScript.** `SESSION_ENGINE = cached_db` (reads hit the cache, writes go through to
  PostgreSQL, so sessions survive a Redis outage), 14 days, `HttpOnly`, `SameSite=Lax`, `Secure` in production.
* **CSRF.** `CSRFSessionAuthentication` (`apps/core/authentication.py`) is the only default authentication class. It
  extends DRF's `SessionAuthentication` and additionally enforces CSRF when the caller is **anonymous**, so login,
  guest cart and guest checkout are not open to cross-site POSTs. Safe methods are never checked. The token cookie
  `csrftoken` is deliberately not `HttpOnly` (`CSRF_COOKIE_HTTPONLY = False`); the browser client reads it and sends
  `X-CSRFToken`. `GET /api/v1/auth/csrf/` sets the cookie, and so does `GET /api/v1/auth/session/` (always `200`;
  `{"user": null}` for visitors, so anonymous page loads produce no failing request). Because the storefront proxies `/api`,
  unsafe requests arrive with `Origin: <storefront>` but a different `Host`; `CSRF_TRUSTED_ORIGINS` therefore defaults to
  `[FRONTEND_URL]` when not set explicitly (`config/settings/base.py`).
* **Views that opt out of authentication** (`authentication_classes = []`) never check CSRF: the public catalog
  (`PublicView`), store config, branch/slot lookups, the payment webhook and the demo payment page.
* **Default permission is `IsAuthenticated`.** Every public endpoint must say `AllowAny` explicitly.
* **Login hardening.** Scoped throttle `login`, plus a lockout of 5 failed attempts per (email fingerprint, IP) for 15
  minutes kept in the cache (`apps/accounts/views.py`). Password reset replies identically whether or not the account
  exists. Passwords: Argon2 first, PBKDF2 accepted; minimum length 10; reset tokens valid 2 hours.
* **Passwordless guest access to an order**: the order number plus its unguessable `tracking_token`
  (`?token=` or `X-Order-Token`) or, on the track form, number plus checkout email. Anything else is a `404`, not `403`
  (`orders/views.py: get_order_for_request`).

### 5.3 DRF pipeline

`REST_FRAMEWORK` in `config/settings/base.py`:

| Setting | Value | Consequence |
|---|---|---|
| Renderer | `DecimalSafeJSONRenderer` only | No browsable API. A raw `Decimal` is encoded as an exact string, never a float |
| Parser | `JSONParser` only | Upload views declare `MultiPartParser`/`FormParser` themselves |
| Pagination | `StandardPagination`, page size 24, `page_size` query up to 100 | Envelope `{count, page, page_size, total_pages, next, previous, results}` |
| Filtering | `DjangoFilterBackend` | |
| Exceptions | `apps.core.exceptions.api_exception_handler` | Single error envelope (§6.2) |
| Throttling | `AnonRateThrottle` + `UserRateThrottle` by default; scoped throttles override them per view | §5.4 |
| Schema | `drf_spectacular` at `/api/schema/` and `/api/docs/` | Served without authentication in every environment |

Database transactions are **not** per request (`ATOMIC_REQUESTS = False`); services open `transaction.atomic()`
explicitly and take row locks with `select_for_update`.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant N as Next.js
    participant M as Django middleware
    participant V as DRF view
    participant S as Service layer
    participant P as PostgreSQL
    B->>N: POST /api/v1/checkout/ with session cookie, X-CSRFToken, Idempotency-Key
    N->>M: rewrite to BACKEND_INTERNAL_URL/api/v1/checkout/
    M->>V: SecurityMiddleware ... RequestIDMiddleware ... Session, Csrf, Auth
    V->>V: CSRFSessionAuthentication, permissions, scoped throttle
    V->>S: validated input
    S->>P: transaction.atomic, SELECT FOR UPDATE
    P-->>S: rows
    S-->>V: result or DomainError
    V-->>B: JSON (DecimalSafeJSONRenderer) or error envelope, plus X-Request-ID
```

### 5.4 Throttling scopes

Rates come from `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]` and can be changed with the environment variables in §12.

| Scope | Default | Applied to |
|---|---|---|
| `anon` | 240/min | Default for unauthenticated callers on views that keep the default throttles; also the explicit scope of `SuggestView` (`ScopedRateThrottle`) |
| `user` | 600/min | Default for authenticated callers on views that keep the default throttles |
| `login` | 10/min | `POST auth/login/` |
| `register` | 10/hour | `POST auth/register/` |
| `password_reset` | 5/hour | `POST auth/password-reset/` and `…/confirm/` |
| `coupon` | 20/min | `POST cart/coupon/` |
| `checkout` | 30/min | `POST checkout/` |
| `tracking` | 20/min | `POST orders/track/` |
| `newsletter` | 10/hour | newsletter subscribe, confirm, unsubscribe |
| `contact` | 5/hour | contact form. **Not** in `DEFAULT_THROTTLE_RATES`: `apps/content/throttles.py` falls back to this value so a missing rate can never leave the form unthrottled |

A view that sets `throttle_classes = [ScopedRateThrottle]` **replaces** the global anon/user throttles for that view.
`WebhookView` sets `throttle_classes = []` (unthrottled; authenticated by signature). The test settings disable
throttling entirely (`config/settings/test.py`).

### 5.5 Worked example: a card order, happy path

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as Django API
    participant P as PostgreSQL
    participant X as Payment provider
    participant T as Staff (picking UI or API)
    B->>A: POST /checkout/ (Idempotency-Key)
    rect rgb(235, 245, 235)
    Note over A,P: one transaction: claim key, lock cart, re-price, create Order and OrderItems (snapshots), reserve stock FEFO, book slot, redeem coupon, create Payment REQUIRES_ACTION, mark cart CONVERTED
    A->>P: commit
    end
    A->>X: after commit: create hosted checkout (init_with_provider)
    A-->>B: 201 order PENDING_PAYMENT plus checkout_url
    B->>X: customer pays on the provider page
    X->>A: signed webhook payment.authorized
    A->>P: verify, insert PaymentEvent (unique), lock Payment, state AUTHORIZED, order CONFIRMED
    T->>A: pick items (commit_pick), finish picking (final total capped at authorised amount)
    T->>A: finish packing
    A->>X: capture final total
    A->>P: Payment CAPTURED, order READY_FOR_PICKUP or READY_FOR_DISPATCH
```

Creating the hosted checkout (`payments.services.init_with_provider`) happens **after** the order transaction commits
and outside any transaction, so a slow or failing provider cannot roll back or hold locks on an order that already
exists; if it fails the order stays `PENDING_PAYMENT` and the customer can retry from the order page
(`payment_init_failed: true`). Capture and void are different: they are called from inside the service transaction
(`fulfilment.finish_packing`, `workflow.cancel_order`) so that a provider failure aborts the status change. A frontend
redirect is never treated as proof of payment. With the demo adapter, the "customer pays" step is performed by the
backend itself: `POST /api/v1/payments/demo/<reference>/` signs an event and calls the same `handle_webhook` code path.

---

## 6. API conventions

### 6.1 Versioning and documents

* Everything is under `/api/v1/`. A breaking change is meant to ship as `/api/v2/`; no v2 exists.
* OpenAPI 3 schema: `GET /api/schema/`; Swagger UI: `GET /api/docs/`.
* Money and quantities are **decimal strings** in JSON (`"4.50"`, `"0.250"` or the canonical trimmed form `"0.25"` via
  `apps/core/money.py: qty_str`). The storefront sends quantities as strings too (`String(quantity)` in
  `frontend/src/lib/hooks.tsx`). Floats are rejected by `money.to_decimal`.
* Dates and instants are ISO 8601; instants are UTC. Store-local wall times (slots) are rendered in the store timezone
  by the frontend (`formatSlotDay`, `formatSlotWindow` in `frontend/src/lib/format.ts`).

### 6.2 Error envelope

Every error from `/api/v1/` (except webhook replies) has one shape, produced by `apps/core/exceptions.py`:

```json
{"error": {"code": "INSUFFICIENT_STOCK", "message": "Human-readable text.", "details": {}, "request_id": "…"}}
```

| Source | HTTP | `code` |
|---|---|---|
| `DomainError(code, message, status_code=400, details)` | as raised | as raised |
| DRF `ValidationError` | 400 | `VALIDATION_ERROR`, `details` = field → messages, flattened |
| `NotAuthenticated` / `AuthenticationFailed` | 401 | `NOT_AUTHENTICATED` |
| Django `PermissionDenied` / DRF `PermissionDenied` (also a failed CSRF check) | 403 | `FORBIDDEN` |
| `Http404` / DRF `NotFound` | 404 | `NOT_FOUND` |
| `Throttled` | 429 | `RATE_LIMITED`, `details.retry_after` |
| Any other DRF exception (for example method not allowed) | its own | `default_code` upper-cased, e.g. `METHOD_NOT_ALLOWED` |
| Unhandled exception | 500 | `INTERNAL_ERROR`, logged with `unhandled_api_exception` |

Webhook replies are **not** enveloped: `{"status": "applied" | "duplicate" | "ignored" | "invalid_signature" | …}`.

**Codes defined in `ErrorCode`** (status is chosen at each raise site; the column shows what the code base uses):

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid input, including business validation with field details |
| `NOT_AUTHENTICATED` | 401 | Emitted by the exception handler |
| `FORBIDDEN` | 403 | |
| `NOT_FOUND` | 404 | |
| `RATE_LIMITED` | 429 | Emitted by the exception handler (and by the login lockout) |
| `INTERNAL_ERROR` | 500 | |
| `PRODUCT_UNAVAILABLE` | 404 / 409 | Product inactive, hidden or out of stock |
| `INSUFFICIENT_STOCK` | 409 | Lists every short line in `details.items` |
| `INVALID_QUANTITY` | 400 | Not `qty_min + k·qty_step`, fractional count, above `qty_max`, too many decimals |
| `INVALID_COUPON` | 400 | |
| `ADDRESS_NOT_SERVICEABLE` | 400 | No active delivery zone covers the postcode/area |
| `DELIVERY_SLOT_UNAVAILABLE` | 409 (400 inside `book_slot`) | Slot full, closed, too soon, or wrong branch/zone/kind |
| `PAYMENT_FAILED` | 502 (409 once) | Provider refused or was unreachable during capture/void/refund |
| `INVALID_ORDER_TRANSITION` | 409 | Transition not in `workflow.TRANSITIONS`; `details` has `from`, `to`, `allowed` |
| `SUBSTITUTION_REQUIRES_APPROVAL` | 409 | |
| `SUBSTITUTION_NOT_ALLOWED` | 409 | Customer policy forbids it, or the candidate is ineligible |
| `WEIGHT_OUT_OF_TOLERANCE` | 422 | |
| `IDEMPOTENCY_CONFLICT` | 422 | Same key, different request body |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | |
| `CART_EMPTY` | 409 | |
| `CART_CHANGED` | 409 | Lines changed, or `expected_total` no longer matches; `details` carries a fresh quote |
| `MIN_ORDER_NOT_MET` | 409 | |
| `INVALID_STATE` | 409 | Generic "not in a state that allows this" (also unique-race conflicts in `AuditedViewSet`) |
| `DUPLICATE_RECEIPT` | 409 | Receiving against an already fully received PO |
| `REFUND_NOT_ALLOWED` | 409 | |
| `PAYMENT_PROVIDER_UNAVAILABLE` | 503 | No card provider configured or enabled |
| `BRANCH_CLOSED`, `INVALID_WEBHOOK`, `BATCH_BLOCKED` | — | **Defined but never raised** anywhere in `apps/` |

**Codes used as string literals, not in `ErrorCode`**: `INVALID_CREDENTIALS` (401), `INVALID_RESET_LINK` (400),
`GUEST_CHECKOUT_DISABLED` (403), `REVIEW_NOT_ALLOWED` (403), `REVIEW_EXISTS` (409), `INVALID_TOKEN` (400, newsletter
confirmation).

### 6.3 Idempotency

| Operation | Key | Storage and uniqueness |
|---|---|---|
| `POST /checkout/` | Header `Idempotency-Key`, 8–120 characters, **required** | `IdempotencyRecord` unique on (`scope="checkout"`, `actor_key`, `key`) where `actor_key` is `user:<id>` or `guest:<cart cookie>`; also `Order.checkout_key` with a partial unique index. Replay with the same key and body returns the existing order (`200`, `replayed: true`); same key with a different body is `IDEMPOTENCY_CONFLICT`. A failed attempt rolls back its record, so it does not "burn" the key. Records older than 7 days are purged by a beat task. |
| Goods receiving | `idempotency_key` in the body, ≥ 8 characters | `GoodsReceipt` unique on (`purchase_order`, `idempotency_key`); a repeat returns the stored receipt |
| Refunds | `idempotency_key` (staff supply it; system refunds use `cancel-<order number>` and `case-<id>`) | `Refund` unique on (`payment`, `idempotency_key`); the provider call also receives the key |
| Payment webhooks | Provider event id | `PaymentEvent` unique on (`provider`, `event_id`); a duplicate is acknowledged with `{"status":"duplicate"}` and has no effect |
| Notifications | Notification row | The send task skips a notification that is already sent |

### 6.4 Server authority over input

Prices, totals, discounts, delivery fees and the authorised amount are always recomputed by `checkout.prepare()`;
`expected_total` from the client only triggers `CART_CHANGED` when stale. Quantities are validated against the product's
`qty_min`, `qty_step`, `qty_max` and the unit's `allows_fraction` (`apps/cart/pricing.py: validate_quantity`).

---

## 7. Access control (RBAC)

### 7.1 Model

* Nine roles on `User.role` (`apps/core/rbac.py`): `CUSTOMER` and eight staff roles. A role maps to a set of
  **capabilities**, coarse `area.verb` strings. Django's `Group`/`Permission` tables exist (from `PermissionsMixin`)
  but are not used for authorisation.
* `User.is_staff` (Django admin access) is derived in `User.save()`: true only for `SUPER_ADMIN`/`ADMIN`
  (`GLOBAL_ROLES`) or a superuser. Operations staff use the custom dashboard, never `/django-admin/`.
* Customers have no capabilities.

### 7.2 Roles → capabilities

Generated from `ROLE_CAPABILITIES` by reading `apps/core/rbac.py`.
SA = `SUPER_ADMIN`, AD = `ADMIN`, SM = `STORE_MANAGER`, IM = `INVENTORY_MANAGER`, PM = `PURCHASING_MANAGER`,
FS = `FULFILMENT_STAFF`, CS = `CUSTOMER_SUPPORT`, MM = `MARKETING_MANAGER`.

| Capability | SA | AD | SM | IM | PM | FS | CS | MM |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `catalog.read` | x | x | x | x | x | x | x | x |
| `catalog.write` | x | x |  |  |  |  |  |  |
| `catalog.availability` | x | x | x | x |  |  |  |  |
| `catalog.merchandise` | x | x |  |  |  |  |  | x |
| `inventory.read` | x | x | x | x | x | x |  |  |
| `inventory.adjust` | x | x | x | x |  |  |  |  |
| `inventory.waste` | x | x | x | x |  |  |  |  |
| `inventory.transfer` | x | x | x | x |  |  |  |  |
| `inventory.batches` | x | x | x | x | x |  |  |  |
| `purchasing.read` | x | x | x | x | x |  |  |  |
| `purchasing.write` | x | x |  |  | x |  |  |  |
| `purchasing.receive` | x | x |  |  | x |  |  |  |
| `orders.read` | x | x | x |  |  | x | x |  |
| `orders.fulfil` | x | x | x |  |  | x |  |  |
| `orders.manage` | x | x | x |  |  |  | x |  |
| `orders.refund` | x | x | x |  |  |  | x |  |
| `customers.read` | x | x | x |  |  |  | x |  |
| `customers.manage` | x | x |  |  |  |  | x |  |
| `support.manage` | x | x | x |  |  |  | x |  |
| `promotions.manage` | x | x |  |  |  |  |  | x |
| `content.manage` | x | x |  |  |  |  |  | x |
| `finance.read` | x | x | x |  |  |  | x |  |
| `finance.refund` | x | x |  |  |  |  |  |  |
| `reports.read` | x | x | x | x | x |  |  | x |
| `reports.export` | x | x | x |  |  |  |  |  |
| `branches.manage` | x | x |  |  |  |  |  |  |
| `slots.manage` | x | x | x |  |  |  |  |  |
| `staff.manage` | x | x |  |  |  |  |  |  |
| `settings.manage` | x | x |  |  |  |  |  |  |
| `audit.read` | x | x |  |  |  |  |  |  |
| **total** | **30** | **30** | **18** | **9** | **7** | **4** | **8** | **5** |

Notes: `ADMIN` holds the same 30 capabilities as `SUPER_ADMIN`; the difference is enforced only by the staff-management
guard rails (§7.4). `finance.refund` is defined and granted but **no endpoint checks it** — refunds are gated by
`orders.refund`.

### 7.3 Branch scoping

* `GLOBAL_ROLES = {SUPER_ADMIN, ADMIN}`, or any user with `all_branches = true`, see every branch. All other staff see
  only branches in `User.branches`; with none assigned the list is empty and they see nothing
  (`apps/core/permissions.py: branch_ids_for`).
* Scoping is applied to querysets on the server: orders, payments/refunds/events, support cases (through the order's
  branch), stock levels, movements, batches, purchase orders, branches, closures, zones, slot templates, slots and all
  reports. Writes that name a branch are checked with `ensure_branch_access`. Catalog, promotions, content, customers,
  staff, settings and audit are **not** branch data and are gated by capability only.
* `GET /api/v1/admin/me/permissions/` returns role, capability list and branch scope; the dashboard uses it only to
  hide what the server would refuse anyway.
* `tests/security/test_route_sweep.py` asserts that every route enumerated
  under `/api/v1/admin/` refuses anonymous callers and customers for every method.

### 7.4 How `AdminViewSet` enforces and audits

`apps/core/admin_api.py`:

1. `permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]`. `HasCapability` resolves the needed capability
   from `capability_map[action]`, else `read_capability` for safe methods, else `capability`. No capability resolved
   means **deny**.
2. `get_queryset()` is scoped with `branch_field` when set.
3. `perform_create/update/destroy` write the change and an `AuditLog` row (`<label>.created|updated|deleted`) inside one
   `transaction.atomic()`, so there is never a change without a record of it. The row carries a JSON `before`/`after`
   snapshot (`snapshot()` skips `password`, `token`, `secret`, `tracking_token`), the actor, IP and request ID.
4. `AuditedViewSet` (`apps/core/admin_utils.py`) adds many-to-many ids to the snapshots and maps `IntegrityError` to a
   `409 INVALID_STATE`. It is used by products, categories, brands, collections, promotions, coupons, banners, pages,
   articles, FAQs, customers and staff. The plain `AdminViewSet` — used by branches, closures, zones, slot templates,
   slots and suppliers — does not translate `IntegrityError`, so a unique-key race there is a `500`.
5. `AdminReadOnlyViewSet` (no model create/update/delete through the router; used by the audit log, newsletter,
   contact messages, units, allergens, review moderation and support cases) passes through the same permission classes.
   Review moderation and support cases add explicit `POST` actions; `AuditLogViewSet` allows only `GET/HEAD/OPTIONS`.
6. Action endpoints in other modules call `audit.record(...)` themselves: stock adjust/waste/transfer/thresholds, batch
   status, PO actions, supplier products, slot generation, settings and logo, report export, support-case decisions,
   `refund.api`, plus the payment services (`payment.captured`, `payment.released`, `payment.cod_collected`,
   `refund.requested`, `refund.manual_completed`, `payment.late_authorization_voided`) and `order.cancelled` /
   `order.weight_override`.

   **Order fulfilment steps are not in `AuditLog`.** Start picking, picking an item, marking unavailable, proposing or
   deciding a substitution, finishing picking or packing, dispatch and completion are recorded in `OrderStatusHistory`
   (with actor and notes) and, for stock, in the `StockMovement` ledger. `docs/implementation-plan.md` §9 says every
   consequential action writes an `AuditLog` row; for these steps the timeline and the ledger are the record.

**Staff-management guard rails** (`apps/accounts/admin_api.py: StaffViewSet.enforce_rules`): only a `SUPER_ADMIN` may
create or change `ADMIN`/`SUPER_ADMIN` accounts; nobody changes their own role or deactivates themselves; the last
active `SUPER_ADMIN` cannot be demoted or deactivated (checked under a row lock); staff are deactivated, never deleted;
a new account starts with an unusable password and an invite email.

### 7.5 Capability gate by area

| Area (`/api/v1/admin/…`) | Read | Write / actions |
|---|---|---|
| `products`, `categories`, `brands`, `units`, `allergens` | `catalog.read` | `catalog.write`; product `availability` action: `catalog.availability`; `merchandising` action: `catalog.merchandise` |
| `collections` | `catalog.read` | `catalog.merchandise` |
| `reviews` (moderation) | `content.manage` | `content.manage` (approve, reject) |
| `promotions`, `coupons` | `promotions.manage` | `promotions.manage` |
| `banners`, `pages`, `articles`, `faqs` | `content.manage` | `content.manage` |
| `newsletter` | `content.manage` or `reports.export` | read-only (plus CSV export) |
| `contact-messages` | `customers.read` | `customers.read` (marking a message handled is a `POST …/handle/` guarded by the same capability) |
| `customers` | `customers.read` | `customers.manage` |
| `staff` | `staff.manage` | `staff.manage` |
| `branches`, `zones` | `catalog.read` | `branches.manage` |
| `closures`, `slot-templates`, `slots` | `catalog.read` | `slots.manage` |
| `orders` | `orders.read` | `orders.fulfil` (picking, packing, dispatch, complete, substitutions), `orders.manage` (cancel, assign, decide on behalf), `orders.refund` (refunds) |
| `cases` | `orders.read` | `support.manage` |
| `inventory/stock`, `movements`, `batches`, `expiry` | `inventory.read` | stock thresholds and `inventory/adjust`: `inventory.adjust`; `inventory/waste`: `inventory.waste`; `inventory/transfer`: `inventory.transfer`; batch status: `inventory.batches` |
| `suppliers`, `purchasing/replenishment` | `purchasing.read` | `purchasing.write` |
| `purchase-orders` | `purchasing.read` | create/update/submit/confirm/cancel: `purchasing.write`; `receive`: `purchasing.receive` |
| `payments`, `finance/reconciliation` | `finance.read` | read-only |
| `dashboard`, `reports/…` | `reports.read` | CSV export (`?export=csv`): `reports.export`, and it is audited as `report.exported` |
| `settings`, `settings/logo` | `settings.manage` | `settings.manage` |
| `audit` | `audit.read` | none |
| `me/permissions`, `my-branches` | any staff | — |

---

## 8. Background jobs

Celery application: `config/celery.py` (`autodiscover_tasks`), settings under the `CELERY_` namespace in
`config/settings/base.py`.

| Setting | Value | Effect |
|---|---|---|
| Broker | `CELERY_BROKER_URL`, else `REDIS_URL`, else `memory://` | Compose uses Redis db 1 |
| Result backend | none | Task results are not stored |
| `CELERY_TASK_ALWAYS_EAGER` | env `CELERY_ALWAYS_EAGER`; **dev default true**, test true, base/prod false | In dev and tests, tasks run inline |
| `CELERY_TASK_EAGER_PROPAGATES` | false (true in tests) | |
| `acks_late`, `reject_on_worker_lost` | true | A task is re-delivered if the worker dies; tasks are therefore written to be idempotent |
| Time zone | UTC | Beat schedules are plain intervals. A `task_prerun` hook (`config/celery.py`) activates the store timezone for each task |

### 8.1 Beat schedule

From `CELERY_BEAT_SCHEDULE`:

| Entry | Task | Every | What it does |
|---|---|---|---|
| `release-expired-reservations` | `apps.orders.tasks.release_expired_reservations` | 60 s | For each `PENDING_PAYMENT` order with `reservation_expires_at` in the past, `workflow.expire_unpaid()` runs in its own transaction: re-locks and re-checks, releases stock allocations, returns any committed items, releases the slot, voids the coupon redemption, voids open payments, and moves the order to `PAYMENT_FAILED`. A late payment arriving afterwards is voided (`payments.services.apply_event`). |
| `generate-delivery-slots` | `apps.stores.tasks.generate_delivery_slots` | 6 h | For each active branch, `generate_slots(branch, days_ahead=7)` creates missing `DeliverySlot` rows from active templates, skipping closures and times outside opening hours. Idempotent (`get_or_create` on the unique slot key). |
| `expiry-and-low-stock-scan` | `apps.inventory.tasks.expiry_and_low_stock_scan` | 1 h | Marks `ACTIVE` batches with `expiry_date < today` as `EXPIRED` (stock stays on hand until staff write it off as waste). Counts stock levels at or below their threshold and **logs** the number; no alert is sent. |
| `refresh-popularity` | `apps.catalog.tasks.refresh_popularity` | 3 h | Recomputes `Product.popularity` as units ordered in the last 30 days on non-substitute lines of orders that are not `CANCELLED`, `PAYMENT_FAILED` or `PENDING_PAYMENT`. If the window contains no such sales at all it leaves the existing ranking untouched (logs `popularity_unchanged_no_recent_sales`). |
| `requeue-stalled-emails` | `apps.notifications.tasks.requeue_stalled_emails` | 10 min | Outbox sweep: re-enqueues notifications recorded as `EMAIL_QUEUED` for over 10 minutes and retries `EMAIL_FAILED` ones for up to 24 hours. At-least-once delivery; the send task skips anything already sent. |
| `cleanup-idempotency-keys` | `apps.core.tasks.cleanup_idempotency_keys` | 24 h | Deletes `IdempotencyRecord` rows older than 7 days. |

### 8.2 On-demand tasks

| Task | Triggered by | Behaviour |
|---|---|---|
| `notifications.tasks.send_notification_email` | `notify_order()` after commit | `autoretry_for=(OSError,)`, exponential backoff, 3 retries. Sends only if the notification's channel is still `IN_APP`/`EMAIL_QUEUED`/`EMAIL_FAILED`. Stores the real outcome: `EMAIL_SENT`, or `EMAIL_LOGGED` when the backend is console/locmem/file/dummy, or `EMAIL_FAILED`. |
| `accounts.tasks.send_password_reset_email` | password reset request, staff invite | Same retry policy |
| `content.tasks.send_newsletter_confirmation` | newsletter subscribe | Double opt-in link |

### 8.3 Enqueue safety

`apps/core/async_utils.py` provides `safe_delay()` (never raises when the
broker is unreachable) and `enqueue_after_commit()`. `notify_order()` records the notification with channel
`EMAIL_QUEUED` **before** touching the broker and enqueues after the surrounding transaction commits, so a broker outage
cannot turn a committed order into an HTTP 500, and the sweep above finds anything lost. The password-reset request uses
`safe_delay` too (so the response is identical whether or not the account exists), and newsletter confirmation and
staff invites catch enqueue failures themselves. The behaviour is exercised by
`backend/tests/resilience/test_degraded_dependencies.py`.

---

## 9. Caching and graceful degradation

### 9.1 Backend

`CACHES["default"]` is `django_redis` when `REDIS_URL` is set, otherwise per-process `LocMemCache`.
Redis options: `IGNORE_EXCEPTIONS = True`, 1 s connect and socket timeouts, key prefix `orchardrow`.

`apps/core/cache.py` implements **namespaced versioning**: keys embed the namespace's version
(`<ns>:v<N>:<parts>`) and `bump(ns)` increments the version, invalidating a whole namespace in O(1). `key`, `bump` and
`get_or_set` all swallow cache exceptions (version falls back to 1; a failed `set` is logged as `cache_set_failed`).
Prices at checkout, stock decisions, carts, orders and payments are read from the database every time.

| Namespace | Cached object | TTL | Invalidated by |
|---|---|---|---|
| `settings` | `StoreSettings` row | 300 s | `StoreSettings.save()` |
| `catalog` | category tree with counts | 600 s | `Product`, `Brand`, `Category`, `Collection`, `CollectionItem` and collection M2M changes (`catalog/signals.py`) |
| `catalog` | active brands | 600 s | same |
| `catalog` | default branch id | 300 s | same signal set (not on `Branch` save: up to 5 minutes stale) |
| `catalog` | search suggestions per (branch, query) | 30 s | TTL and the same signals |
| `home` | home page payload per branch | 60 s | catalog changes, promotion changes, `Review` changes, and staff edits of banners and articles through the staff API (`content.admin_api.HomeCacheMixin`) |
| `promos` | active promotion definitions | 30 s | `Promotion` save/delete and its M2M changes. Catalog browsing, home, content and comparison use this cached index; cart pricing, checkout and substitution pricing call `load_index(use_cache=False)` |
| `dashboard` | dashboard KPIs per (period, branches) | 120 s | TTL only |
| `reports` | report tables per (name, period, branches) | 120 s | TTL only |

Stock is not invalidated into the `home` or `catalog` namespaces. The **home page payload includes each card's
availability status**, so "in stock / low / out" on the home page can be up to 60 s stale. Product list, product detail,
cart and checkout read availability live; checkout re-validates every line under row locks.

Not cached through these helpers: cart, checkout totals, stock, orders, payments, product listing/detail queries.

Other uses of the cache: login lockout counters (`loginfail:<email fp>:<ip>`, 15 min), DRF throttle counters,
the `readyz` probe key, and sessions (`cached_db`).

### 9.2 What happens when Redis is down

| Capability | Behaviour (from code) |
|---|---|
| Reads of cached data | `get` returns a miss, the factory runs, the failed `set` is logged. Slower, correct. |
| Sessions | `cached_db` falls back to the database; users stay signed in. |
| Invalidation | `bump` fails silently; versions revert to 1, so entries written while Redis was down are keyed to version 1 and TTLs bound staleness. |
| Throttling | DRF reads empty history on a failed cache read, so **throttles fail open** (every request is allowed). |
| Login lockout | The failed-attempt counter cannot be read or written, so the **lockout cannot trigger** (it fails open). |
| `/readyz` | `200` with `{"status":"degraded","checks":{"cache":"degraded"}}`; only the database makes it `503`. |
| Celery broker (same Redis in Compose) | Enqueue fails; handled by `safe_delay`/`enqueue_after_commit` and the outbox sweep (§8.3). Workers cannot consume while Redis is down. |
| Without `REDIS_URL` | `LocMemCache`: each gunicorn worker has its own cache, so a `bump` in one worker does not reach another; TTLs bound the staleness. Throttle counters are also per process. Broker falls back to `memory://`, which is only meaningful in eager mode. |

`backend/tests/resilience/test_degraded_dependencies.py` exercises browsing, readiness, cart, card checkout and
sign-in against an unreachable Redis URL, and order placement, idempotent replay, the email outbox and password reset
with a failing broker.

---

## 10. Frontend architecture

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS 4, Radix UI primitives, TanStack Query 5,
react-hook-form + zod. Tests: Vitest + Testing Library under `frontend/tests/`.

### 10.1 Route groups (`frontend/src/app`)

| Group | Layout | Pages |
|---|---|---|
| root | `layout.tsx` — `dynamic = "force-dynamic"`, loads store config, injects brand colours as CSS variables, wraps everything in `Providers`; `error.tsx`, `not-found.tsx`, `robots.ts`, `sitemap.ts` | — |
| `(site)` | Header, department navigation, branch picker, demo bar, footer, cart drawer | home, `shop`, `product/[slug]`, `collections/[slug]`, `new`, `offers`, `cart`, `compare`, `login`, `register`, `forgot-password`, `reset-password`, `account/*` (portal: overview, orders, addresses, favourites, lists), `orders/[number]`, `track`, `stores`, `guides` and `guides/[slug]`, `faq`, `contact`, `p/[slug]` (CMS pages), newsletter confirm/unsubscribe |
| `(checkout)` | Distraction-free header only | `checkout`, `pay/demo/[reference]` |
| `(admin)` | `AdminShell` (client-side auth and capability gate, capability-filtered sidebar, store switcher) | `/admin` dashboard plus a page for each of the 22 sidebar sections: orders, picking, support cases, customers, products, categories and brands, reviews, stock, batches and expiry, suppliers, purchase orders, replenishment, stores and zones, delivery slots, promotions and coupons, banners and pages, newsletter and messages, payments and refunds, reports, staff, store settings, audit log |

### 10.2 Server and client components

* **Pages are Server Components** that fetch public data with `serverGet()` (`src/lib/server.ts`, guarded by
  `import "server-only"`) and render client islands for interaction (`PurchasePanel`, `CartView`, `CheckoutView`,
  account views, the whole dashboard).
* `serverGet()` **never forwards cookies**, so what it fetches is safe to share through Next's data cache. It sets
  `next: { revalidate }` (20–120 s depending on the page; sitemap 1 h) and `tags`. Nothing calls `revalidateTag`, so
  revalidation is time-based only. 404 maps to `notFound()`.
* The shopper's chosen store lives in the `gc_branch` cookie (read in Server Components by `selectedBranch()`); the
  root layout is `force-dynamic` because every page reads live store settings and that cookie, so nothing is
  prerendered and the build needs no running backend.
* **Everything personal is fetched in the browser** through `src/lib/api.ts` with the user's cookie: cart, account,
  orders, checkout, dashboard.
* SEO helpers: `generateMetadata` per page, JSON-LD (`lib/jsonld.ts`), canonical URLs with filtered/paginated variants
  set to noindex, `robots.ts` fails closed (treats the store as demo, so disallows indexing, when settings cannot be
  read), `sitemap.ts` built from `/api/v1/seo/sitemap/`. A store in `demo_mode` is `noindex`.
* Product images are plain `<img>` elements with `srcset` built from the WebP variants the backend generated
  (`imgSrc`/`imgSrcSet` in `lib/format.ts`); `next/image` is not used.

### 10.3 API clients

| File | Runs | Behaviour |
|---|---|---|
| `src/lib/api.ts` | Browser | Base `/api/v1`, `credentials: "same-origin"`. For non-GET requests it ensures a CSRF cookie (fetching `/auth/csrf/` once if absent) and sends `X-CSRFToken`. Optional `Idempotency-Key` (`newIdempotencyKey()` = `crypto.randomUUID()`). Non-2xx responses become `ApiError {status, code, message, details, requestId}`; `fieldErrors` flattens nested serializer errors to dotted keys for forms. A network failure is `ApiError(0, "NETWORK_ERROR")`. |
| `src/lib/server.ts` | Next server | `BACKEND_INTERNAL_URL` (default `http://127.0.0.1:8000`), see above. |

### 10.4 TanStack Query

`makeQueryClient()` (`src/lib/hooks.tsx`): `staleTime` 20 s, `refetchOnWindowFocus`, retry up to twice but never on 4xx.
Query keys: `["me"]` (`GET /auth/session/`, which answers `{"user": null}` for visitors), `["cart"]`, `["favorites"]`, `["orders"]`,
`["admin","perms"]`. Mutations write the server's response straight into the cache (`setQueryData(["cart"], cart)`);
favourites use optimistic updates with rollback; sign-in invalidates cart, favourites and orders; sign-out clears the
cache. Comparison list is `localStorage` (`orchardrow.compare`, max 4) mirrored to the account with `PUT
/account/comparison/` when signed in. Store configuration is passed from the root layout through `StoreProvider`.

### 10.5 Why `/api` and `/media` are proxied same-origin

`next.config.ts` rewrites `/api/:path*/`, `/api/:path*` and `/media/:path*` to Django. The trailing-slash variant comes first and
`skipTrailingSlashRedirect` is on, because every Django API route ends in a slash and Next's default 308 redirect would
otherwise bounce `/api/v1/cart/` ⇄ `/api/v1/cart` forever. Reasons for the proxy, all visible in the code:

1. **First-party cookies**: the session cookie stays `HttpOnly` + `SameSite=Lax` and the CSRF double-submit works without
   cross-site cookie relaxations.
2. **No CORS surface**: the backend has no CORS middleware or allow-list to get wrong; the CSP says `connect-src 'self'`.
3. **The backend need not be public**: Compose publishes it on `127.0.0.1` only; Django admin (`/django-admin/`, off
   by default in production) and `/healthz` are not reachable through the storefront.
4. Production Django trusts the forwarded host and scheme (`USE_X_FORWARDED_HOST`, `SECURE_PROXY_SSL_HEADER`) because
   the public host arrives via the proxy.

Security headers are set in `next.config.ts`: CSP (`default-src 'self'`; `script-src 'self' 'unsafe-inline'`, plus
`'unsafe-eval'` in development), `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy.
`/media/*` responses are `Cache-Control: public, max-age=31536000, immutable`.

### 10.6 Design tokens

`src/app/globals.css`: Tailwind 4 `@theme` tokens.

* Fonts: Fraunces Variable (display) and Instrument Sans Variable (UI), both self-hosted via `@fontsource-variable`.
* Surfaces `paper`, `paper-2`, `sand`, `line`, `line-strong`; text `ink`, `ink-2`, `ink-3`; `leaf`, `citrus`.
* Brand colours `--brand-primary` and `--brand-accent` are editable in store settings; `app/layout.tsx` injects them on
  `<html>` only after validating `^#[0-9a-fA-F]{6}$`, and `primary-hover`, `primary-soft`, `accent-hover`,
  `accent-soft` derive from them with `color-mix`.
* Feedback colours `ok`, `warn`, `bad`, `info` each with a `-soft` surface, always paired with an icon or label.
* Radii `sm/md/lg`, shadows `card`/`pop`, breakpoint `xs`; `prefers-reduced-motion` and print rules.

### 10.7 Other client-side safeguards

CMS and article bodies are Markdown rendered by a small parser that returns a typed tree, never HTML
(`lib/markdown.ts`); post-login redirects go through `safeNextPath` (same-site relative paths only). The staff dashboard
gate (`components/admin/shell.tsx`) is a convenience: the API enforces the same rules.

---

## 11. Observability

| Aspect | Implementation |
|---|---|
| Correlation | `X-Request-ID` in and out (`RequestIDMiddleware`); the ID is on every log line, in the `request_id` field of error bodies, and on `AuditLog.request_id` |
| Logs | JSON on stdout via `apps/core/logging.py` (`ts`, `level`, `logger`, `msg`, `request_id`, plus `extra=` fields). Keys containing `password`, `token`, `authorization`, `cookie`, `secret`, `card`, `cvv`, `cvc`, `api_key`, `csrf` are redacted. Level from `LOG_LEVEL`; `django.request` and `django.security` at WARNING. gunicorn access log goes to stdout. Celery task log lines have `request_id` `-`. |
| Named events | e.g. `order_placed`, `order_transition`, `auth_failed`, `webhook_rejected`, `webhook_duplicate`, `webhook_processing_failed`, `payment_amount_mismatch`, `cache_set_failed`, `inventory_scan`, `popularity_refreshed`, `task_enqueue_failed` |
| Liveness | `GET /healthz` → `{"status":"ok"}`; used by the backend `HEALTHCHECK` |
| Readiness | `GET /readyz` → database `SELECT 1` and a cache round-trip; `200` `ok` or `degraded`, `503` `down` when the database fails; includes `latency_ms` |
| Audit trail | `AuditLog` (who, what, before/after, IP, request ID); `StockMovement` ledger; `OrderStatusHistory` timeline (internal `note` and customer-visible `public_note`) |
| Not present | Metrics endpoint, tracing, error-reporting service (§14) |

`/healthz` and `/readyz` live on the backend only; the storefront proxy does not forward them.

---

## 12. Configuration reference

All backend variables are read in `backend/config/settings/*.py` through `env()`, `env_bool()` (`1/true/yes/on`),
`env_int()` and `env_list()` (comma-separated). The settings code loads no `.env` file (there is no dotenv dependency);
Compose passes the variables listed in `docker-compose.yml`, and `make env` creates `.env` from `.env.example` with
generated secrets.

### 12.1 Backend

| Variable | Default | Purpose |
|---|---|---|
| `DJANGO_SETTINGS_MODULE` | `config.settings.dev` for `manage.py` and Celery; `config.settings.prod` for WSGI/ASGI; `config.settings.test` under pytest | Chooses the settings module |
| `DJANGO_SECRET_KEY` | `""` (dev falls back to a labelled insecure key) | Signing key. Production refuses to start unless it is ≥ 40 characters and does not start with `dev-only` |
| `DJANGO_DEBUG` | `false` (dev: `true`) | Debug mode; also gates serving `/media` through Django and `seed_demo` |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` (dev: `*`) | Production refuses an empty list or `*` |
| `CSRF_TRUSTED_ORIGINS` | empty, which then becomes `[FRONTEND_URL]` | Origins allowed for unsafe requests whose `Origin` differs from `Host` (the storefront proxy case) |
| `DJANGO_ADMIN_ENABLED` | follows `DJANGO_DEBUG` (dev: `true`) | Mounts `/django-admin/`; a break-glass tool, off in production unless turned on deliberately |
| `DATABASE_URL` | `postgres://grocery:grocery@127.0.0.1:5432/grocery` | PostgreSQL only (`database_from_url` hard-codes the engine) |
| `DB_CONN_MAX_AGE` | `60` | Persistent connections (health-checked) |
| `TIME_ZONE` | `UTC` (Compose and `.env.example`: `America/New_York`) | Django's process-default `TIME_ZONE`. The store's timezone is `StoreSettings.timezone`, which `StoreTimezoneMiddleware` activates per request and a Celery hook per task; keep `TIME_ZONE` equal to it for code that runs outside both (management commands) |
| `MEDIA_ROOT` | `<backend>/media` | Upload directory (`/data/media` in Compose) |
| `SERVE_MEDIA` | `false` | Serve `/media/` from Django when `DEBUG` is off — single-host/demo only |
| `IMAGE_UPLOAD_MAX_BYTES` | `5242880` | Per-upload limit in the image pipeline |
| `REDIS_URL` | empty → `LocMemCache` | Cache backend; also the default Celery broker |
| `CELERY_BROKER_URL` | `REDIS_URL`, else `memory://` | Broker |
| `CELERY_ALWAYS_EAGER` | `false` (dev: `true`) | Run tasks inline |
| `THROTTLE_ANON` / `THROTTLE_USER` | `240/min` / `600/min` | Default throttles |
| `THROTTLE_LOGIN` / `THROTTLE_REGISTER` | `10/min` / `10/hour` | Auth throttles |
| `THROTTLE_PASSWORD_RESET` | `5/hour` | |
| `THROTTLE_COUPON` / `THROTTLE_CHECKOUT` / `THROTTLE_TRACKING` | `20/min` / `30/min` / `20/min` | |
| `THROTTLE_NEWSLETTER` | `10/hour` | (`contact` has no variable; fixed fallback `5/hour`) |
| `EMAIL_BACKEND` | `django.core.mail.backends.console.EmailBackend` | Console backend only logs; notifications are then stored as `EMAIL_LOGGED` |
| `EMAIL_HOST` / `EMAIL_PORT` | `localhost` / `25` | SMTP server |
| `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | empty | SMTP credentials |
| `EMAIL_USE_TLS` | `false` | |
| `DEFAULT_FROM_EMAIL` | `Orchard Row <hello@example.invalid>` | |
| `FRONTEND_URL` | `http://localhost:3000` (trailing slash stripped) | Public storefront URL used in emails, the demo payment page and Stripe return URLs; also the default CSRF trusted origin |
| `STORE_CURRENCY` | `USD` | **Declared but not read anywhere**; the currency comes from `StoreSettings.currency` |
| `RESERVATION_TTL_MINUTES` | `15` | Payment window for card orders before stock is released |
| `PAYMENT_PROVIDER` | `demo` | `demo`, `stripe`; production forces `unconfigured` when `demo` is requested without opt-in |
| `PAYMENTS_ALLOW_DEMO` | `false` (dev and test: `true`) | Explicit opt-in to the demo adapter; `DemoProvider()` raises `ProviderError` without it |
| `PAYMENT_WEBHOOK_SECRET` | empty (dev: `dev-only-webhook-secret`) | HMAC secret for the demo provider's signed events |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | empty | Stripe adapter |
| `BACKEND_PUBLIC_URL` | `http://localhost:8000` | **Declared but not read anywhere** |
| `LOG_LEVEL` | `INFO` | Root logger level |
| `USE_X_FORWARDED_HOST` *(prod)* | `true` | Trust the forwarded host from the storefront proxy |
| `SECURE_SSL_REDIRECT` *(prod)* | `true` | HTTPS redirect |
| `SECURE_COOKIES` *(prod)* | `true` | Sets `SESSION_COOKIE_SECURE` and `CSRF_COOKIE_SECURE`; turn off only for a plain-HTTP local trial |
| `SECURE_HSTS_SECONDS` *(prod)* | `31536000` | |
| `TEST_MEDIA_ROOT` *(test)* | `/tmp/orchardrow-test-media` | |
| `DEMO_PASSWORD` | documented dev default | Shared password for `seed_demo` accounts |
| `CHROMIUM_PATH`, `PLAYWRIGHT_BROWSERS_PATH` | unset / `/opt/pw-browsers` | Used only by the demo-image generator (`backend/seed/art/render.py`) |

### 12.2 Frontend

| Variable | Default | Read in | Purpose |
|---|---|---|---|
| `BACKEND_INTERNAL_URL` | `http://127.0.0.1:8000` | `next.config.ts` (rewrites, **baked at build**), `src/lib/server.ts` (runtime) | Where Next reaches Django |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | `src/lib/server.ts` (`SITE_URL`) | Canonical URLs, sitemap, `metadataBase` |
| `NEXT_DIST_DIR` | `.next` | `next.config.ts` | Separate build output for parallel builds |
| `NODE_ENV` | set by Next | `next.config.ts` | Adds `'unsafe-eval'` to the CSP in development |
| `PORT`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED` | set in `frontend/Dockerfile` | Next | Server binding and telemetry |
| `E2E_BASE_URL`, `E2E_DATABASE_URL`, `E2E_CHROMIUM_PATH`, `E2E_DEMO_PASSWORD` | `http://localhost:3000`, `postgres://grocery:grocery@127.0.0.1:5432/grocery_e2e`, —, the documented demo password | `frontend/playwright.config.ts`, `frontend/e2e/support/*` | Storefront origin, the PostgreSQL URL the specs read to verify persisted state, an optional Chromium binary, and the shared demo password |

### 12.3 Compose / `.env` only

`POSTGRES_PASSWORD` (also used to build `DATABASE_URL`), `SITE_URL` (becomes `FRONTEND_URL` and
`NEXT_PUBLIC_SITE_URL`), and pass-through values for the variables above. `.env.example` documents each.

---

## 13. Key design decisions

Each entry records what was chosen, the alternatives that the code or `docs/implementation-plan.md` rule out, and the
price paid.

### 13.1 Modular monolith, not services
* **Chosen**: one Django project, 14 apps, one PostgreSQL database, one deploy unit (plus worker and beat from the same image).
* **Alternatives**: separate catalog / inventory / orders / payments services.
* **Why**: cart → stock → slot → coupon → order → payment must be consistent in one transaction (`checkout.place_order`).
  With services that would need sagas for every failure path.
* **Cost**: module boundaries are conventions, not walls (§4.2). Nothing but code review stops a lower app from importing a higher one.

### 13.2 Session cookies + CSRF, not JWT
* **Chosen**: `HttpOnly` session cookie (14 days), CSRF token echoed in `X-CSRFToken`, anonymous CSRF enforced too.
* **Alternatives**: bearer tokens or JWT held by JavaScript or in local storage.
* **Why**: no credential readable by script, trivial revocation (delete the session; password change keeps only the current one), staff and customers use the same mechanism.
* **Cost**: needs the same-origin proxy (§10.5); a native client would need a different credential flow.

### 13.3 Same-origin proxy, not a separate API origin
See §10.5. **Cost**: all API traffic passes through the Next.js server; rewrite destinations are baked at build time.

### 13.4 PostgreSQL full-text + trigram, not Elasticsearch
* **Chosen**: `Product.search_vector` (weighted `tsvector`: name A, derived `search_text` B, short description C, description D, `english` config) with a GIN index, prefix matching, plus `pg_trgm` similarity on `UPPER(name)` with a GIN trigram index, SKU and barcode exact matches; rank is `ts_rank + 0.6 × similarity` (`apps/catalog/search.py`).
* **Alternatives**: Elasticsearch/OpenSearch.
* **Why**: one datastore, transactional with the catalog, no sync pipeline.
* **Cost**: the vector is rebuilt by signal handlers (`catalog/signals.py`), not by the database, so `bulk_create` or `QuerySet.update` on products leaves it stale until `search.rebuild_index()` runs. `unaccent` is installed by migration but no query uses it, so no accent folding is applied to search. Query plans were not measured for this document (`docs/performance.md` was not present when it was written).

### 13.5 Reserve → commit → release inventory
* **Chosen**: reserve at order placement (`StockLevel.reserved`, FEFO `Allocation` rows for batch-tracked products), commit when the picker records the quantity (`on_hand` falls, `SALE` movement written, unused reservation released), release on cancel, expiry or short pick (`apps/inventory/services.py`).
* **Alternatives**: decrement stock at order placement (would need correcting afterwards for substitutions, short picks and weighed items), or only at picking (allows overselling between order and pick).
* **How it is made safe**: locks are taken in a fixed order (stock levels by product id, batches by id), and `CHECK reserved <= on_hand` is the last line of defence. A reservation that sits on a batch that became unsellable is re-allocated at pick time.
* **Cost**: more states to reason about (`Allocation`: RESERVED/COMMITTED/RELEASED) and a reconciliation function, `check_invariants()`, that compares levels, batches, allocations and the ledger.

### 13.6 Constraints as the last line of defence
Services check rules and raise helpful errors; the database refuses the impossible anyway (non-negative stock, `reserved ≤ on_hand`, `booked ≤ capacity`, one open payment per order, unique idempotency keys). The catalogue of what lives where is in `docs/data-model.md`.

### 13.7 Server-authoritative pricing and snapshots
Browser prices are display-only. `OrderItem` copies the name, SKU, unit, tax rate, base and effective price and promotion parameters at purchase, so later catalog edits never rewrite history (`docs/data-model.md`, snapshotting rules).

### 13.8 Payment provider abstraction with an isolated demo adapter
* **Chosen**: `PaymentProvider` interface (`create_payment`, `capture`, `void`, `refund`, `parse_webhook`; providers never touch the database), a registry `get_provider()`, and services that own every state change.
* **Demo adapter isolation**: it refuses to instantiate unless `PAYMENTS_ALLOW_DEMO` is true; `config/settings/prod.py` sets `PAYMENT_PROVIDER = "unconfigured"` if `demo` is requested without opt-in, and `get_provider("unconfigured")` raises; `/api/v1/store/` reports the mode so the UI labels demo payments; `Payment.is_demo` marks rows. Its "hosted page" posts to the backend, which signs an event and runs the **real** webhook path (signature, 300 s replay window, de-duplication, state transition).
* **Alternatives**: mocking the provider inside checkout, or a `DEBUG`-only shortcut that bypasses webhook handling. Both would leave production paths untested.
* **Cost**: the Stripe adapter has not been run against a live account (§14).

### 13.9 Webhook as the single source of truth for payment
Only a verified provider event moves a payment to `AUTHORIZED`; redirects are ignored. The event row and its side effects commit together, so if processing fails the row rolls back and the provider's retry re-processes it (`tests/orders/test_checkout.py`).

### 13.10 Decimal strings on the wire
`DecimalSafeJSONRenderer` guarantees that even a view returning a raw `Decimal` cannot leak a binary float (the docstring cites `51.94 → 51.939999…`). **Cost**: clients must treat amounts as strings and format them (`useMoney()`).

### 13.11 Capability matrix in code, not Django groups
Roles map to capabilities in a reviewable Python module, checked per HTTP method or DRF action, with branch scoping done in querysets. **Cost**: changing a role's capabilities is a code change and a deploy; there is no UI for it.

### 13.12 Outbox-style notifications
A notification row is written inside the business transaction (channel `EMAIL_QUEUED`), and the email is queued after commit; a beat sweep re-queues lost ones. The stored channel records what really happened (`EMAIL_SENT` vs `EMAIL_LOGGED`).

---

## 14. Not implemented / known gaps

### Not implemented
* **`apps/loyalty`** is a registered but empty app (`docs/implementation-plan.md` §4 calls it a stretch item).
* **Most of the Playwright end-to-end suite.** `frontend/playwright.config.ts` and two specs exist
  (`01-shopping-checkout`, `06-payment-failure-recovery`); the CI job and `make e2e` are named for six core workflows, and
  the other four have no spec yet.
* **Report export as a background task.** The plan lists `export_report_csv`; CSV export is synchronous
  (`?export=csv` in `apps/reports/views.py`).
* **Low-stock / expiry alerts.** The hourly scan flags expired batches and logs a count; nothing is sent to anyone.
* **Object storage / CDN for media.** Media is a filesystem volume (`FileSystemStorage`); production would need a
  storage backend and a different `SERVE_MEDIA` strategy.
* **Metrics, tracing and error reporting.**
* **Nonce-based CSP.** `script-src` allows `'unsafe-inline'` (noted in `next.config.ts`).
* **`next/image`, `revalidateTag`.** The plan mentions `next/image`; images are plain `<img>` with `srcset`. Cache tags
  are declared but never invalidated.
* **Documents referenced from code or the plan that were not present in `docs/` when this one was written**:
  `docs/performance.md`, `docs/commerce-workflows.md`, `docs/inventory-and-fulfilment.md`, `docs/reports.md`
  (module docstrings in `apps/orders/fulfilment.py`, `apps/inventory/services.py`, `apps/promotions/engine.py` and
  `apps/reports/queries.py` point at the last four; the plan points at `docs/performance.md`). `docs/security.md`,
  `docs/deployment.md` and `docs/seed-data.md` appeared while this document was being written and were not reviewed
  against it line by line.
* **Unused definitions**: error codes `BRANCH_CLOSED`, `INVALID_WEBHOOK`, `BATCH_BLOCKED`; capability
  `finance.refund`; settings `STORE_CURRENCY` and `BACKEND_PUBLIC_URL`; the `unaccent` extension.

### Defects and risks found while reading (not fixed here)
* **Client IP is client-influenceable.** Neither `REST_FRAMEWORK["NUM_PROXIES"]` nor a trusted-proxy rule is set;
  DRF's throttle identity uses the whole `X-Forwarded-For` header when `NUM_PROXIES` is unset, and
  `accounts/views.py: _client_ip` and `core/audit.py: _client_ip` take its first hop. A caller who sets that header can
  vary the throttle key, the login-lockout key and the IP recorded in `AuditLog`. Not exercised by any test.
* **Container healthcheck vs HTTPS redirect.** `SECURE_SSL_REDIRECT` defaults to true in production and no
  `SECURE_REDIRECT_EXEMPT` exists, so the in-container `HEALTHCHECK` (plain HTTP to `127.0.0.1:8000/healthz`) would be
  redirected to HTTPS. `.env.example` turns the redirect off for the local trial, which hides this. Derived from the code;
  not run.
* **Cache and broker share one Redis with `allkeys-lru`.** Under memory pressure Redis may evict Celery queue keys along
  with cache keys. Derived from `docker-compose.yml`; not observed.
* **Plain `AdminViewSet` does not translate unique-key races.** Branches, closures, zones, slot templates, slots and
  suppliers answer a concurrent duplicate with an unhandled `IntegrityError` (500) rather than the `409` that
  `AuditedViewSet` returns (§7.4).
* **Order key collisions.** `Order.checkout_key` has a **global** partial unique index while the idempotency record is
  scoped per actor; two different actors reusing the same key would pass the record check and hit the order index as an
  `IntegrityError` that `checkout._create_order` re-raises (500). Clients generate UUIDs, so this is theoretical.
* **Public API schema.** `/api/schema/` and `/api/docs/` are unauthenticated in every environment and, because `/api/*`
  is proxied, reachable through the storefront origin.
* **Media file names can be reused while `/media` is cached as immutable.** Category, banner, article and logo uploads
  use fixed base names (`upload.webp`, `logo.webp`); the storage picks the first free name and the replaced file is
  deleted only after the new one is saved, so a later replacement can receive a name used before, while
  `next.config.ts` serves `/media/*` with `max-age=31536000, immutable`. Product images use random names and are
  unaffected. Derived from `apps/core/admin_utils.py` and `apps/core/admin_views.py`; not tested.

### Could not be verified
* Stripe adapter against a live account (stated in its own docstring).
* Header forwarding through the Next.js rewrite in a production-like deployment (`X-Forwarded-Host/Proto/For`, HTTPS,
  raw webhook bodies). The Playwright specs in `frontend/e2e/` do go through the proxy against a running stack, but
  running a stack was out of scope here, so none of it was exercised.
* The Docker images and Compose stack were not built or run; Compose facts come from reading the files.
* Performance targets (LCP, INP, CLS, query plans): no measurements exist in the repository.
* Mermaid diagrams were validated with the Mermaid parser; they were not rendered visually.
