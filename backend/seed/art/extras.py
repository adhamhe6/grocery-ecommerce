"""Nuts/dried-fruit piles, frozen meal boxes and household / baby / personal-care archetypes."""

from __future__ import annotations

import math

from .core import (
    CREAM,
    INK,
    UNIT_BASE,
    arrange,
    body,
    circle,
    contact,
    cuboid,
    darken,
    ell,
    glyph,
    label_text,
    leaf,
    lighten,
    line,
    place,
    poly,
    pth,
    readable,
    rrect,
    shine,
    stroke_path,
    tone,
)
from .packaged import METAL, label_panel
from .produce import fruit_unit

# --------------------------------------------------------------------------- piles in a bowl


def _nut(kind: str, c: str, i: int) -> str:
    c = tone(c, ((i * 7) % 9 - 4) * 0.025)
    if kind == "almond":
        out = body(pth("M0,-36 C22,-18 26,14 8,34 C2,40 -6,40 -9,31 C-24,12 -20,-18 0,-36 Z"), c, depth=5, shade=0.28)
        return out + stroke_path("M-2,-26 C-10,-4 -8,16 -2,30", 3, lighten(c, 0.35), 0.55)
    if kind == "cashew":
        out = body(pth("M-34,-6 C-24,-34 22,-36 32,-8 C36,8 28,24 14,26 C20,12 8,-2 -8,4 C-14,16 -26,16 -34,-6 Z"), c, depth=5, shade=0.25)
        return out + shine(-6, -18, 14, 4, -10, 0.5)
    if kind == "seed":
        out = body(ell(0, 0, 13, 26), c, depth=3, shade=0.3)
        return out + line(0, -20, 0, 20, 2.4, darken(c, 0.4), op=0.55)
    if kind == "raisin":
        out = body(ell(0, 0, 24, 17), c, depth=4, shade=0.3)
        return out + stroke_path("M-14,-4 q6,-6 12,0 q6,6 12,0", 2.4, lighten(c, 0.3), 0.5) + circle(-8, -7, 3, "#fff", 0.35)
    if kind == "apricot":
        out = body(ell(0, 0, 36, 28), c, depth=5, shade=0.25)
        return out + ell(-2, 2, 14, 10)(f'fill="{darken(c, 0.22)}" opacity=".55"') + shine(-14, -12, 10, 4, -20, 0.4)
    if kind == "date":
        out = body(ell(0, 0, 40, 19), c, depth=4, shade=0.3)
        return out + stroke_path("M-26,-4 q10,-6 18,0 q10,6 18,0", 2.4, lighten(c, 0.3), 0.45) + shine(-16, -9, 12, 3, -4, 0.45)
    return body(circle_shape(0, 0, 20), c, depth=4, shade=0.25)


def circle_shape(cx, cy, r):
    return lambda a="": f'<circle cx="{cx}" cy="{cy}" r="{r}" {a}/>'


def pile(kind="almond", c="#A8693A", bowl="#EFE6D3", rim="#B8532F", scale=1.0, **_) -> str:
    items = []
    rows = 8
    sp = 44 * scale
    for r in range(rows):
        y = -26 - r * 29 * scale
        half = 200 * math.sqrt(max(0.0, 1 - (r / (rows + 0.6)) ** 2))
        cols = int(half * 2 / sp)
        for k in range(cols + 1):
            x = -half + k * sp + (sp / 2 if r % 2 else 0) + (((r * 7 + k * 5) % 6) - 3)
            if abs(x) <= half:
                items.append((y + ((k * 11 + r * 3) % 9 - 4), x, r * 100 + k))
    out = ""
    for y, x, i in sorted(items):
        out += place(_nut(kind, c, i), x, y, scale * 1.15, (i * 47) % 360)
    # bowl in front of the heap
    out += body(pth("M-210,-30 L210,-30 C200,90 120,140 0,140 C-120,140 -200,90 -210,-30 Z"), bowl, depth=12, shade=0.14)
    out += body(rrect(-220, -44, 440, 24, 12), lighten(bowl, 0.15), depth=4, shade=0.14)
    out += rrect(-190, 10, 380, 14, 0)(f'fill="{rim}" opacity=".85"')
    out += rrect(-150, -20, 14, 120, 7)('fill="#fff" opacity=".28"')
    return out


