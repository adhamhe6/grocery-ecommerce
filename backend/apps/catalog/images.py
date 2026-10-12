"""Safe image pipeline: validate → strip metadata → normalise to WebP → generate responsive variants."""

from __future__ import annotations

import io
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image, ImageOps, UnidentifiedImageError

VARIANT_WIDTHS = (320, 640, 1024)
MAX_ORIGINAL_EDGE = 1600
MAX_PIXELS = 40_000_000
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def product_upload_path(instance, filename: str) -> str:
    return f"products/{instance.product_id}/{uuid.uuid4().hex}.webp"


def validate_and_open(fileobj) -> Image.Image:
    """Raise ValidationError unless `fileobj` is a genuine, reasonably sized JPEG/PNG/WebP image."""
    size = getattr(fileobj, "size", None)
    if size is not None and size > settings.IMAGE_UPLOAD_MAX_BYTES:
        raise ValidationError(f"Image is too large (max {settings.IMAGE_UPLOAD_MAX_BYTES // (1024 * 1024)} MB).")
    try:
        fileobj.seek(0)
        probe = Image.open(fileobj)
        fmt = probe.format
        probe.verify()
        fileobj.seek(0)
        img = Image.open(fileobj)
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        raise ValidationError("Unsupported or corrupt image file.") from None
    if fmt not in ALLOWED_FORMATS:
        raise ValidationError("Only JPEG, PNG or WebP images are accepted.")
    return img


def _webp_bytes(img: Image.Image, quality: int = 82) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=4)
    return buf.getvalue()


def _fit(img: Image.Image, max_edge: int) -> Image.Image:
    out = img.copy()
    out.thumbnail((max_edge, max_edge), Image.LANCZOS)
    return out


def process(fileobj) -> tuple[bytes, dict[int, bytes]]:
    """Return (normalised original WebP bytes, {width: variant bytes}). EXIF/metadata is dropped."""
    img = ImageOps.exif_transpose(validate_and_open(fileobj))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    original = _fit(img, MAX_ORIGINAL_EDGE)
    variants = {}
    for width in VARIANT_WIDTHS:
        if original.width >= width or width == VARIANT_WIDTHS[0]:
            scaled = _fit(original, width)
            variants[width] = _webp_bytes(scaled)
    return _webp_bytes(original), variants


def variant_name(name: str, width: int) -> str:
    stem = name.rsplit(".", 1)[0]
    return f"{stem}-w{width}.webp"


def save_processed(fieldfile, fileobj) -> list[int]:
    """Persist a processed upload onto an ImageField file and write its variants next to it.

    Returns the list of generated variant widths; callers store it next to the file so that rendering
    never has to hit the filesystem to discover variants.
    """
    original, variants = process(fileobj)
    name = default_storage.get_available_name(fieldfile.field.generate_filename(fieldfile.instance, "upload.webp"))
    saved = default_storage.save(name, ContentFile(original))
    for width, data in variants.items():
        default_storage.save(variant_name(saved, width), ContentFile(data))
    fieldfile.name = saved
    return sorted(variants)


def variant_urls(fieldfile, widths) -> dict:
    """{"original": url, "320": url, ...} — widths come from the database, so no filesystem lookups."""
    if not fieldfile:
        return {}
    out = {"original": default_storage.url(fieldfile.name)}
    for width in widths or []:
        out[str(width)] = default_storage.url(variant_name(fieldfile.name, width))
    return out
