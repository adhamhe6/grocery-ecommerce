# Deployment and operations

> **Read this first.** Getting `docker compose up` to start proves that the images build and the processes boot. It does
> **not** make a deployment production-ready: TLS, secrets management, backups, monitoring, a real payment provider and a
> security review of your own configuration are still on you. Section 12 lists what has and has not been verified in this
> repository.

## 1. What runs

| Service | Image / process | Purpose | Port |
| --- | --- | --- | --- |
| `frontend` | Next.js 15 (standalone Node server) | Storefront **and** staff dashboard; proxies `/api/*` and `/media/*` to the backend, so browsers only ever talk to this origin | 3000 |
| `backend` | Django 5.2 + DRF under gunicorn (3 workers × 2 threads) | API, business rules, WhiteNoise for static files | 8000 (bound to localhost in Compose) |
| `worker` | Celery worker (same image as backend) | Email delivery, background jobs | – |
| `beat` | Celery beat (same image) | Scheduled jobs (see §6). **Run exactly one.** | – |
| `migrate` | one-shot, same image | `manage.py migrate --noinput` before backend/worker/beat start | – |
| `postgres` | PostgreSQL 16 | System of record | 5432 (internal) |
| `redis` | Redis 7 | Cache and Celery broker (AOF on) | 6379 (internal) |
| `seed` | one-shot, profile `tools` | Loads **demo** data — never against real data | – |

Health endpoints (both unauthenticated, no sensitive data): `GET /healthz` (process is up) and `GET /readyz`
(database is required; Redis missing reports `degraded` but still returns 200 because the application keeps serving
without it — verified by `tests/resilience/`). In Compose the backend and frontend images define container health checks and
the frontend waits for a healthy backend.

## 2. Local trial with Docker Compose

```bash
git clone <repository-url> grocery-ecommerce && cd grocery-ecommerce
make env          # copies .env.example to .env and generates DJANGO_SECRET_KEY, PAYMENT_WEBHOOK_SECRET, POSTGRES_PASSWORD
make up           # docker compose up --build -d  (builds both images, runs migrations, starts everything)
make seed         # loads the deterministic DEMO store (139 products, 2 stores, accounts, promotions …) — ~1 minute
```

(`cp .env.example .env` works too, but then you must fill the three empty secrets yourself — Compose refuses to start
without them.)

| What | Where |
| --- | --- |
| Storefront | http://localhost:3000 |
| Staff dashboard | http://localhost:3000/admin (sign in with a staff demo account) |
| API reference (OpenAPI/Swagger) | http://localhost:8000/api/docs/ (schema at `/api/schema/`) |
| Health | http://localhost:8000/healthz · http://localhost:8000/readyz |

Demo accounts (created **only** by `seed_demo`; development use only, password documented in `docs/seed-data.md`):
`admin@demo.orchardrow.test`, `manager.central@…`, `inventory@…`, `purchasing@…`, `picker@…`, `support@…`, `marketing@…`,
and customers such as `alex@…`. They must never exist in a real deployment.

Everyday commands: `make logs`, `make down` (keeps volumes), `docker compose down -v` (also deletes the database, Redis
and media volumes), `docker compose exec backend python manage.py <command>`, `docker compose exec worker celery -A config inspect ping`.

The Compose file is a **local, production-like** stack. It runs plain HTTP, so `.env.example` sets `SECURE_COOKIES=false`,
`SECURE_SSL_REDIRECT=false` and `SECURE_HSTS_SECONDS=0`. Never carry those three values into a real deployment.
Media is served by Django (`SERVE_MEDIA=true`) from a Docker volume, which is fine for one host and demos only.

## 3. Local development without Docker

Prerequisites: Python 3.13, Node 22, PostgreSQL 16 (the migrations run `CREATE EXTENSION` for `pg_trgm` and `unaccent`, which
need the contrib package and a role allowed to create trusted extensions), Redis 7 (optional; the app degrades without it).

```bash
make backend-install frontend-install
createdb grocery && psql -c "CREATE USER grocery WITH PASSWORD 'grocery' SUPERUSER" # dev convenience only
cd backend && .venv/bin/python manage.py migrate && .venv/bin/python manage.py seed_demo
.venv/bin/python manage.py runserver                       # API on :8000 (config.settings.dev, DEBUG on)
cd ../frontend && npm run dev                              # storefront on :3000, proxies /api to :8000
```

Set `DATABASE_URL`, `REDIS_URL`, `FRONTEND_URL`, `TIME_ZONE` as needed (see `.env.example` and the full table in
`docs/architecture.md`). Development settings run Celery tasks eagerly (`CELERY_ALWAYS_EAGER`), so no worker is needed.

## 4. Configuration

Everything is environment-driven; the authoritative list (every variable, default and purpose) is in
`docs/architecture.md` §Configuration, generated from `backend/config/settings/*.py`. The ones you must decide for a real
deployment:

