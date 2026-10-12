# Demo seed data and illustrated imagery

Everything in this document is **demonstration content**. It exists so the storefront, the staff dashboard and the
test suites have a curated, realistic store to work with. None of it is real: the brands, suppliers, people, addresses,
prices, reviews and pictures are invented, and no trademark, domain or social-handle availability has been checked for
any of the names.

## Commands

```bash
cd backend
export DATABASE_URL=postgres://grocery:grocery@127.0.0.1:5432/grocery   # your dev database
export DJANGO_SETTINGS_MODULE=config.settings.dev

python manage.py migrate
python manage.py seed_demo                    # seed everything, including illustrations (about 40 s)
python manage.py seed_demo --skip-images      # same, without image processing (about 10 s)
python manage.py seed_demo --reset-demo       # delete ONLY demo rows, then seed again
python manage.py seed_demo --reset-demo --no-seed   # delete ONLY demo rows and stop
python manage.py seed_demo --refresh-images   # replace the illustrations of demo objects
python manage.py seed_demo --password 'Something-Else-1'   # shared password for the demo accounts
```

| Option | Meaning |
|---|---|
| `--reset-demo` | Remove demo rows (see "What counts as demo") and re-seed. PROTECTed rows that real data still references (for example a demo product on a genuine order) are **kept** and reported. |
| `--no-seed` | With `--reset-demo`: stop after deleting. |
| `--skip-images` | Do not attach illustrations. Products then have no image, so only use it for tests and quick checks. |
| `--refresh-images` | Replace existing demo illustrations (by default an object that already has an image is left alone). |
| `--password PASS` | Shared password for every demo account. Otherwise `$DEMO_PASSWORD`, otherwise the documented dev default below. |
| `--force` | Required when `settings.DEBUG` is false. Without it the command refuses to run. |

**Safety.** The command creates accounts with a shared, documented password. It refuses to run with `DEBUG` off unless
`--force` is given (CI and throwaway demo hosts), and then prints a warning. These accounts and this data must never
exist in a production database.

### Properties

* **Deterministic.** No randomness anywhere; pseudo-variation (stock quantities, supplier cost ratios, product ages)
  comes from a CRC of the SKU, so the same code always produces the same data.
* **Idempotent.** Rows are matched on natural keys: `sku`/`slug` (products), `slug` (categories, collections, articles,
  pages), `name`/`slug` (brands), `code` (branches, suppliers, coupons, zones by branch and name), `lot_code` per
  product and branch (batches), `number` (purchase orders), `email` (accounts), `question` (FAQs), `title` (banners).
  A second run creates nothing; the test-suite asserts identical row counts and zero "created".
* **Relative dates.** Expiry windows, promotion and coupon windows, closure dates, purchase-order dates, review and
  article dates, product "new arrival" ages and the 10-day slot horizon are all computed from *today*, and a re-run
  re-bases them so dashboards stay meaningful. Quantities of existing stock rows are never changed by a re-run, so stock
  that real operations have consumed is not reset.
* **Never touches real data.** A row is demo when it is created through the seed lists: `is_demo=True` where the model
  has the flag (products, brands, suppliers, purchase orders, batches, branches, promotions, coupons, reviews,
  nutrition facts); otherwise a natural key from the seed lists (categories, collections, pages, FAQs, articles, banners,
  `@demo.orchardrow.test` accounts, movements with `ref_type="DEMO_SEED"`). If a real (non-demo) row already owns a
  seed natural key, the seed leaves it untouched and prints a warning (the product, brand, coupon, ... is simply not
  seeded). Pages are only refreshed while `is_template` is still on. Operational flags (`status`, `is_available`,
  `is_featured`, `popularity`, `is_active`, claim verification) are set when a row is first created and not flipped back.
* **Transactional.** The whole run is one database transaction; an error leaves nothing half-seeded.

### What counts as "demo" for `--reset-demo`

Reviews, promotions, coupons, purchase orders, products (with their lots, ledger rows, stock levels, images and links),
suppliers, brands, branches (with hours, closures, zones, slot templates and slots), the seeded categories (only when
empty), collections, pages (only while still template text), FAQs, articles, banners and every account at
`@demo.orchardrow.test`. The singleton `StoreSettings` row is not deleted.

