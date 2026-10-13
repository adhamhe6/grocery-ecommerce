# Security review

This document records what the platform does to protect customers, staff and money, **what evidence exists for each
claim**, and what is deliberately *not* done. It is a review of this repository's code and tests — not a certification,
penetration test or compliance attestation (PCI DSS, SOC 2, GDPR etc. are out of scope and nothing here should be read as
a compliance claim).

Evidence column conventions: `tests/…` paths are in `backend/`; `e2e/…` and `tests/…` under `frontend/` are named
explicitly. "Verified by test" means an automated test fails if the behaviour is removed; "by design" means the property
follows from the code structure but has no dedicated test.

## 1. Threat model (summary)

| Asset | Threat | Primary controls |
| --- | --- | --- |
| Customer accounts and addresses | Credential stuffing, session theft, IDOR | Argon2, lockout + throttles, HttpOnly/SameSite cookies, owner-scoped querysets |
| Orders and payments | Tampered prices, forged "payment succeeded", double submit, replay | Server-side pricing, signed webhooks, idempotency keys, state machine, row locks |
| Staff dashboard | Privilege escalation, cross-store access | Capability matrix, branch scoping, route-sweep test, immutable audit log |
| Stock and delivery slots | Overselling by races | DB CHECK constraints, row locks, conditional UPDATE for slots, concurrency tests |
| Content (CMS, reviews, recipes) | Stored XSS, open redirects | No raw HTML anywhere, safe markdown renderer, link allow-list |
| Uploads | Malicious files, decompression bombs | Pillow re-encode to WebP, format allow-list, size and pixel caps |
| Secrets | Leakage via repo or logs | Env-only config, production refuses weak secrets, log scrubbing |
| Availability | Broker/Redis outage, floods | Fail-safe enqueue, cache degradation, throttles |

## 2. Authentication and sessions

* **Password storage** — Argon2 (`PASSWORD_HASHERS` in `config/settings/base.py`), PBKDF2 accepted for migration only.
  Validators: minimum length 10, common-password, numeric-only and user-attribute similarity. Verified by test:
  `tests/accounts/test_auth.py::test_weak_passwords_rejected`, `test_register_creates_user_hashes_password_and_signs_in`.
* **Session cookie** — `HttpOnly`, `SameSite=Lax`, `Secure` in production (`SECURE_COOKIES`, default on; turning it off
  exists solely for a plain-HTTP local trial of the production stack and is documented as such). Verified by test:
  `test_login_logout_roundtrip_and_session_cookie_flags`.
* **Login protection** — generic failure message (no account enumeration), per-IP+email failure counter with a 15 minute
  lockout, plus the `login` throttle scope. Verified by test: `test_invalid_credentials_have_generic_message`,
  `test_login_locks_out_after_repeated_failures`. Inactive users cannot sign in (`test_inactive_user_cannot_log_in`).
* **Password reset** — signed, single-use, 2-hour tokens; identical `202` response whether or not the account exists —
  including while the task queue is down (`tests/resilience/test_degraded_dependencies.py::test_password_reset_answers_identically_when_the_broker_is_down`).
  Forged uid/token rejected (`test_password_reset_rejects_forged_token_and_uid`).
* **Role escalation** — profile and registration endpoints ignore `role`, `is_staff`, `email` changes
  (`test_profile_update_cannot_escalate_role`). Staff creation/role changes require `staff.manage`; a staff member cannot
  change their own role or deactivate themselves, and the last active super admin cannot be removed
  (`tests/admin/test_accounts_admin.py`).
* **Session fixation** — Django's `login()` rotates the session key.
* **Not implemented**: multi-factor authentication for staff, device/session management UI, CAPTCHA. For a real launch,
  MFA for every staff role should be treated as a requirement.

## 3. CSRF and cross-origin behaviour

* The browser only talks to one origin: the storefront proxies `/api` and `/media` to Django, so there is **no CORS**
  configuration at all and cookies stay first-party.
* The API uses `CSRFSessionAuthentication` (`apps/core/authentication.py`), which enforces CSRF on **every unsafe method,
  including for anonymous users** (a guest cart and guest checkout are session-backed too). Verified by test:
  `test_login_requires_csrf_token_like_a_real_browser`, `test_authenticated_unsafe_requests_need_csrf`.
