"""Small utilities shared by the staff-CRUD tests (kept out of conftest.py so other workstreams' fixtures stay untouched)."""

from __future__ import annotations

import io
import os

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.core import rbac

STAFF_ROLES = sorted(rbac.STAFF_ROLES)
ALL_ROLES = STAFF_ROLES  # customers are covered separately: they are always refused


def image_bytes(fmt: str = "JPEG", size: tuple[int, int] = (1200, 900), color=(180, 60, 40)) -> bytes:
    """A real, decodable image generated in memory."""
    img = Image.new("RGB", size, color)
    for x in range(0, size[0], 40):  # some structure so WebP/JPEG don't collapse to a few bytes
        for y in range(0, size[1], 40):
            img.putpixel((x, y), (x % 255, y % 255, 90))
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


MIME = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
EXT = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


def upload(fmt: str = "JPEG", *, name: str | None = None, size: tuple[int, int] = (1200, 900)) -> SimpleUploadedFile:
    return SimpleUploadedFile(name or f"photo.{EXT[fmt]}", image_bytes(fmt, size), content_type=MIME[fmt])


def fake_upload(name: str, content: bytes, content_type: str = "image/jpeg") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, content, content_type=content_type)


BAD_UPLOADS = {
    "svg": lambda: fake_upload(
        "logo.svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml"
    ),
    "html_in_disguise": lambda: fake_upload(
        "photo.jpg", b"<html><body><script>alert(1)</script></body></html>", "image/jpeg"
    ),
    "corrupt_jpeg": lambda: fake_upload("photo.jpg", image_bytes("JPEG")[:300], "image/jpeg"),
    "plain_text": lambda: fake_upload("photo.png", b"definitely not a picture", "image/png"),
    "gif_not_allowed": lambda: fake_upload("anim.gif", image_bytes("GIF"), "image/gif"),
}


def stored_files(root, *, prefix: str = "") -> set[str]:
    """Every file under MEDIA_ROOT (relative paths), optionally limited to a sub-folder."""
    found = set()
    base = os.path.join(str(root), prefix)
    for folder, _dirs, files in os.walk(base):
        for f in files:
            found.add(os.path.relpath(os.path.join(folder, f), str(root)))
    return found


def codes(res) -> str:
    """Error code of a standard error body (or '' when the response isn't one)."""
    body = res.json()
    return body.get("error", {}).get("code", "") if isinstance(body, dict) else ""


def details(res) -> dict:
    return res.json()["error"]["details"]