| Variable | Notes |
| --- | --- |
| `DJANGO_SECRET_KEY` | ≥ 40 random characters. Production **refuses to boot** with a missing, short or `dev-only…` value. |
| `DJANGO_ALLOWED_HOSTS` | Explicit hostnames. A wildcard is refused in production. |
| `FRONTEND_URL` / `CSRF_TRUSTED_ORIGINS` | The public storefront origin (no trailing slash). It is trusted for CSRF because the storefront proxies the API. |
| `DATABASE_URL`, `REDIS_URL`, `CELERY_BROKER_URL` | Managed PostgreSQL and Redis recommended. |
| `PAYMENT_PROVIDER`, `PAYMENTS_ALLOW_DEMO`, `PAYMENT_WEBHOOK_SECRET`, `STRIPE_*` | `demo` never moves money and must stay off in production. See §8. |
| `EMAIL_*`, `DEFAULT_FROM_EMAIL` | The default backend only **logs** emails. Notifications record `EMAIL_LOGGED` vs `EMAIL_SENT` honestly. |
| `TIME_ZONE` | **Must equal the store timezone** (Dashboard → Store settings). The process also activates the store timezone per request and per task, but keeping them equal avoids surprises in logs and cron-like scheduling. |
| `SECURE_COOKIES`, `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` | Leave at secure defaults behind HTTPS. |
| `DJANGO_ADMIN_ENABLED` | Off by default outside DEBUG. The staff dashboard is the supported interface. |
| `SERVE_MEDIA` | Off by default. See §5. |
| `BACKEND_INTERNAL_URL` (frontend build **and** runtime) | Where the storefront proxies `/api`. It is baked into the Next build as a build argument; rebuild the frontend image if it changes. |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap/Open Graph. |
| `THROTTLE_*` | Rate-limit scopes (login, register, checkout, …). |

## 5. First run on a real (empty) database

1. `python manage.py migrate` (the Compose `migrate` service does this). Migrations create all constraints and the
   reference data (sale units, allergens, …) — no manual schema edits.
2. `python manage.py createsuperuser` (email + full name + password) — creates a `SUPER_ADMIN`.
3. Sign in at `/login`, open `/admin`:
   1. **Store settings** — name, contact details, currency, **timezone**, tax label/inclusion, brand colours, logo,
      payment toggles; leave "demo store" off.
   2. **Stores & zones** — create a store, its opening hours, delivery zones (postcodes/areas, fee, free-delivery threshold,
      minimum order).
   3. **Delivery slots** — create slot templates, then *Generate slots* (a beat task keeps generating ahead).
   4. **Catalogue** — categories, brands, products (units and quantity rules, trust data, images).
   5. **Inventory / Purchasing** — suppliers, purchase orders, **receive goods** (lot + expiry for perishables) so products
      become available; or adjust stock for untracked items.
   6. **Staff & roles** — invite staff with least-privilege roles; assign stores to branch-scoped roles.
4. Do **not** run `seed_demo` (it refuses without `--force` when `DEBUG` is off).

Media (product/banner/brand images) is written to `MEDIA_ROOT`. The application does **not** include an object-storage
backend (no S3/GCS adapter): either mount a persistent volume shared by `backend` and `worker` and have your reverse proxy
serve `/media/` from it, or add `django-storages` and set `STORAGES["default"]` yourself (a small change, untested here).
Leave `SERVE_MEDIA` off in production.

## 6. Background jobs

`beat` schedules (from `CELERY_BEAT_SCHEDULE`): release expired card reservations (every minute), generate delivery slots (6 h),
expiry & low-stock scan (hourly; flags expired batches), refresh popularity (3 h), requeue stalled emails (10 min), clean old
idempotency keys (daily). Every task is idempotent, so a duplicate run or a worker restart is safe; `acks_late` and
`reject_on_worker_lost` are enabled. Run one `beat` process only (two would double-schedule, which is harmless but wasteful).

If the broker is unreachable, requests still succeed: confirmation emails are recorded as `EMAIL_QUEUED` and re-queued by the
sweeper once the broker returns (`tests/resilience/`).

## 7. Observability

* Logs: structured JSON to stdout, one line per event, with `request_id` (also returned as `X-Request-ID`; quote it in bug
  reports). Passwords/tokens/cookies are scrubbed. Authentication failures, order creation, payment events, stock movements,
  refunds, task runs and unhandled exceptions are logged.
* Health: `/healthz`, `/readyz`, container health checks.
* **Not implemented**: metrics endpoint (Prometheus/StatsD), distributed tracing, error-tracker integration (e.g. Sentry),
  alert rules. Add them at the platform layer; `docs/performance.md` lists the signals worth alerting on.

## 8. Payments in deployment