* Because the storefront proxies the API, requests arrive with `Origin: <storefront>` and a different `Host`. The storefront
  origin (`FRONTEND_URL`) is therefore a trusted CSRF origin by default and `CSRF_TRUSTED_ORIGINS` can add more. A foreign
  origin presenting a valid token is refused. Verified by test:
  `test_csrf_trusts_the_storefront_origin_that_proxies_the_api_and_nothing_else`. (This was a real defect found by the
  browser E2E suite: every write returned 403 behind the proxy until the origin was trusted.)
* Next.js is configured with `skipTrailingSlashRedirect` and explicit trailing-slash rewrites; without them the proxy
  looped between Next's and Django's slash redirects (found by browser testing).

## 4. Authorisation

* **Capability matrix** — `apps/core/rbac.py` maps nine roles to 30 verb-style capabilities; `HasCapability` is applied to
  every staff endpoint and gates each HTTP method/action. The UI hides controls the user cannot use, but the server is
  authoritative.
* **Route sweep (verified by test)** — `tests/security/test_route_sweep.py` enumerates every staff route in the live URL
  configuration (OpenAPI endpoint enumerator, so new routes are covered automatically) and asserts, for **every method**,
  that an anonymous visitor gets 401/403 and a signed-in customer gets 403 — 400+ parametrised checks at the time of
  writing — plus that personal endpoints (`/account/*`, `/addresses/`, `/orders/`, `/lists/`, …) refuse anonymous callers.
* **Branch scoping** — non-global roles only see and modify data of their assigned stores (`scope_by_branch`,
  `ensure_branch_access`). Verified by test: `tests/admin/test_orders_admin.py::test_branch_staff_cannot_see_or_touch_other_branches_orders` and the inventory/stores equivalents.
* **Object-level access (IDOR)** — customer data is reached through owner-scoped querysets, so another customer's object is a
  404, never a 403 that confirms it exists: addresses (`test_addresses_are_private_to_their_owner`), orders
  (`test_owner_only_for_signed_in_orders`), saved addresses at checkout (`test_address_must_belong_to_the_customer`).
  Guests reach an order only with its unguessable tracking token or by number + the checkout email through a throttled
  endpoint (`test_guest_access_needs_the_tracking_token_or_email`).
* **No raw status writes** — no endpoint accepts an order status from a client; transitions go through
  `apps/orders/workflow.py` (`test_no_api_accepts_an_arbitrary_status`, `test_no_endpoint_accepts_a_raw_status`).
* **Audit trail** — every staff create/update/delete writes an immutable `AuditLog` row with before/after snapshots in the
  same transaction as the change (`AdminViewSet.perform_*` are atomic; sensitive keys such as passwords and tracking tokens
  are never snapshotted). Price changes and report exports are audited explicitly.
* **Django admin** (`/django-admin/`) is a break-glass tool and is **disabled unless `DJANGO_ADMIN_ENABLED=true`** (default:
  on only when `DEBUG`). Restrict its path at the reverse proxy if you enable it.

## 5. Money, payments and fraud-relevant integrity

* **Server-side pricing only** — the client sends product ids and quantities; unit prices, promotions, coupons, delivery,
  tax and totals are recomputed on the server at every step (`test_client_supplied_prices_are_ignored`). An `expected_total`
  mismatch returns 409 with a fresh quote instead of charging a different amount (`test_stale_expected_total_returns_409_with_fresh_quote`).
* **A redirect never confirms an order** — card orders stay `PENDING_PAYMENT` until a **verified provider event** arrives
  (`test_redirect_alone_never_confirms_the_order`, `test_verified_webhook_confirms_exactly_once`).
* **Webhook verification** — HMAC signature with timestamp tolerance (replay protection), amount check, unknown payments
  ignored safely, processing errors roll the event back so the provider's retry works, events de-duplicated by
  `unique(provider, event_id)` (`tests/orders/test_checkout.py::TestWebhookSecurity`: bad signature, malformed header, stale timestamp,
  tampered body, amount mismatch, unknown payment, rollback on failure).
* **Idempotency** — `Idempotency-Key` is required for checkout; the same key returns the same order, the same key with a
  different body is rejected (`test_same_key_returns_same_order_without_side_effects`, `test_same_key_with_different_details_is_rejected`,
  `test_double_click_double_submit_creates_one_order`). Refund requests are idempotent too, including after a full refund
  (regression `test_retry_of_a_full_refund_returns_the_same_refund_instead_of_an_error`).