## What is seeded

| Area | Seeded |
|---|---|
| Store settings | `Orchard Row`, "Fresh, honestly labelled.", `demo_mode` on, contact details on reserved domains (`hello@orchardrow.example`, `+1 555 01xx`), placeholder social URLs with `socials_are_placeholders` on, USD, `en-US`, `America/New_York`, 24 h complaint window. Only filled in when the row is new, already in demo mode, or still carries the default placeholder email. |
| Branches | **Orchard Row Central** (`central`, default) and **Orchard Row Northside** (`north`), in the fictional town of Riverton, with Mon-Sun hours (Northside shorter, closed Sundays) and one future closure (Northside staff training day). |
| Delivery | Four zones with different fees, free-delivery thresholds and minimum orders: `RW1` (+ areas) and `RW2` for Central, `RW3` and `RW4` for Northside. Delivery windows 09-12, 12-15, 15-18, 18-21 (only where they fit the opening hours; capacities 6-12) and hourly pickup slots; `generate_slots(days_ahead=10)` runs for both branches. |
| Catalogue | 7 departments and 42 categories, 16 invented brands (including an own-label), **139 products** (136 visible; one inactive, one archived, one switched off to demonstrate admin states). Fresh Produce is the largest department (31 visible products); every category holds at least 3 visible products. |
| Product data | Unique names and SKUs (`OR-VEG-0001`), plain factual 2-4 sentence descriptions, correct sale units and quantity rules (kg: step 0.25; each / pack / bundle / dozen / 100 g deli), net content for unit prices (per kg / per L), storage, packaging, manufacturer, 96 EAN-13 style barcodes (GS1 "in-store" prefix 20, valid check digits), a clear bestseller ordering, featured flags, product ages (14 products are "new", created within the last 15 days). Three bakery items are made to order. |
| Trust data | See the next section. |
| Suppliers | 6 invented suppliers with lead times and `.example` contacts, a supplier link and unit cost (55-70 % of price) for every product, and 3 purchase orders (`PO-DEMO-0001` DRAFT, `-0002` SUBMITTED, `-0003` CONFIRMED). Nothing is received: received POs are left to the services. |
| Inventory | 265 stock rows, 243 lots, 376 ledger movements. Mostly healthy two-lot stock; 11 low-stock products, 8 deliberately near-expiry lots (27 lots in all have 1-3 days left, because the short-life bakery lots are always close to their date), 6 expired lots (3 awaiting write-off, 3 fully written off with `WASTE` movements), 1 quarantined lot, 1 lot that failed inspection, 6 products out of stock at Central, 5 products stocked at Central only. Lot codes such as `LOT-CEN-0042-A`. |
| Promotions | 15 % off berries, two price drops, "3 for $5" pasta (a genuine saving, so the engine applies it), citrus 10 % ending in two days, one expired and one inactive offer. |
| Coupons | `WELCOME10` (10 % first order, min $25), `FRESH5` ($5 off $40), `FREESHIP`, `BAKERY15` (category-scoped), `SPRING20` (expired), `LASTONE` (usage limit reached). |
| Collections | Seasonal produce, Pantry staples, Weeknight dinners, Plant-based kitchen, Breakfast table (four on the home page). |
| Content | 7 policy pages (**template text**), 18 FAQs, 6 recipes and 4 grocery guides (with linked products), 3 hero banners, 1 announcement strip and 2 promo tiles. Banner links only use existing frontend routes. |
| Accounts | 9 staff accounts and 8 customers with 12 addresses; see below. |
| Reviews | 50 sample reviews (`is_demo`, `verified_purchase=False`, approved) over 21 popular products, by the demo customers; rating averages are recomputed by the review signal. The product API flags them as demo. |

## Trust data: deliberately honest

The seed never invents provenance, certification or health claims.

* **Origin** is recorded on only 7 products and always reads "Demo data: example origin shown to demonstrate this field.
  Confirm with the supplier before relying on it."
