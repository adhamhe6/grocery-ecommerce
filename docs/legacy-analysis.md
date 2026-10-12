# Legacy Analysis — `grocery-ecommerce-app`

> Scope: read-only audit of `https://github.com/adhamhe6/grocery-ecommerce-app` (branch `main`,
> head `24b3bbe "added README file"`). The legacy repository was **not modified**. To run it, a copy
> (without `venv/` and `.git/`) was placed in a scratch directory and executed with
> Django 4.2, django-taggit 6.1, Pillow and Faker on Python 3.13 / SQLite.
>
> Every statement below is tagged **[RAN]** (observed by executing the app), **[CODE]** (read in source only)
> or **[DOC]** (claimed in the README only).

## 1. What the legacy project is

A Django 4.2 + SQLite project (`core`, `accounts`, `products`, `companyinfo`, `pages`) whose entire frontend
is the commercially licensed **"Greeny – eCommerce HTML Template" by mironcoder (ThemeForest)**. About 948 lines of
hand-written Python wrap ~15,000 lines of static theme HTML, 65 CSS files, 90 SCSS partials and ~350 theme images.

Repository hygiene: a **Windows `venv/` (73 MB, 6,709 files) is committed**, there is **no `.gitignore`** and
**no `requirements.txt`** even though the README says `pip install -r requirements.txt`.

## 2. Features claimed vs. features that exist

| README claim | Evidence | Status |
|---|---|---|
| User registration | `accounts.register`; **[RAN]** POST creates user + profile, redirects to login | Works for the first user of a given first name; **500 on collision** (§7) |
| Login / logout | `accounts.sign_in` | **Broken [RAN]**: HTTP 500 for every login attempt |
| Password change | `password_change_view` | **[CODE]** reachable only after login, which is broken |
| Password reset | `password_reset_view` sends mail via Django form | **[RAN]** request page renders; confirm step is insecure/broken (§7) |
| User profile | `profile.html` is 8 lines; the view is commented out | **Absent** |
| Product catalog | `Product/Brand/Category` models exist; **list/detail views are never routed** | **Models only** |
| Cart | `pages/templates/pages/cart.html` — static HTML, 0 template variables, links to a non-existent `checkout.html` | **Absent** (mock-up) |
| Order tracking | CSS (`orderlist.css`, `_order-track.scss`) only | **Absent** |
| Secure payment integration | No payment code. Only card-logo images in `static/images/payment` | **Absent** |
| Compare list | `compare.css` and 175 `href="compare.html"` dead links | **Absent** |
| Wishlist | `wishlist.css`, 6 dead links | **Absent** |
| Blog | `blog-*.css`; 8 dead `blog-details.html` links | **Absent** |
| Admin | Django admin registrations for products/brands/categories/reviews/profiles (`CompanyInfo` is **not** registered) | Code present; **admin login is broken [RAN]** |
| Arabic localisation | `locale/ar/.../django.po` translates model labels only; **0** `{% trans %}` tags in the base template | Partial/ineffective |

## 3. Features verified through actual execution **[RAN]**

Clean database, `manage.py migrate`, `runserver`:

1. **Every HTML page returns HTTP 500**, including `/admin/login/`, because the `companyinfo` app has a
   `migrations/__init__.py` but **no migration** and its context processor queries `companyinfo_company`
   on every render (`OperationalError: no such table`). `/static/...` returns 200.
2. After generating the missing migration *in the scratch copy only*: home, shop, category, brand, product,
   login, register and password-reset pages return 200 — all static theme content.
3. **Registration** (`POST /accounts/register/`) → 302 to login.
4. **Login** → **500** `ModuleNotFoundError: No module named 'core.custom_auth_backend'`.
   `settings.AUTHENTICATION_BACKENDS` lists that module, but the file does not exist. Django loads *all* configured
   backends on every `authenticate()`, so **no user, including a superuser, can ever sign in**, and `/admin/login/` also 500s.
5. **Second registration with the same first name** → **500** `IntegrityError: UNIQUE constraint failed: auth_user.username`
   (`user.username = user.first_name`).
6. **Password-reset confirm** with an invalid uid/token → GET 200 (renders a form for a bogus token) and POST **500**
   (`NotImplementedError: Django doesn't provide a DB representation for AnonymousUser`).
7. **Seed script** `dummy_data.py`: all `seed_*()` invocations are commented out; invoking `seed_category()`
   → `TypeError` because `settings.STATIC_ROOT` is commented out (`None`).
