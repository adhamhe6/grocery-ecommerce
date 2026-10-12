#!/usr/bin/env python
"""Generate the original illustrated demo imagery for Orchard Row.

Outputs (committed, so the seed command needs no network and no browser):

    backend/seed/images/products/<sku>.webp      900x900, one distinct illustration per product
    backend/seed/images/categories/<slug>.webp   900x900 tiles for every department and category
    backend/seed/images/banners/<name>.webp      1600x900 banner artwork
    backend/seed/images/_contact_sheet_*.png     labelled review sheets (git-ignored)

The artwork is drawn from data-driven SVG archetypes (backend/seed/art/) using the product records in
backend/apps/core/seed/ (archetype, colours, label text, alt text), rendered through headless Chromium and
re-encoded to WebP. No stock photos are used.

Requirements (dev-only; deliberately NOT added to requirements files):

    backend/.venv/bin/pip install playwright       # Python bindings only; browsers are NOT downloaded here
    export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers   # a Chromium bundle that is already installed
    # or: export CHROMIUM_PATH=/path/to/chrome

Usage:

    backend/.venv/bin/python scripts/generate_demo_images.py                 # everything
    backend/.venv/bin/python scripts/generate_demo_images.py --only products --sku OR-VEG
    backend/.venv/bin/python scripts/generate_demo_images.py --only banners

Text on packs uses the Inter and Liberation fonts when installed; on a machine without them Chromium falls back to
another sans/serif, so regenerated images can differ slightly from the committed ones.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND / "seed"))
sys.path.insert(0, str(BACKEND))

import art  # noqa: E402
from art import compose, core  # noqa: E402
from art.render import Renderer, to_webp  # noqa: E402

from apps.core.seed import art_data, catalog_data  # noqa: E402

OUT = BACKEND / "seed" / "images"
FIT = (640, 520, 450, 700, 1.0, 3.0)  # target w, target h, ground x, ground y, size, max scale
ARCHETYPES = art.ARCHETYPES


def product_svg(rec: dict) -> str:
    archetype, params = catalog_data.art_params(rec)
    core.reset_ids()
    return core.scene(ARCHETYPES[archetype](**params))


def render_products(r: Renderer, args, cutouts: dict) -> list[tuple[str, object]]:
    (OUT / "products").mkdir(parents=True, exist_ok=True)
    sheet, total = [], 0
    for rec in catalog_data.PRODUCTS:
        want = not args.sku or args.sku.lower() in rec["sku"].lower() or args.sku.lower() in rec["slug"]
        needs_cutout = args.only in ("all", "categories", "banners")
        if not want and not needs_cutout:
            continue
        img, cut = r.render(product_svg(rec), FIT, cutout=True)
        cutouts[rec["name"]] = cut
        if not want:
            continue
        img = img.resize((900, 900), compose.Image.LANCZOS)
        path = OUT / "products" / f"{rec['sku'].lower()}.webp"
        size = to_webp(img, str(path), args.quality)
        total += size
        sheet.append((f"{rec['sku']} {rec['name']}", img))
        flag = "  <-- over 45 KB" if size > 45 * 1024 else ""
        print(f"product  {path.name:<22} {size / 1024:5.1f} KB{flag}")
    print(f"products: {len(sheet)} files, {total / 1024 / 1024:.2f} MB")
    return sheet


def render_categories(cutouts: dict, args) -> list[tuple[str, object]]:
    (OUT / "categories").mkdir(parents=True, exist_ok=True)
    visible = [p for p in catalog_data.PRODUCTS if not p["state"]]
    sheet, total = [], 0
    for dept_slug, _dname, _desc, _sort, _home in catalog_data.DEPARTMENTS:
        cats = catalog_data.CATEGORIES[dept_slug]
        # department tile: the most popular product from four different categories
        tops = []
        for slug, *_ in cats:
            in_cat = sorted((p for p in visible if p["cat"] == slug), key=lambda p: -p["popularity"])
            if in_cat:
                tops.append(in_cat[0])
        tops = sorted(tops, key=lambda p: -p["popularity"])[:4]
        jobs = [(dept_slug, tops)]
        for slug, *_ in cats:
            in_cat = sorted((p for p in visible if p["cat"] == slug), key=lambda p: -p["popularity"])
            jobs.append((slug, in_cat[:3]))
        for slug, prods in jobs:
            if not prods:
                continue
            img = compose.tile([cutouts[p["name"]] for p in prods], dept_slug)
            path = OUT / "categories" / f"{slug}.webp"
            size = to_webp(img, str(path), args.quality)
            total += size
            sheet.append((slug, img))
            print(f"category {path.name:<30} {size / 1024:5.1f} KB")
    print(f"categories: {len(sheet)} files, {total / 1024 / 1024:.2f} MB")
    return sheet


def render_banners(cutouts: dict, args) -> list[tuple[str, object]]:
    (OUT / "banners").mkdir(parents=True, exist_ok=True)
    sheet, total = [], 0
    for key, (names, top, bottom, mirror) in art_data.BANNER_ART.items():
        img = compose.banner([cutouts[n] for n in names], top, bottom, mirror=mirror)
        path = OUT / "banners" / f"{key}.webp"
        size = to_webp(img, str(path), args.quality)
        total += size
        sheet.append((key, img))
        print(f"banner   {path.name:<30} {size / 1024:5.1f} KB")
    print(f"banners: {len(sheet)} files, {total / 1024 / 1024:.2f} MB")
    return sheet


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["all", "products", "categories", "banners"], default="all")
    ap.add_argument("--sku", help="only (re)write products whose SKU or slug contains this text")
    ap.add_argument("--quality", type=int, default=80, help="WebP quality (default 80)")
    ap.add_argument("--no-sheets", action="store_true", help="skip the contact sheets")
    args = ap.parse_args()
    catalog_data.check()

    cutouts: dict = {}
    with Renderer(scale=2) as r:
        psheet = render_products(r, args, cutouts)
    csheet = bsheet = []
    if args.only in ("all", "categories"):
        csheet = render_categories(cutouts, args)
    if args.only in ("all", "banners"):
        bsheet = render_banners(cutouts, args)

    if not args.no_sheets:
        for title, items, cols, tile_px, per in (
            ("products", psheet, 6, 300, 36),
            ("categories", csheet, 7, 250, 49),
            ("banners", bsheet, 2, 640, 6),
        ):
            for part, start in enumerate(range(0, len(items), per), start=1):
                path = OUT / f"_contact_sheet_{title}_{part:02d}.png"
                compose.contact_sheet(items[start : start + per], str(path), cols, tile_px)
                print(f"sheet    {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
