"""Shared drawing helpers for the Orchard Row demo illustrations.

Everything here returns SVG *strings*; nothing touches the filesystem or a browser. Objects are drawn in a
local coordinate system around (0, 0) at roughly 200 px across, then placed/scaled with :func:`place`.

Art direction (see docs/implementation-plan.md section 2):
* warm paper ground (#F6F0E4) with a soft elliptical ground shadow,
* flat, slightly stylised shapes with 2-3 tones and a small highlight,
* one light direction for the whole set: upper left (highlights top-left, shade bottom-right),
* no text on produce; packaged goods carry only a tiny fictional wordmark and pack name.
"""

from __future__ import annotations

import itertools
import math
from functools import lru_cache

# --------------------------------------------------------------------------- brand palette
GREEN = "#1F3D2B"
LEAF = "#3F7D4E"
CREAM = "#FBF7EF"
CLAY = "#B8532F"
CITRUS = "#E3A72F"
INK = "#1B1F1C"
PAPER = "#F6F0E4"

SERIF = "'Liberation Serif', 'DejaVu Serif', Georgia, serif"
SANS = "Inter, 'Liberation Sans', Arial, sans-serif"

_FONT_FILES = {
    "sans": "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
    "serif": "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
}

_ids = itertools.count(1)


def uid(prefix: str = "i") -> str:
    return f"{prefix}{next(_ids)}"


def reset_ids() -> None:
    global _ids
    _ids = itertools.count(1)


def n(value: float) -> str:
    """Compact number formatting for SVG attributes."""
    text = f"{value:.1f}"
    return text[:-2] if text.endswith(".0") else text


# --------------------------------------------------------------------------- colour maths
def _rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    if len(color) == 3:
        color = "".join(ch * 2 for ch in color)
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def _hex(rgb) -> str:
    return "#{:02X}{:02X}{:02X}".format(*(max(0, min(255, round(v))) for v in rgb))


def mix(a: str, b: str, t: float) -> str:
    ra, rb = _rgb(a), _rgb(b)
    return _hex(tuple(ra[i] + (rb[i] - ra[i]) * t for i in range(3)))


def lighten(color: str, t: float = 0.2) -> str:
    return mix(color, "#FFFFFF", t)


def darken(color: str, t: float = 0.2) -> str:
    # warm shade (never pure black) keeps the set on the paper palette
    return mix(color, "#2B1A10", t)


def tone(color: str, t: float) -> str:
    """Positive t lightens, negative t darkens."""
    return lighten(color, t) if t >= 0 else darken(color, -t)


# --------------------------------------------------------------------------- primitives
def place(inner: str, x: float = 0, y: float = 0, s: float = 1, r: float = 0) -> str:
    parts = [f"translate({n(x)} {n(y)})"]
    if r:
        parts.append(f"rotate({n(r)})")
    if s != 1:
        parts.append(f"scale({n(s)})")
    return f'<g transform="{" ".join(parts)}">{inner}</g>'


def ell(cx, cy, rx, ry, rot: float = 0):
    t = f' transform="rotate({n(rot)} {n(cx)} {n(cy)})"' if rot else ""
    return lambda a="": f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}"{t} {a}/>'


def pth(d: str):
    return lambda a="": f'<path d="{d}" {a}/>'


def rrect(x, y, w, h, r=0):
    return lambda a="": f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}" rx="{n(r)}" {a}/>'


def poly(points):
    pts = " ".join(f"{n(px)},{n(py)}" for px, py in points)
    return lambda a="": f'<polygon points="{pts}" {a}/>'


def body(shape, base: str, depth: float = 14, shade: float = 0.24) -> str:
    """Flat two-tone solid: dark base, light copy shifted toward the light (upper left) and clipped to the shape.

    `shape` is a callable taking an attribute string. The visible result is a crisp shaded crescent on the
    lower-right edge, which is the whole "lighting model" of the set.
    """
    cid = uid("c")
    dark_attr = f'fill="{darken(base, shade)}"'
    base_attr = f'fill="{base}"'
    return (
        f'<clipPath id="{cid}">{shape("")}</clipPath>'
        f'<g clip-path="url(#{cid})">{shape(dark_attr)}'
        f'<g transform="translate({n(-depth)} {n(-depth * 0.9)})">{shape(base_attr)}</g></g>'
    )