8. Probed `/products/`, `/products/1/`, `/cart/`, `/checkout/`, `/compare/`, `/wishlist/`, `/orders/` → **404**: these routes do not exist.

## 4. Features found only in code or documentation

- `ProductListView`, `ProductDetailView`, `BrandListView`, `BrandDetailView`, `CategoryListView` exist but **no URL points at them**.
  `ProductDetailView.template_name = 'products/product_detail.html'` — **that template does not exist**.
- `ProductReview` model (rate 0–5, text) and `Product.avg_review`; nothing creates or displays reviews.
- `Company` (store identity: name, logo, subtitle, phones, emails, social links, address) injected via context processor.
- Django-admin tweaks (image previews, inline gallery) for catalog models.
- README: cart, order tracking, secure payment, compare, blog (none implemented, see §2).

## 5. Existing architecture and technology choices

- Django 4.2 monolith with server-rendered templates; jQuery, Slick, Isotope, Venobox, Nice-select, Bootstrap (via theme).
- SQLite (`db.sqlite3`), media on local disk, no cache, no background jobs, no API, no tests.
- Apps: `products`, `accounts`, `companyinfo`, `pages`; `'locale'` is wrongly listed in `INSTALLED_APPS`.
- Models use `gettext` (not `gettext_lazy`) for `verbose_name`, so labels are frozen at import time.
- `taggit` is used for product tags.

## 6. Business logic worth preserving (as concepts, not code)

| Legacy concept | Why it is useful | New home |
|---|---|---|
| `Category` ↔ `Brand` many-to-many (`BrandCategory`) | Brand pages scoped to departments | `Brand` + product-derived brand/department browsing |
| `Product.flag` (New / Feature / Sale) | Merchandising badges | Computed badges (new arrival from `created_at`, sale from live promotion price) + `is_featured` |
| Multiple images per product | Gallery on product page | `ProductImage` with alt text and ordering |
| `CategorySuggest` (home department tiles) | Visual shopping by department | Category image + `show_on_home` / `sort_order` |
| `Company` singleton | Editable store identity without code changes | `StoreSettings` (brand, contacts, socials, policy copy) |
| Email as login identifier | Familiar to shoppers | Email-based custom `User` (`USERNAME_FIELD = "email"`) |
| Reviews (rate + text, average) | Social proof | `Review` (1–5, unique per customer/product, verified-purchase flag) |
| Tags | Dietary/lifestyle filtering | Structured `DietaryTag` M2M (vegan, gluten-free, ...) — only where data is supplied |
| Arabic locale intent | Regional market | Locale-ready copy and RTL-capable layout; not claimed as shipped translation |

## 7. Authentication and authorization weaknesses

1. Broken `EmailBackend` import ⇒ nobody can log in or administer (§3.4).
2. `password_reset_confirm_view` **ignores `uidb64` and `token`** and builds `SetPasswordForm(request.user, ...)`: a
   logged-in user can change their password with no valid token; anonymous users get a 500. Reset tokens are never validated.
3. `username = first_name` ⇒ non-unique usernames ⇒ 500 and denial of registration; also leaks which first names are taken.
4. Email uniqueness is checked case-sensitively and duplicated across `auth_user.email` and `UserProfile.email`
   (two sources of truth that can drift).
5. Login failure path silently `pass`es (messages commented out); no throttling or lockout.
6. No roles/permissions beyond `is_staff`; no branch scoping; no audit log.
7. `SECRET_KEY` committed, `DEBUG = True`, `ALLOWED_HOSTS = []`; no secure-cookie/HSTS settings.
8. `@csrf_protect` is applied but redundant with middleware; `login_required` has no `LOGIN_URL` configured (defaults to `/accounts/login/`, which coincidentally matches).

## 8. Database and data-integrity issues

- `Product.sku` is an `IntegerField` — **not unique**; `slug` is `null=True` and **not unique** (`#slug = ... unique=True` is commented out), so two products named alike share a slug.
- `quantity` is a free integer with no `>= 0` constraint, no reservation concept, no stock movements, no branches/batches/expiry.
- `price` has no `>= 0` constraint; there is no currency, no tax, no promotion/price history.
- `Product.category` and `Product.brand` are `SET_NULL`, producing orphaned, uncategorised products.
- Seed data picks **random** category/brand/price per product, repeats one name ("Fresh Green Chilis" ×19) and attaches fabricated claims
  ("Sourced from local farms, grown with care...") — i.e. not realistic and contains unsupported marketing assertions.