* **Demo adapter** (`PAYMENT_PROVIDER=demo` + `PAYMENTS_ALLOW_DEMO=true`): simulated provider page, no card data, no money.
  It exists for demonstrations and tests. In production without the explicit opt-in the provider resolves to
  `unconfigured` and card checkout is refused (cash-on-delivery, if enabled, still works).
* **Stripe adapter** (`PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`): manual-capture PaymentIntents
  and signed webhooks. **It has not been run against a live or sandbox Stripe account in this repository.** Treat enabling it as
  a project of its own: point the webhook at `https://<api-host>/api/v1/payments/webhook/stripe/`, test authorise → capture
  (below the authorised amount for weighed orders) → partial refund → webhook replay in Stripe test mode first.
* Webhook endpoints must be reachable from the provider; because the storefront proxies `/api`, either expose the backend
  directly for `/api/v1/payments/webhook/*` or route through the storefront.

## 9. Backups, restore and upgrades

**Database** (the system of record; everything else is rebuildable):

```bash
# logical backup (consistent snapshot)
docker compose exec -T postgres pg_dump -U grocery -Fc grocery > backup-$(date +%F).dump
# restore into an empty database
docker compose exec -T postgres pg_restore -U grocery -d grocery --clean --if-exists < backup-YYYY-MM-DD.dump
```

For production use managed PostgreSQL with point-in-time recovery and test restores on a schedule. **Media**: back up the
media volume/bucket with the database (a restored database references files by path). **Redis**: cache and queue only — losing
it loses cache and un-run tasks (stalled emails are re-queued from the database by the sweeper), not business data. After any
restore run `python manage.py shell -c "from apps.inventory.services import check_invariants; print(check_invariants())"`;
an empty list means stock levels, batches, allocations and the movement ledger agree.

Upgrade procedure: build new images → run the `migrate` step (read each release's migrations before applying them) →
roll backend/worker/beat → roll frontend. Because the API is versioned (`/api/v1`) and the frontend ships separately, run the
backend first. Rollback = previous images; a migration rollback needs a database restore unless the release says otherwise.

**No backup/restore drill, failover or load balancer topology has been exercised in this repository** — the commands above are
standard PostgreSQL practice, not a verified runbook for your environment.

## 10. Scaling and topology notes

* The backend is stateless (sessions in the database-backed cache, carts in the database); scale `backend` horizontally behind
  a load balancer. Correctness under concurrency relies on PostgreSQL row locks and constraints, not on process-local state
  (proven with real threads in `tests/orders/test_checkout.py::TestConcurrency`).
* Tune `gunicorn` workers/threads and `DB_CONN_MAX_AGE` to your database's connection budget (default 3×2 per container,
  persistent connections with health checks).
* Put a TLS-terminating reverse proxy (or load balancer/CDN) in front; it must set `X-Forwarded-Proto: https`
  (`SECURE_PROXY_SSL_HEADER`) and forward `X-Forwarded-Host`. Cache `/media/*` and `/_next/static/*` aggressively (both are
  content-addressed).

## 11. Go-live checklist

- [ ] HTTPS everywhere; HSTS on; cookies `Secure` (do not set `SECURE_COOKIES=false`).
- [ ] Strong unique secrets from a secret manager; none in the repository or image.
- [ ] `PAYMENTS_ALLOW_DEMO` unset; real provider verified end to end in its test mode; webhook secret set.
- [ ] Real email backend configured and a test order email received; `DEFAULT_FROM_EMAIL` on a domain you control with SPF/DKIM.
- [ ] No demo data or demo accounts; store settings reviewed (timezone, tax, tolerance %, policies, legal pages replaced —
      the seeded policy pages are **template wording, not legal advice**).
- [ ] Social links are real or removed (`socials_are_placeholders` off).
- [ ] MFA for staff (not built in — use an SSO/identity-aware proxy in front of `/admin` until it is).
- [ ] Backups + restore test; media persisted; monitoring and alerts; log retention.
- [ ] Dependency audits green (`pip-audit`, `npm audit` in CI) and the items in `docs/security.md` §Known gaps triaged.
- [ ] Load test at your expected traffic with `backend/scripts/perf/` (see `docs/performance.md`) on production-like hardware.

## 12. Verification status of this document

| Statement | Status |
| --- | --- |
| `docker compose config` validates | Verified locally with a generated `.env` (and in CI) |
| Backend image builds, `migrate` succeeds, container health check turns healthy, `/readyz` reports database + cache OK, static files served, process runs as non-root, media not served when `SERVE_MEDIA` is off | Verified locally (Docker daemon in a sandbox) |
| Frontend image builds and serves | See the release notes / PR for the latest result — verified only where stated |
| Full `docker compose up` with PostgreSQL and Redis images | **Not run to completion in the build environment** (Docker Hub rate limiting blocked pulling the database images); the pieces were run individually against local PostgreSQL/Redis |
| Backup/restore, TLS, load balancing, Stripe | Not exercised |