def shine(cx, cy, rx, ry, rot: float = -35, a: float = 0.42) -> str:
    return f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}" transform="rotate({n(rot)} {n(cx)} {n(cy)})" fill="#fff" opacity="{a}"/>'


def line(x1, y1, x2, y2, w=6, color=INK, cap="round", op=1.0, dash: str | None = None) -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<line x1="{n(x1)}" y1="{n(y1)}" x2="{n(x2)}" y2="{n(y2)}" stroke="{color}" stroke-width="{n(w)}" '
        f'stroke-linecap="{cap}" opacity="{op}"{d}/>'
    )


def stroke_path(d: str, w=6, color=INK, op=1.0, cap="round", fill="none") -> str:
    return (
        f'<path d="{d}" fill="{fill}" stroke="{color}" stroke-width="{n(w)}" stroke-linecap="{cap}" '
        f'stroke-linejoin="round" opacity="{op}"/>'
    )


def circle(cx, cy, r, fill, op: float = 1.0) -> str:
    return f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{fill}" opacity="{op}"/>'


def contact(x, y, rx, ry, op=0.22) -> str:
    """Small blurred shadow directly under an object so grouped items sit on the ground."""
    return f'<ellipse cx="{n(x)}" cy="{n(y)}" rx="{n(rx)}" ry="{n(ry)}" fill="#4A3622" opacity="{op}" filter="url(#soft)"/>'


# --------------------------------------------------------------------------- organic outlines
def blob_path(rx: float, ry: float, wobble: float = 0.06, seed: int = 1, k: int = 5, steps: int = 36) -> str:
    """Smooth lumpy closed outline (potatoes, stones, mushrooms). Deterministic for a given seed."""
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        w = 1 + wobble * math.sin(k * a + seed) + wobble * 0.6 * math.sin((k + 2) * a + seed * 1.7)
        pts.append((rx * w * math.cos(a), ry * w * math.sin(a)))
    return smooth_closed(pts)


def smooth_closed(pts) -> str:
    """Catmull-Rom spline through points, as a closed cubic Bezier path."""
    m = len(pts)
    d = f"M{n(pts[0][0])},{n(pts[0][1])}"
    for i in range(m):
        p0, p1, p2, p3 = pts[(i - 1) % m], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{n(c1[0])},{n(c1[1])} {n(c2[0])},{n(c2[1])} {n(p2[0])},{n(p2[1])}"
    return d + " Z"


def leaf_poly(length: float, width: float, wave: float = 0.0, k: float = 3, tip: float = 0.8, steps: int = 28):
    """Leaf outline pointing up from (0, 0). Returns a list of points (left edge up, right edge down)."""
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        base = math.sin(math.pi * (t**tip)) ** 0.9
        ripple = 1 + wave * math.sin(2 * math.pi * k * t) if wave else 1
        w = width / 2 * base * ripple
        left.append((-w, -length * t))
        right.append((w, -length * t))
    return left + right[::-1]


def leaf(length, width, color, wave=0.0, k=3, vein=True, tip=0.8, depth=None, rot=0.0, x=0.0, y=0.0) -> str:
    pts = leaf_poly(length, width, wave, k, tip)
    shape = poly(pts)
    out = body(shape, color, depth=depth if depth is not None else max(3, width * 0.08), shade=0.22)
    if vein:
        out += line(0, -length * 0.04, 0, -length * 0.9, max(1.5, width * 0.035), lighten(color, 0.35), op=0.8)
    return place(out, x, y, 1, rot)


