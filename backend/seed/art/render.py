"""Headless-Chromium renderer: SVG scene -> framed PNG -> small WebP. Used by scripts/generate_demo_images.py."""

from __future__ import annotations

import glob
import io
import os

from PIL import Image

FIT_JS = """([tw, th, gx, gy, size, maxs]) => {
  const art = document.getElementById('art');
  const hidden = art.querySelectorAll('[filter]');
  hidden.forEach(e => { e.style.display = 'none'; });
  const b = art.getBBox();
  hidden.forEach(e => { e.style.display = ''; });
  if (!b.width || !b.height) return null;
  const s = Math.min(Math.min(tw / b.width, th / b.height) * size, maxs);
  const cx = b.x + b.width / 2, bottom = b.y + b.height;
  art.setAttribute('transform', `translate(${gx} ${gy}) scale(${s}) translate(${-cx} ${-bottom})`);
  const sh = document.getElementById('gshadow');
  if (sh) {
    const rx = Math.min(310, b.width * s * 0.5 + 34);
    sh.setAttribute('cx', gx + 10); sh.setAttribute('cy', gy + 6);
    sh.setAttribute('rx', rx); sh.setAttribute('ry', Math.max(14, rx * 0.12));
  }
  return [b.x, b.y, b.width, b.height, s];
}"""


def find_chromium() -> str | None:
    """Prefer an explicit CHROMIUM_PATH, then Playwright's own browsers, then any pre-installed bundle."""
    env = os.environ.get("CHROMIUM_PATH")
    if env and os.path.exists(env):
        return env
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
    for pattern in ("chromium-*/chrome-linux/chrome", "chromium_headless_shell-*/chrome-linux/headless_shell"):
        hits = sorted(glob.glob(os.path.join(root, pattern)))
        if hits:
            return hits[-1]
    return None


class Renderer:
    def __init__(self, width: int = 900, height: int = 900):
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        exe = find_chromium()
        kwargs = {"args": ["--no-sandbox"]}
        if exe:
            kwargs["executable_path"] = exe
        self._browser = self._pw.chromium.launch(**kwargs)
        self._page = self._browser.new_page(viewport={"width": width, "height": height})

    def close(self) -> None:
        self._browser.close()
        self._pw.stop()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def png(self, svg: str, fit: tuple | None = None) -> Image.Image:
        """Render `svg`; `fit=(target_w, target_h, ground_x, ground_y, size, max_scale)` auto-frames #art first."""
        self._page.set_content(f"<html><body style='margin:0;background:#F6F0E4'>{svg}</body></html>")
        if fit:
            self._page.evaluate(FIT_JS, list(fit))
        return Image.open(io.BytesIO(self._page.screenshot())).convert("RGB")


def to_webp(img: Image.Image, path: str, quality: int = 80) -> int:
    img.save(path, format="WEBP", quality=quality, method=6)
    return os.path.getsize(path)