# --------------------------------------------------------------------------- frozen meal boxes


def frozen(kind="pizza", c="#C8402F", brand="", name="", accent=None, **_) -> str:
    accent = accent or darken(c, 0.2)
    if kind == "pizza":
        w = h = 340
        out = cuboid(-w / 2, -h / 2, w, h, 44, c, r=8)
        out += circle(0, -10, 130, "#E6B35A") + circle(0, -10, 112, "#C8402F") + circle(0, -10, 104, "#F2C94C")
        for k in range(9):
            a = k * 2.399963
            r = math.sqrt((k + 0.5) / 9)
            x, y = math.cos(a) * 90 * r, -10 + math.sin(a) * 90 * r
            out += circle(x, y, 17, "#B33A2A") + circle(x - 4, y - 5, 5, "#E86A55", 0.8)
        for k, (x, y, r) in enumerate([(-50, 30, -30), (40, -60, 40), (60, 40, 80), (-30, -50, 10)]):
            out += place(leaf(36, 22, "#3E8E41", vein=False, depth=3), x, y, 1, r)
        out += label_text(0, -h / 2 + 34, w - 40, brand, "", CREAM, "#F6D58A", 24, bg=c)
        out += rrect(-w / 2 + 34, h / 2 - 66, w - 68, 46, 10)(f'fill="{CREAM}"') + label_text(0, h / 2 - 43, w - 90, "", name, INK, accent, 26)
        out += glyph("snow", w / 2 - 36, -h / 2 + 36, 34, "#EAF6FB")
        return out
    if kind == "lasagne":
        w, h = 360, 250
        out = cuboid(-w / 2, -h / 2, w, h, 50, c, r=8)
        # cut-away picture of layered pasta
        px, py, pw, ph = -w / 2 + 28, -h / 2 + 62, w - 56, 110
        out += rrect(px, py, pw, ph, 10)('fill="#F6EFE0"')
        layers = ["#E9C27A", "#B8372A", "#F6EAC8", "#E9C27A", "#B8372A", "#F6EAC8"]
        for k, col in enumerate(layers):
            out += rrect(px + 10, py + 12 + k * 14, pw - 20, 14, 5)(f'fill="{col}"')
        out += place(leaf(40, 24, "#3E8E41", vein=False, depth=3), px + pw / 2, py + 14, 1, 20)
        out += label_text(0, -h / 2 + 32, w - 40, brand, "", CREAM, "#F6D58A", 22, bg=c)
        out += label_text(0, h / 2 - 34, w - 60, "", name, CREAM, accent, 30, bg=c)
        out += glyph("snow", w / 2 - 34, -h / 2 + 30, 32, "#EAF6FB")
        return out
    # fish sticks
    w, h = 250, 330
    out = cuboid(-w / 2, -h / 2, w, h, 60, c, r=8)
    out += label_text(0, -h / 2 + 40, w - 30, brand, "", CREAM, "#F6D58A", 22, bg=c)
    out += rrect(-w / 2 + 24, -h / 2 + 76, w - 48, 120, 12)('fill="#F6EFE0"')
    for k, (x, y, r) in enumerate([(-34, 128 - h / 2 + 8, -18), (4, 128 - h / 2 + 8, 4), (44, 128 - h / 2 + 8, 22)]):
        out += place(body(rrect(-18, -50, 36, 100, 10), "#E4A24A", depth=5, shade=0.25), x, y, 1, r)
    out += label_text(0, h / 2 - 66, w - 36, "", name, CREAM, accent, 30, bg=c)
    out += glyph("snow", w / 2 - 36, -h / 2 + 34, 34, "#EAF6FB")
    return out