# --------------------------------------------------------------------------- text
@lru_cache(maxsize=256)
def _font(kind: str, size: int):
    try:
        from PIL import ImageFont

        return ImageFont.truetype(_FONT_FILES[kind], size)
    except Exception:  # noqa: BLE001 - Pillow/fonts are optional here; fall back to a heuristic width
        return None


def text_width(s: str, size: float, kind: str = "sans") -> float:
    f = _font(kind, 100)
    if f is not None:
        return f.getlength(s) * size / 100
    return len(s) * size * (0.62 if kind == "sans" else 0.55)


def fit_size(s: str, max_w: float, size: float, kind: str = "sans", min_size: float = 12, ls: float = 0) -> float:
    w = text_width(s, size, kind) + ls * len(s) * size / 16
    return size if w <= max_w else max(min_size, size * max_w / w)


def wrap_words(s: str, max_w: float, size: float, kind: str = "sans", max_lines: int = 2) -> list[str]:
    words = s.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if cur and text_width(trial, size, kind) > max_w and len(lines) < max_lines - 1:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    lines.append(cur)
    return lines


def txt(x, y, s: str, size: float, fill: str, kind: str = "sans", weight: int = 700, anchor="middle", ls=0, op=1.0):
    family = SANS if kind == "sans" else SERIF
    s = s.replace("&", "&amp;").replace("<", "&lt;")
    spacing = f' letter-spacing="{n(ls)}"' if ls else ""
    return (
        f'<text x="{n(x)}" y="{n(y)}" font-family="{family}" font-size="{n(size)}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}"{spacing} opacity="{op}">{s}</text>'
    )


def lum(color: str) -> float:
    r, g, b = _rgb(color)
    return 0.299 * r + 0.587 * g + 0.114 * b


def readable(fg: str, bg: str, min_diff: float = 95) -> str:
    """Nudge `fg` until it contrasts with `bg` (keeps accent colours legible on any label)."""
    if abs(lum(fg) - lum(bg)) >= min_diff:
        return fg
    return lighten(fg, 0.75) if lum(bg) < 140 else darken(fg, 0.55)


def label_layout(brand: str, name: str, w: float, name_size: float = 30):
    bsize = fit_size(brand.upper(), w * 0.94, 16, "serif", 9, ls=1.6) if brand else 0
    lines = wrap_words(name, w * 0.94, name_size, "sans", 2) if name else []
    nsize = fit_size(max(lines, key=len), w * 0.94, name_size, "sans", 14) if lines else 0
    height = (bsize + 14 if brand else 0) + len(lines) * nsize * 1.14
    return bsize, lines, nsize, height


def label_text(
    cx: float,
    cy: float,
    w: float,
    brand: str,
    name: str,
    fg: str,
    accent: str,
    name_size: float = 30,
    bg: str | None = None,
):
    """Tiny wordmark above a one/two-line pack name, vertically centred on (cx, cy) inside a label `w` px wide."""
    if bg:
        accent = readable(accent, bg)
    bsize, lines, nsize, height = label_layout(brand, name, w, name_size)
    out = []
    y = cy - height / 2
    if brand:
        y += bsize * 0.9
        out.append(txt(cx, y, brand.upper(), bsize, accent, "serif", 700, ls=1.6))
        y += 8
        out.append(line(cx - w * 0.14, y, cx + w * 0.14, y, 2, accent, op=0.8))
        y += 4
    y += nsize * 0.88
    for ln in lines:
        out.append(txt(cx, y, ln, nsize, fg, "sans", 800))
        y += nsize * 1.14
    return "".join(out)