* **Claims.** `VEGAN` / `VEGETARIAN` are `verified=True` only on plain single-ingredient products (fruit, vegetables, rice,
  plain flour, eggs, milk, ...) with the evidence "Plain single-ingredient product (demo record)". Certificate-type claims
  (`ORGANIC`, `FAIRTRADE`, `GLUTEN_FREE`) are seeded **unverified** with "Awaiting supplier certificate (demo)", so the
  admin has something to verify; three plant-based lines carry an unverified `VEGAN` claim. Unverified claims are not
  shown to shoppers and cannot be filtered on.
* **Allergens.** `allergen_info_complete=True` (and `ProductAllergen` rows, including some `MAY_CONTAIN`) only where an
  authored ingredient list lets the allergens be derived; a test re-derives them from the ingredient text. Loose produce
  and the remaining lines stay "not confirmed".
* **Nutrition** exists for 12 plain whole foods only (per 100 g, generic reference values), `is_demo=True`, source
  "Generic reference values (demo) - replace with supplier label data".
* **No marketing language.** Descriptions avoid superlatives, health claims and the words "organic", "farm fresh",
  "locally sourced", "healthy", "natural" and "chemical-free"; a test scans every seeded text.

## Demonstration-only: what a real business must replace

| Seeded item | What to do for a real launch |
|---|---|
| Brand and supplier names, contacts, addresses | Replace with real companies (and check trademarks). |
| Catalogue, prices, descriptions, ingredients, allergens, storage, origin | Load your own range with data from supplier labels. Do not reuse the demo text as label data. |
| Nutrition records, claims and "verified" flags | Replace with supplier label data and real certificates; verify claims only against evidence. |
| Product illustrations | Replace with real photography (upload through the dashboard; the pipeline produces responsive WebP). |
| Branches, hours, zones, fees, capacities | Replace with your own; the postcodes (`RW1` ...) and the town are fictional. |
| Policy pages | Template wording only: have the business and its legal adviser rewrite and review them; then clear `is_template`. |
| Reviews | Sample text by invented people. Real reviews come from completed orders. |
| Social URLs and contact details | Placeholders; set real ones and clear `socials_are_placeholders`. |
| Accounts | Dev-only. Delete them (`--reset-demo --no-seed`) and create real staff accounts. |
| Stock, lots, purchase orders, promotions, coupons | Operational data to be replaced by real receiving and merchandising. |
| `popularity` | Seeded once to give a bestseller ordering; the scheduled popularity task replaces it with measured sales. |

## Demo accounts (dev only)

Shared password: `OrchardDemo-2024!` unless overridden with `--password` / `DEMO_PASSWORD`. All addresses use the reserved
`.test` domain; **never create these accounts in production**.

| Email | Role | Branches | Notes |
|---|---|---|---|
| `superadmin@demo.orchardrow.test` | Super admin | all | Django superuser |
| `admin@demo.orchardrow.test` | Admin | all | |
| `manager.central@demo.orchardrow.test` | Store manager | central | |
| `manager.north@demo.orchardrow.test` | Store manager | north | |
| `inventory@demo.orchardrow.test` | Inventory manager | central | |
| `purchasing@demo.orchardrow.test` | Purchasing manager | central, north | creator of the demo POs |
| `picker@demo.orchardrow.test` | Fulfilment staff | central | |
| `support@demo.orchardrow.test` | Customer support | all (`all_branches`) | |
| `marketing@demo.orchardrow.test` | Marketing manager | all (`all_branches`) | |
| `alex@`, `sam@`, `priya@`, `jordan@`, `mei@`, `tomas@`, `amara@`, `lucas@demo.orchardrow.test` | Customer | - | 1-2 addresses each, all inside a delivery zone |

## Illustrated imagery

The pictures are **original illustrations**, not photographs: warm paper background, flat two-tone objects with a small
highlight, one light direction (upper left), a soft ground shadow, no text on produce, and a tiny invented wordmark plus
pack name on packaged goods. No stock photos are used (their licences and permanence could not be verified).

Committed output (about 3 MB in total):