# --------------------------------------------------------------------------- household, baby, personal care


def pump(liquid="#E8C547", cap="#FFFFFF", label="#FBF7EF", brand="", name="", glyph_name=None, accent=None, **_) -> str:
    accent = accent or darken(liquid, 0.3)
    d = "M-86,-30 C-86,-84 -46,-100 -26,-124 L-26,-140 L26,-140 L26,-124 C46,-100 86,-84 86,-30 L86,180 C86,202 68,214 46,214 L-46,214 C-68,214 -86,202 -86,180 Z"
    out = body(pth(d), liquid, depth=14, shade=0.26)
    out += rrect(-72, -30, 12, 190, 6)('fill="#fff" opacity=".3"')
    out += body(rrect(-22, -176, 44, 40, 6), cap, depth=4, shade=0.18)
    out += body(rrect(-60, -212, 120, 40, 12), cap, depth=5, shade=0.18)
    out += body(rrect(-100, -206, 60, 18, 8), cap, depth=3, shade=0.18)
    out += label_panel(0, 78, 150, 190, label, brand, name, INK, accent, glyph_name, 28, r=10)
    return out


def tube(c="#FBF7EF", band="#3E7FB0", cap="#3E7FB0", brand="", name="", glyph_name=None, **_) -> str:
    out = body(rrect(-34, 96, 68, 56, 10), cap, depth=5, shade=0.25)
    d = "M-36,96 L-64,56 L-64,-132 L64,-132 L64,56 L36,96 Z"
    out += body(pth(d), c, depth=12, shade=0.14)
    out += rrect(-64, -20, 128, 56, 0)(f'fill="{band}"')
    out += label_text(0, 8, 118, "", name, CREAM if lum_dark(band) else INK, readable(CREAM, band), 28)
    out += glyph(glyph_name, 0, -62, 56, band) if glyph_name else ""
    out += label_text(0, -96, 118, brand, "", INK, band, 20) if brand else ""
    out += body(rrect(-64, -170, 128, 42, 4), darken(c, 0.04), depth=4, shade=0.14)
    for k in range(-5, 6):
        out += line(k * 11, -166, k * 11, -134, 3, darken(c, 0.2), op=0.35)
    out += rrect(-52, -120, 10, 170, 5)('fill="#fff" opacity=".4"')
    return out


def lum_dark(color: str) -> bool:
    from .core import lum

    return lum(color) < 150