# --------------------------------------------------------------------------- glyph icons (label decoration)
def glyph(name: str, cx: float, cy: float, s: float, color: str) -> str:
    """Tiny pictograms, drawn inside a 100x100 box scaled by s/100."""
    paths = {
        "wheat": (
            stroke_path("M50,92 L50,18", 5, color)
            + "".join(
                f'<ellipse cx="{x}" cy="{y}" rx="9" ry="17" transform="rotate({r} {x} {y})" fill="{color}"/>'
                for x, y, r in [(36, 62, -32), (64, 62, 32), (35, 40, -30), (65, 40, 30), (50, 20, 0)]
            )
        ),
        "leaf": f'<path d="M50,92 C14,70 14,28 50,8 C86,28 86,70 50,92 Z" fill="{color}"/>'
        + stroke_path("M50,92 L50,26", 4, "#ffffff", 0.7),
        "drop": f'<path d="M50,8 C70,40 82,56 82,68 A32,32 0 0 1 18,68 C18,56 30,40 50,8 Z" fill="{color}"/>',
        "tomato": circle(50, 56, 34, color)
        + f'<path d="M50,24 L58,36 L72,32 L62,42 L50,40 L38,42 L28,32 L42,36 Z" fill="{lighten(color, 0.55)}"/>',
        "bean": f'<ellipse cx="50" cy="50" rx="22" ry="38" transform="rotate(35 50 50)" fill="{color}"/>'
        + stroke_path("M36,26 C52,48 48,60 62,76", 4, "#ffffff", 0.7),
        "sun": circle(50, 50, 20, color)
        + "".join(
            f'<line x1="{50 + 30 * math.cos(math.radians(a)):.1f}" y1="{50 + 30 * math.sin(math.radians(a)):.1f}" '
            f'x2="{50 + 42 * math.cos(math.radians(a)):.1f}" y2="{50 + 42 * math.sin(math.radians(a)):.1f}" '
            f'stroke="{color}" stroke-width="6" stroke-linecap="round"/>'
            for a in range(0, 360, 45)
        ),
        "fish": f'<ellipse cx="46" cy="50" rx="34" ry="20" fill="{color}"/><path d="M76,50 L96,32 L96,68 Z" fill="{color}"/>'
        + circle(30, 46, 4, "#ffffff"),
        "cup": f'<path d="M18,30 L72,30 L66,78 Q64,88 54,88 L36,88 Q26,88 24,78 Z" fill="{color}"/>'
        + stroke_path("M72,40 C92,40 92,64 68,64", 6, color),
        "star": f'<path d="M50,8 L61,38 L93,40 L68,60 L77,92 L50,74 L23,92 L32,60 L7,40 L39,38 Z" fill="{color}"/>',
        "snow": "".join(
            stroke_path(
                f"M50,50 L{50 + 40 * math.cos(math.radians(a)):.1f},{50 + 40 * math.sin(math.radians(a)):.1f}", 6, color
            )
            for a in range(0, 360, 60)
        ),
        "berry": circle(36, 62, 22, color)
        + circle(66, 60, 20, color)
        + circle(50, 36, 20, color)
        + f'<path d="M50,14 C56,6 66,8 68,16 C60,20 54,20 50,14 Z" fill="{LEAF}"/>',
        "nut": f'<path d="M50,10 C78,30 84,62 62,88 C54,96 46,96 38,88 C16,62 22,30 50,10 Z" fill="{color}"/>'
        + stroke_path("M50,14 C46,40 54,64 50,90", 4, "#ffffff", 0.55),
        "heart": f'<path d="M50,88 C10,56 8,26 30,18 C42,14 50,24 50,30 C50,24 58,14 70,18 C92,26 90,56 50,88 Z" fill="{color}"/>',
        "moon": f'<path d="M62,10 A42,42 0 1 0 90,64 A34,34 0 1 1 62,10 Z" fill="{color}"/>',
        "bubble": circle(36, 62, 22, color, 0.9) + circle(66, 40, 16, color, 0.9) + circle(70, 74, 10, color, 0.9),
    }
    inner = paths.get(name, circle(50, 50, 30, color))
    return f'<g transform="translate({n(cx - s / 2)} {n(cy - s / 2)}) scale({n(s / 100)})">{inner}</g>'