| Path | Content |
|---|---|
| `backend/seed/images/products/<sku>.webp` | 139 distinct 900x900 illustrations, one per product (all under 45 KB) |
| `backend/seed/images/categories/<slug>.webp` | 49 tiles: every department and category |
| `backend/seed/images/banners/<name>.webp` | 5 banner images, 1600x900 (no baked-in text; the page overlays copy) |
| `backend/seed/images/articles/<slug>.webp` | 10 recipe/guide cards, 1200x800 |

`seed_demo` attaches them through `apps.catalog.images.save_processed` (validation, WebP normalisation, 320/640/1024
variants, `image_widths`), with alt text from the product data (for example "Illustration of three red apples with green
leaves"). An object that already has an image is left alone unless `--refresh-images` is given.

### Regenerating

The generator (`scripts/generate_demo_images.py`) draws SVG from reusable archetypes in `backend/seed/art/` (about 40
parameterised templates: round fruit, bananas, citrus with a cut half, berries in a punnet, leafy bunches, herb bunches,
root vegetables, onions and garlic, potatoes, peppers, gourds, mushrooms, brassicas, avocado, tomatoes on the vine,
loaves, rolls, pastries, cakes, egg cartons, cartons and jugs, yogurt pots, butter, cheese, jars, tins, bags, boxes,
bottles, meat on trays, whole chicken, fish and shrimp, nut piles, frozen packs, pump bottles, tubes, pouches, wipes ...).
Colours, counts, shapes and label text come from the product records in `backend/apps/core/seed/`, so a product's
picture always matches its name, brand and pack. Chromium frames each drawing automatically (alpha bounding box,
ground line, shadow); tiles, banners and cards are composed from the same cut-outs with Pillow.

```bash
# dev-only dependency: it is deliberately NOT in requirements/*.txt
backend/.venv/bin/pip install playwright
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers        # an already-installed Chromium bundle; or set CHROMIUM_PATH=/path/to/chrome
# do not run `playwright install` in a restricted environment: the script uses the existing browser

backend/.venv/bin/python scripts/generate_demo_images.py                       # everything (about 4 minutes)
backend/.venv/bin/python scripts/generate_demo_images.py --only products --sku OR-VEG,OR-FRU-0003
backend/.venv/bin/python scripts/generate_demo_images.py --only categories --cache   # reuse cut-outs
```

It also writes labelled review sheets (`backend/seed/images/_contact_sheet_*.png`, git-ignored). Text on packs uses the
Inter and Liberation fonts when installed; another machine may substitute fonts, so regenerated images can differ
slightly from the committed ones. Add a product by adding a record (with an `art` tuple and `alt` text) to the product
lists, then regenerate its image; a test fails if an illustration is missing, oversized or has a duplicate alt text.

## Where things live

| Path | Purpose |
|---|---|
| `backend/apps/core/management/commands/seed_demo.py` | the command |
| `backend/apps/core/seed/catalog_base.py` | departments, categories, brands, category defaults, the `P()` product helper |
| `backend/apps/core/seed/products_*.py`, `catalog_data.py` | the product records and their assembly (SKUs, slugs, barcodes, popularity) |
| `backend/apps/core/seed/ops_data.py` | store, branches, zones, suppliers, purchase orders, stock scenarios, promotions, coupons, collections |
| `backend/apps/core/seed/content_data.py`, `accounts_data.py`, `art_data.py` | pages, FAQs, articles, banners; accounts, addresses, reviews; banner and card compositions |
| `backend/apps/core/seed/load_*.py`, `runner.py`, `reset.py`, `imaging.py` | the loaders, the orchestration with the summary table, the reset and the image attachment |
| `backend/seed/art/`, `backend/seed/images/` | illustration library and committed output |
| `scripts/generate_demo_images.py` | the generator |
| `backend/tests/seed/test_seed_demo.py` | tests (counts, idempotence, ledger invariants, honesty rules, API visibility, reset, images) |

SKUs are numbered per category in definition order, so **append** new products to the end of a category list rather than
inserting in the middle (inserting shifts later SKUs and would create duplicates on the next run).
