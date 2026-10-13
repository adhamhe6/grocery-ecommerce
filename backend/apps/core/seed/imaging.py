"""Attach the committed illustrations (backend/seed/images) through the real upload pipeline."""

from __future__ import annotations

import contextlib
import io
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage

from apps.catalog import images

IMAGE_ROOT = Path(settings.BASE_DIR) / "seed" / "images"


def image_path(kind: str, name: str) -> Path:
    return IMAGE_ROOT / kind / f"{name}.webp"


def delete_stored(name: str | None, widths) -> None:
    """Remove an uploaded file and its responsive variants from storage (best effort)."""
    if not name:
        return
    for stored in [name, *[images.variant_name(name, w) for w in (widths or [])]]:
        with contextlib.suppress(Exception):  # a missing/locked file must not abort a seed or reset
            default_storage.delete(stored)


def attach_product_image(product, alt_text: str, sku: str, refresh: bool = False) -> str:
    """Create the product's illustration unless it already has an image. Returns created|kept|missing."""
    from apps.catalog.models import ProductImage

    path = image_path("products", sku.lower())
    if not path.exists():
        return "missing"
    existing = list(product.images.all())
    if existing and not refresh:
        return "kept"
    for old in existing:
        delete_stored(old.image.name, old.image_widths)
        old.delete()
    img = ProductImage(product=product, alt_text=alt_text, sort_order=0)
    img.image_widths = images.save_processed(img.image, io.BytesIO(path.read_bytes()))
    img.save()
    return "created"


def attach_category_image(category, refresh: bool = False) -> str:
    path = image_path("categories", category.slug)
    if not path.exists():
        return "missing"
    if category.image and not refresh:
        return "kept"
    delete_stored(category.image.name if category.image else None, category.image_widths)
    category.image_widths = images.save_processed(category.image, io.BytesIO(path.read_bytes()))
    category.save()
    return "created"


def _attach_widths_image(obj, folder: str, key: str, refresh: bool) -> str:
    """Banners and articles keep `image_widths` next to the file, like products and categories."""
    path = image_path(folder, key)
    if not path.exists():
        return "missing"
    if obj.image and not refresh:
        return "kept"
    delete_stored(obj.image.name if obj.image else None, obj.image_widths)
    obj.image_widths = images.save_processed(obj.image, io.BytesIO(path.read_bytes()))
    obj.save()
    return "created"


def attach_banner_image(banner, key: str, refresh: bool = False) -> str:
    return _attach_widths_image(banner, "banners", key, refresh)


def attach_article_image(article, key: str, refresh: bool = False) -> str:
    return _attach_widths_image(article, "articles", key, refresh)