# --------------------------------------------------------------------------- 3-D-ish box helper
def cuboid(x, y, w, h, d, front, top=None, side=None, r=10) -> str:
    """Front face at (x, y, w, h) plus a top and right face of depth d (toward upper right)."""
    top = top or lighten(front, 0.28)
    side = side or darken(front, 0.28)
    dx, dy = d * 0.62, d * 0.42
    top_face = poly([(x, y), (x + dx, y - dy), (x + w + dx, y - dy), (x + w, y)])
    side_face = poly([(x + w, y), (x + w + dx, y - dy), (x + w + dx, y + h - dy), (x + w, y + h)])
    return (
        top_face(f'fill="{top}"')
        + side_face(f'fill="{side}"')
        + rrect(x, y, w, h, r)(f'fill="{front}"')
        + f'<path d="M{n(x + 4)},{n(y + 4)} L{n(x + w - 4)},{n(y + 4)}" stroke="#fff" stroke-width="3" opacity=".35" stroke-linecap="round"/>'
    )


# --------------------------------------------------------------------------- layouts
# Slots are (x, ground_y, scale, rotation) inside the standard art box x in [-300, 300], ground at y = 250.
# Unit objects are drawn ~200 px across with their base at local y = UNIT_BASE.
UNIT_BASE = 95
LAYOUTS: dict[int, list[tuple[float, float, float, float]]] = {
    1: [(0, 250, 2.45, 0)],
    2: [(-135, 236, 1.95, -7), (145, 252, 1.95, 8)],
    3: [(0, 178, 1.72, 3), (-150, 250, 1.72, -8), (152, 252, 1.72, 8)],
    4: [(-70, 168, 1.55, 4), (86, 172, 1.55, -5), (-150, 252, 1.55, -8), (150, 254, 1.55, 8)],
    5: [(-82, 160, 1.45, 4), (88, 164, 1.45, -5), (-168, 245, 1.45, -8), (170, 248, 1.45, 8), (4, 262, 1.5, 0)],
    6: [
        (-150, 152, 1.3, 4),
        (4, 150, 1.3, -4),
        (150, 154, 1.3, 5),
        (-196, 255, 1.3, -8),
        (2, 266, 1.38, 0),
        (198, 256, 1.3, 8),
    ],
}


def arrange(count: int, draw, *, scale: float = 1.0) -> str:
    """Draw `count` items with `draw(i)` (local art, base at UNIT_BASE) using LAYOUTS, back to front."""
    count = max(1, min(count, 6))
    slots = sorted(LAYOUTS[count], key=lambda t: t[1])
    out = []
    for i, (x, ground, s, r) in enumerate(slots):
        s *= scale
        out.append(contact(x, ground, 88 * s, 13 * s, 0.22))
        out.append(place(draw(i), x, ground - UNIT_BASE * s, s, r))
    return "".join(out)


# --------------------------------------------------------------------------- scene wrapper
DEFS = (
    '<defs><filter id="soft" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="8"/></filter>'
    '<filter id="blur" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="18"/></filter>'
    '<radialGradient id="paper" cx="50%" cy="44%" r="78%"><stop offset="0" stop-color="#FAF5EA"/>'
    '<stop offset="1" stop-color="#F1E8D6"/></radialGradient></defs>'
)


def scene(art: str, *, bg: str | None = None, shadow: bool = True, w: int = 900, h: int = 900) -> str:
    """Wrap object art into a full illustration on warm paper.

    The art sits inside `<g id="art">`; render.py measures its bounding box in Chromium and scales/centres it onto
    the ground line, so archetypes never need to hand-tune their own framing.
    """
    paper_rect = f'<rect width="{w}" height="{h}" fill="url(#paper)"/>'
    ground = (
        '<ellipse id="gshadow" cx="450" cy="700" rx="200" ry="26" fill="#4A3622" opacity=".20" filter="url(#blur)"/>'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{DEFS}'
        f'<g id="bg">{bg if bg is not None else paper_rect}</g>'
        f"{ground if shadow else ''}"
        f'<g id="art">{art}</g></svg>'
    )