def paper_roll_unit(c="#FFFFFF", pattern="#9DB8D6") -> str:
    out = body(rrect(-76, -80, 152, 170, 10), c, depth=10, shade=0.12)
    for k in range(3):
        out += line(-70, -30 + k * 56, 70, -30 + k * 56, 3, darken(c, 0.2), op=0.45, dash="6 8")
    for k in range(10):
        out += circle(-52 + (k % 5) * 26, -52 + (k // 5) * 112, 5, pattern, 0.8)
    out += body(ell(0, -80, 76, 24), lighten(c, 0.1), depth=4, shade=0.1)
    out += ell(0, -80, 28, 10)('fill="#C9A878"') + ell(0, -78, 20, 6)('fill="#6A5238"')
    out += stroke_path("M-60,-82 C-40,-100 40,-100 60,-82", 3, darken(c, 0.2), 0.5)
    out += rrect(-60, -60, 10, 130, 5)('fill="#fff" opacity=".5"')
    return out


def paper_rolls(c="#FFFFFF", pattern="#9DB8D6", count=3, **_) -> str:
    return arrange(max(1, int(count)), lambda i: place(paper_roll_unit(c, pattern), 0, UNIT_BASE - 90, 1.0))


def sponge_unit(i: int) -> str:
    out = cuboid(-110, 8, 220, 44, 100, "#F2D04A", top="#F8E27A", side="#C9A52F", r=8)
    out += cuboid(-110, -26, 220, 34, 100, "#4C9A4F", top="#6DB46F", side="#2F7634", r=8)
    for k in range(18):
        out += circle(-96 + (k * 37) % 190, -14 + (k * 13) % 22, 2.4, "#2F7634", 0.35)
    return out


def sponges(count=3, **_) -> str:
    out = ""
    for i, (x, y, r) in enumerate([(-30, 110, -4), (-10, 20, 2), (10, -70, -3)][: max(1, min(count, 3))]):
        out += contact(x, y + 62, 130, 12, 0.18) + place(sponge_unit(i), x, y, 1.0, r)
    return out


def soap_unit(c: str, band: str, name: str, i: int) -> str:
    out = cuboid(-130, -48, 260, 100, 80, tone(c, ((i * 3) % 4 - 1.5) * 0.02), r=26)
    out += rrect(-70, -48, 140, 100, 0)(f'fill="{CREAM}"') + rrect(-70, -48, 140, 10, 0)(f'fill="{band}"') + rrect(-70, 42, 140, 10, 0)(f'fill="{band}"')
    out += label_text(0, 6, 130, "", name, INK, band, 30)
    return out


def soap(c="#C9B6E4", band="#7A5CA8", brand="", name="", count=3, **_) -> str:
    out = ""
    for i, (x, y, r) in enumerate([(-24, 120, -2), (14, 20, 3), (-10, -80, -3)][: max(1, min(count, 3))]):
        out += contact(x, y + 52, 150, 12, 0.18) + place(soap_unit(c, band, name, i), x, y, 1.0, r)
    return out


def pouch(c="#F6E6B8", cap="#6DB46F", brand="", name="", kinds=("apple", "pear"), **_) -> str:
    d = "M-96,-110 L96,-110 L110,170 Q112,196 88,196 L-88,196 Q-112,196 -110,170 Z"
    out = body(pth(d), c, depth=13, shade=0.18)
    out += body(rrect(-34, -150, 68, 44, 8), cap, depth=4, shade=0.25) + body(rrect(-46, -172, 92, 30, 10), darken(cap, 0.05), depth=3, shade=0.25)
    out += rrect(-88, -96, 176, 12, 6)('fill="#fff" opacity=".28"')
    out += place(fruit_unit("apple", "#C23A32", None, True, 0), -36, 28, 0.38, -6)
    out += place(fruit_unit("pear", "#B7C046", "#D98A3A", True, 1), 40, 22, 0.38, 6)
    out += label_text(0, 112, 170, brand, name, INK, "#8A6A22", 26)
    out += rrect(-84, -60, 10, 230, 5)('fill="#fff" opacity=".3"')
    return out


def wipes(c="#DCEFF7", lid="#7FB8D9", brand="", name="", glyph_name="drop", **_) -> str:
    w, h, d = 300, 190, 120
    out = cuboid(-w / 2, -h / 2 + 30, w, h - 30, d, c, r=18)
    out += body(rrect(-w / 2 - 6, -h / 2 - 16, w + 12, 54, 16), lid, depth=5, shade=0.22)
    out += poly([(w / 2 + 6, -h / 2 - 16), (w / 2 + 6 + d * 0.62, -h / 2 - 16 - d * 0.42), (w / 2 + 6 + d * 0.62, -h / 2 + 38 - d * 0.42), (w / 2 + 6, -h / 2 + 38)])(f'fill="{darken(lid, 0.25)}"')
    out += rrect(-w / 2 + 40, -h / 2 + 8, 44, 14, 7)(f'fill="{darken(lid, 0.2)}"')
    out += label_panel(0, 36, w - 60, 112, "#FBF7EF", brand, name, INK, "#3E7FB0", glyph_name, 28, r=14)
    return out


ARCHETYPES = {
    "pile": pile,
    "frozen": frozen,
    "pump": pump,
    "tube": tube,
    "paper_rolls": paper_rolls,
    "sponges": sponges,
    "soap": soap,
    "pouch": pouch,
    "wipes": wipes,
}

_ = (INK, METAL)