* **Charge ceiling** — capture is capped at the authorised amount; for weighed items the authorisation is the estimate plus the
  documented tolerance, and the customer is never charged above it (`tests/orders/test_fulfilment.py` weight tests).
* **Concurrency** — oversell and slot overbooking are prevented by DB constraints + locks and proven with real threads against
  PostgreSQL: `TestConcurrency::test_stock_cannot_be_oversold_across_concurrent_checkouts`,
  `test_last_slot_place_is_won_by_exactly_one_checkout`, `test_coupon_usage_limit_holds_under_concurrency`,
  `tests/inventory/test_inventory.py` (20-thread reserve race).
* **The demo payment adapter is not a payment processor.** It never handles card data, refuses to start unless
  `PAYMENTS_ALLOW_DEMO=true`, is off by default in production (`PAYMENT_PROVIDER` falls back to `unconfigured`), its hosted
  page (`/pay/demo/<ref>`) returns 404 whenever the adapter is inactive, and everything it produces is flagged `is_demo`
  and labelled in every UI. (`test_demo_adapter_is_inert_unless_explicitly_allowed`,
  `test_card_refused_when_no_provider_is_configured`, `test_unknown_provider_and_demo_endpoint_disabled_in_non_demo_mode`.)
* **The Stripe adapter has not been exercised against a live or sandbox Stripe account in this repository.** It is written
  against Stripe's documented API (manual-capture PaymentIntents, signed webhooks) and unit-tested with the provider
  boundary mocked. Before taking real payments: run it against Stripe test mode end to end (authorise, capture below the
  authorised amount, refund, webhook replay), pin the API version, and have the integration reviewed.
* Card data never touches this system: with a real provider the customer pays on the provider's hosted page.

## 6. Input handling and output encoding

* **Validation** — DRF serializers validate every payload; unknown fields are ignored, not mass-assigned. Search input goes
  through parameterised ORM queries and a sanitised `tsquery` builder (`apps/catalog/search.py`).
* **XSS** — React escapes by default and there is no `dangerouslySetInnerHTML` for user- or staff-authored content. CMS pages,
  articles, recipes and FAQ answers are Markdown parsed into a typed tree and rendered as React elements
  (`frontend/src/lib/markdown.ts`); raw HTML is shown as text, and link targets are limited to `http(s)`, `mailto`, `tel`, `#`
  and root-relative `/` paths — `javascript:`, `data:` and protocol-relative `//host` links lose their link
  (`frontend/tests/markdown.test.tsx` renders attack strings and inspects the real DOM). The only `dangerouslySetInnerHTML`
  is JSON-LD, with `<` escaped.
* **Open redirects** — the login `?next=` parameter is validated as a same-site relative path
  (`frontend/src/lib/safe-next.ts`, `frontend/tests/account/`), and banner/CMS links are validated server-side
  (`SAFE_LINK`; protocol-relative `//evil.example` was found by review and fixed).
* **CSV/formula injection** — report exports prefix risky cells (`test_formula_injection_is_neutralised`).
* **Uploads** — images are decoded with Pillow, restricted to JPEG/PNG/WebP (SVG and anything else refused), size-limited
  (`IMAGE_UPLOAD_MAX_BYTES`), pixel-limited (decompression-bomb guard), orientation-normalised, **re-encoded to WebP with all
  metadata dropped**, and stored under server-generated names (no user-controlled paths). Verified by tests
  `test_unsafe_category_images_are_rejected`, `test_unsafe_banner_images_are_rejected`, `test_oversize_logo_is_rejected`,
  `test_upload_stores_a_normalised_original`.
* **SSRF** — the backend never fetches a user-supplied URL.

## 7. Transport, headers and browser hardening

* Production settings (`config/settings/prod.py`): `SECURE_SSL_REDIRECT`, HSTS (1 year, subdomains), `Secure` cookies,
  `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS=DENY`, strict referrer policy, `SECURE_PROXY_SSL_HEADER`. The process
  **refuses to boot** with a missing/short/`dev-only` secret key or wildcard `ALLOWED_HOSTS`.