- Review `rate` allows 0; no uniqueness per user/product; no verified-purchase link (there are no orders).
- `Company.objects.last()` runs on **every request** (no cache) and crashes pages when the table is missing.
- Migration gap: `companyinfo` has no migration; `pages` has no models.
- SQLite only; no PostgreSQL features (full-text, constraints, partial indexes, row locks).

## 9. Performance problems

- No pagination on `BrandListView` queryset aside from `paginate_by`; `get_context_data` **overrides** `brands` with an unpaginated annotated queryset.
- `BrandDetailView.get_context_data` calls `self.get_object()` again (duplicate query).
- Context processor query on every request; no caching layer.
- No `select_related`/`prefetch_related`; N+1 on any real listing (category/brand per product).
- ~350 unoptimised theme JPEG/PNG assets (largest ≈ 350 KB; 8.4 MB total), no responsive sizes, no WebP/AVIF, no lazy-loading discipline.
- 4,008-line `base1.html` and 999-line `base2.html` with duplicated markup; heavy jQuery plugin stack.
- Search/filter: **none**.

## 10. UI/UX problems

- All catalogue pages are static template markup with hard-coded sample content (**0** `{% for %}` loops and **0** product variables in `shop_4_col.html`, `home_index.html`, `cart.html`, `product_simple.html`).
- **931** `href="*.html"` links to files that do not exist (498× `product-video.html`, 175× `compare.html`, ...), **708** `href="#"` placeholders — a large share of primary actions are inert.
- Five interchangeable "shop N-column" pages and five home-page variants instead of one considered design; every product links to a "video" product page.
- Generic purchased-template look; third-party branding ("Greeny", mironcoder meta tags) remains in markup.
- Template licensing: the theme and its imagery cannot be redistributed in a new commercial product without a license — **not reused**.
- No loading, empty or error states; no search; no mobile checkout (checkout does not exist); accessibility not addressed (no labels audit, focus styles, alt-text discipline).

## 11. Missing grocery-specific functionality

Units/sale units, variable-weight items, quantity increments, pack sizes, unit price comparison, perishable flags,
expiry/batch/lot tracking, FEFO, storage/origin/allergen/nutrition data, substitutions, delivery slots and zones,
pickup/click-and-collect, branches, picking/packing workflow, purchasing/suppliers, waste, promotions/coupons,
loyalty, returns/refunds/complaints, notifications, reporting.

## 12. Preserve / redesign / replace / discard

| Area | Decision | Notes |
|---|---|---|
| Django as backend | **Preserve** (upgrade to current Django 5.x + DRF) | Team familiarity, mature ORM/migrations, admin for technical maintenance |
| Category/Brand/Product concepts, product gallery, flags, reviews | **Redesign** | Unit-aware, constrained, richer data model |
| Company info | **Redesign** | `StoreSettings` + branches + opening hours |
| Auth (email login, reset flow) | **Redesign** | Custom user, token/session auth, correct reset |
| Seed data | **Replace** | Curated, deterministic, honest catalog (100+ products, demo-labelled) |
| SQLite | **Replace** | PostgreSQL |
| Greeny template HTML/CSS/JS/images | **Discard** | Licence + quality; new design system, new original imagery |
| `venv/` in Git, missing `requirements.txt` | **Discard** | Pinned dependencies, `.gitignore`, Docker |
| Cart / orders / payments / compare / wishlist | **Build new** | They never existed |
| `locale/ar` | **Defer** | Labels only; revisit once copy is stable |

## 13. Lessons for the new implementation

1. **Never trust that a documented feature exists** — five of eight headline README features were absent and the rest crashed. The new README documents only what is tested.
2. **A one-line missing migration or import took the whole site down.** The new project must boot from a clean database in CI (migrations + `check --deploy` + smoke tests) on every push.
3. **Authentication must be the first thing tested end to end** (register → login → authenticated request → logout).
4. Business rules belong in services and database constraints (unique SKU/slug, `CHECK (qty >= 0)`), not in templates.
5. Don't ship third-party theme code; build a small, owned design system so storefront and admin share one visual language.
6. Seed data must be deterministic, rerunnable, and clearly labelled demo — never fabricated sourcing claims.
7. Keep generated artefacts (venvs, media, caches) out of Git from commit one.
8. Pin dependencies and provide one-command local setup (`docker compose up`).
