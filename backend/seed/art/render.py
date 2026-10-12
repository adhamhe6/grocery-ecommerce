"""Headless-Chromium renderer: SVG scene -> framed image (+ transparent cut-out). Used by scripts/generate_demo_images.py."""

from __future__ import annotations

import glob
import io
import os

from PIL import Image

HIDE_JS = """() => {
  window.__hidden = [];
  document.querySelectorAll('#bg, #gshadow, #art [filter]').forEach(e => { e.style.display = 'none'; window.__hidden.push(e); });
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}"""

SHOW_JS = """() => {
  (window.__hidden || []).forEach(e => { e.style.display = ''; });
  window.__hidden = [];
  document.documentElement.style.background = '';
  document.body.style.background = '';
}"""

PROBE_JS = "() => document.getElementById('art').setAttribute('transform', 'translate(450 450) scale(0.6)')"

APPLY_JS = """([transform, gx, gy, bw]) => {
  document.getElementById('art').setAttribute('transform', transform);
  const sh = document.getElementById('gshadow');
  if (sh) {
    const rx = Math.min(310, bw * 0.5 + 34);
    sh.setAttribute('cx', gx + 10); sh.setAttribute('cy', gy + 6);
    sh.setAttribute('rx', rx); sh.setAttribute('ry', Math.max(14, rx * 0.12));
  }
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


def _alpha_bbox(img: Image.Image, threshold: int = 10):
    return img.getchannel("A").point(lambda v: 255 if v > threshold else 0).getbbox()


class Renderer:
    def __init__(self, width: int = 900, height: int = 900, scale: int = 2):
        from playwright.sync_api import sync_playwright

        self.scale = scale
        self._pw = sync_playwright().start()
        exe = find_chromium()
        kwargs = {"args": ["--no-sandbox"]}
        if exe:
            kwargs["executable_path"] = exe
        self._browser = self._pw.chromium.launch(**kwargs)
        self._page = self._browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=scale)

    def close(self) -> None:
        self._browser.close()
        self._pw.stop()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def render(self, svg: str, fit: tuple | None = None, cutout: bool = False):
        """Render `svg` and return the image (device pixels), plus a tight transparent cut-out when requested.

        `fit=(target_w, target_h, ground_x, ground_y, size, max_scale)` first measures the drawn art (alpha bounding
        box, so clipping and soft shadows are respected) and frames it on the ground line.
        """
        page = self._page
        page.set_content(f"<html><body style='margin:0;background:#F6F0E4'>{svg}</body></html>")
        if fit:
            tw, th, gx, gy, size, maxs = fit
            page.evaluate(HIDE_JS)
            page.evaluate(PROBE_JS)
            probe = Image.open(io.BytesIO(page.screenshot(omit_background=True))).convert("RGBA")
            box = _alpha_bbox(probe)
            page.evaluate(SHOW_JS)
            if box:
                k = 0.6 * self.scale
                bx0, by0, bx1, by1 = (
                    (box[0] - 450 * self.scale) / k,
                    (box[1] - 450 * self.scale) / k,
                    (box[2] - 450 * self.scale) / k,
                    (box[3] - 450 * self.scale) / k,
                )
                bw, bh = bx1 - bx0, by1 - by0
                s = min(min(tw / bw, th / bh) * size, maxs)
                cx = (bx0 + bx1) / 2
                gy = min(
                    gy, 470 + bh * s / 2
                )  # low, wide items rise toward the middle instead of sitting at the bottom
                page.evaluate(APPLY_JS, [f"translate({gx} {gy}) scale({s}) translate({-cx} {-by1})", gx, gy, bw * s])
        img = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
        if not cutout:
            return img
        page.evaluate(HIDE_JS)
        cut = Image.open(io.BytesIO(page.screenshot(omit_background=True))).convert("RGBA")
        page.evaluate(SHOW_JS)
        box = _alpha_bbox(cut)
        return img, (cut.crop(box) if box else cut)


def to_webp(img: Image.Image, path: str, quality: int = 80) -> int:
    img.save(path, format="WEBP", quality=quality, method=6)
    return os.path.getsize(path)