* Storefront (`frontend/next.config.ts`): `Content-Security-Policy` (default-src 'self'; `frame-ancestors 'none'`;
  `object-src 'none'`; `form-action 'self'`; `base-uri 'self'`), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`. **Known weakness:** `script-src` allows `'unsafe-inline'` because Next injects
  inline bootstrap scripts; moving to nonces requires a middleware and is listed under gaps.
* Pages that carry secrets in the URL (password-reset, newsletter links) send `Referrer-Policy: no-referrer`; order pages
  accessed with a tracking token are `noindex`.
* Demo stores are never indexed (`robots.txt` disallows everything and pages carry `noindex` when `demo_mode` is on).

## 8. Rate limiting and abuse

DRF throttle scopes (env-tunable): `anon`, `user`, `login`, `register`, `password_reset`, `coupon`, `checkout`, `tracking`,
`newsletter`, `contact`. Verified by test for login lockout, newsletter and contact throttling. The throttles use the
Redis-backed cache in production; if Redis is down the application keeps serving (cache failures are swallowed) and
throttles degrade to per-process behaviour — a documented trade-off in favour of availability.

## 9. Secrets, configuration and logging

* All configuration is environment-based; `.env` and `.env.*` are git-ignored, `.env.example` contains no secrets and
  `make env` generates random values. `docker-compose.yml` refuses to start without the three required secrets.
* A `git grep` over tracked files for Stripe/webhook/AWS/GitHub/Slack key formats and private-key headers found nothing;
  the only secret-looking literals are the documented demo password (`apps/core/seed/accounts_data.py`) and the test-only
  settings constants (`config/settings/test.py`, `dev.py`). Only `.env.example` files are tracked.
* Structured JSON logs carry a request id (`X-Request-ID`) and **scrub** keys such as `password`, `token`, `authorization`,
  `cookie`, `secret`, `card`, `cvv`, `api_key`, `csrf` (`apps/core/logging.py`). Failed logins log an email *fingerprint*,
  not the address. Production errors return a generic envelope with the request id; stack traces stay in logs.
* **Demo credentials** (`*@demo.orchardrow.test`, shared dev password) exist only if someone runs `manage.py seed_demo`, which
  refuses to run when `DEBUG` is off unless `--force` is passed, labels its output as demo data and is documented as
  development-only in `docs/seed-data.md`.

## 10. Dependency and supply-chain hygiene

* CI runs `pip-audit` on `requirements/base.txt` and `npm audit --omit=dev --audit-level=high`.
* A review-time audit found and fixed: Pillow 11.3 (multiple advisories → 12.x), Django REST framework 3.16.1 (→ 3.17.x), and a
  vulnerable PostCSS bundled by Next.js (forced to a patched version with an npm `overrides` entry). After the fixes both
  audits report no known vulnerabilities for production dependencies at the time of writing; new advisories appear
  continuously, so this must stay a CI gate rather than a one-off.
* Lockfiles are committed (`package-lock.json`); Python requirements are pinned to minor series, not hashes.
* Containers run as a non-root user; the backend image needs no system packages.

## 11. Resilience as a security property

`tests/resilience/` proves that browsing, cart, sign-in and checkout keep working with Redis unreachable, that a placed
order survives a dead Celery broker (found by these tests: the confirmation-email enqueue used to raise inside an
`on_commit` hook and turn a committed order into a 500), and that stalled emails are re-queued by a sweeper.

## 12. Known gaps and recommended next steps

1. MFA for staff and admin roles; session listing/revocation.
2. Nonce-based CSP (remove `'unsafe-inline'` from `script-src`), plus a CSP report endpoint.
3. Live-sandbox verification of the Stripe adapter; webhook IP allow-listing if the provider publishes ranges.
4. Bot protection (CAPTCHA/proof-of-work) on registration, contact and newsletter forms; throttles alone are only a floor.
5. Static analysis in CI (e.g. Bandit/CodeQL, ESLint security rules) and container image scanning.
6. Encrypt-at-rest and backup policy are deployment concerns (see `docs/deployment.md`); nothing in the application encrypts
   individual fields.
7. Data-subject tooling (export/erase customer data) is not implemented; the admin API deliberately has no hard-delete of
   customers.
8. Penetration testing by a third party before handling real customer data.
