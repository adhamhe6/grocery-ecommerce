"""Dairy archetypes: egg cartons, butter and cheese."""

from __future__ import annotations

from .core import (
    CREAM,
    INK,
    body,
    circle,
    contact,
    cuboid,
    darken,
    ell,
    glyph,
    label_text,
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

PULP = "#C9BFA6"


def egg_carton(c="#F3E9D8", count=12, **_) -> str:
    cols = max(3, count // 2)
    cw, ch = 96, 112
    w, h = cols * cw + 36, 2 * ch + 40
    out = body(rrect(-w / 2, -h / 2, w, h, 26), PULP, depth=10, shade=0.2)
    out += rrect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 20)(f'fill="{darken(PULP, 0.12)}"')
    # tray lip / front wall
    out += body(rrect(-w / 2, h / 2 - 34, w, 52, 18), tone(PULP, -0.04), depth=6, shade=0.22)
    for k in range(cols - 1):
        out += line(-w / 2 + 18 + (k + 1) * cw, h / 2 - 28, -w / 2 + 18 + (k + 1) * cw, h / 2 + 10, 4, darken(PULP, 0.25), op=0.5)
    eggs = []
    for r in range(2):
        for k in range(cols):
            x = -w / 2 + 18 + cw / 2 + k * cw
            y = -h / 2 + 18 + ch / 2 + r * (ch + 4) + 2
            eggs.append((y, x, k + r * cols))
    for _, x, i in sorted(eggs):
        y = _
        out += ell(x, y + 6, 46, 54)(f'fill="{darken(PULP, 0.28)}" opacity=".6"')
        out += body(ell(x, y, 40, 52), tone(c, ((i * 5) % 7 - 3) * 0.018), depth=8, shade=0.18)
        out += shine(x - 14, y - 22, 9, 15, -22, 0.55)
    return out


def butter(c="#F2D468", wrapper="#F6F0E4", band="#3E6FB0", brand="", name="", **_) -> str:
    w, h, d = 300, 120, 130
    out = cuboid(-w / 2, -h / 2, w, h, d, c, top=lighten(c, 0.3), side=darken(c, 0.2), r=6)
    # the wrapper covers the right 65% of the block
    wx = -w / 2 + w * 0.34
    ww = w * 0.66
    out += poly([(wx, -h / 2), (wx + d * 0.62, -h / 2 - d * 0.42), (wx + ww + d * 0.62, -h / 2 - d * 0.42), (wx + ww, -h / 2)])(f'fill="{lighten(wrapper, 0.1)}"')
    out += poly([(wx + ww, -h / 2), (wx + ww + d * 0.62, -h / 2 - d * 0.42), (wx + ww + d * 0.62, h / 2 - d * 0.42), (wx + ww, h / 2)])(f'fill="{darken(wrapper, 0.12)}"')
    out += rrect(wx, -h / 2, ww, h, 4)(f'fill="{wrapper}"')
    out += rrect(wx, -h / 2 + 8, ww, 22, 0)(f'fill="{band}"')
    out += label_text(wx + ww / 2, 22, ww - 20, brand, name, INK, readable(band, wrapper), 26)
    out += line(wx + 2, -h / 2 + 2, wx + 2, h / 2 - 2, 3, "#fff", op=0.4)
    # a cut slice resting in front
    out += contact(-130, h / 2 + 62, 70, 9, 0.2)
    out += cuboid(-190, h / 2 + 4, 94, 46, 60, c, top=lighten(c, 0.3), side=darken(c, 0.2), r=4)
    return place(out, 0, -10)


def cheese(kind="block", c="#F0A93A", rind="#FBF8EE", **_) -> str:
    if kind == "balls":
        out = ""
        for k, (x, y, s) in enumerate([(-100, 20, 1.0), (90, 40, 0.94), (-6, -30, 1.04)]):
            u = body(circle_shape(0, 0, 100), tone(rind, ((k * 3) % 4 - 1.5) * 0.015), depth=15, shade=0.18) + shine(-44, -44, 22, 34, -30, 0.55)
            u += ell(0, -96, 22, 8)('fill="#F2EBD8" opacity=".8"')
            out += contact(x, y + 98 * s, 90 * s, 12) + place(u, x, y, s)
        out += place(_basil(), 6, -118, 0.9, -10) + place(_basil(), -150, -64, 0.7, -30)
        return out
    if kind == "wedge":
        # brie-style wedge: pale paste on the cut faces, white bloomy rind on the curved edge
        tip, a, b = (-190, 20), (150, -80), (196, 50)
        thick = 84
        front = [tip, b, (b[0], b[1] + thick), (tip[0], tip[1] + thick)]
        out = body(poly(front), "#EBD27A", depth=9, shade=0.22)
        out += poly([a, b, (b[0], b[1] + thick), (a[0], a[1] + thick)])(f'fill="{darken(rind, 0.06)}"')
        out += stroke_path(f"M{a[0] + 14},{a[1] + 10} L{b[0] + 14},{b[1] + 10}", 6, "#fff", 0.5)
        out += body(poly([tip, a, b]), "#F7E9A8", depth=6, shade=0.12)
        out += stroke_path(f"M{a[0]},{a[1]} L{b[0]},{b[1]}", 10, rind)
        out += stroke_path(f"M{tip[0]},{tip[1]} L{b[0]},{b[1]}", 4, "#FFF6C8", 0.7)
        for k in range(7):
            out += circle(-120 + k * 38, 52 + (k % 2) * 8, 3.6, darken("#EBD27A", 0.2), 0.4)
        return place(out, 0, -10)
    # cheddar-style block with a slice cut off the front
    w, h, d = 280, 130, 130
    out = cuboid(-w / 2, -h / 2, w, h, d, c, top=lighten(c, 0.3), side=darken(c, 0.22), r=6)
    out += rrect(-w / 2, h / 2 - 12, w, 12, 3)(f'fill="{darken(c, 0.12)}" opacity=".5"')
    for k in range(7):
        out += ell(-110 + k * 40, -20 + (k * 17) % 50, 6, 4)(f'fill="{darken(c, 0.2)}" opacity=".3"')
    out += stroke_path(f"M{-w / 2 + 8},{-h / 2 + 24} L{w / 2 - 8},{-h / 2 + 24}", 3, lighten(c, 0.5), 0.5)
    out += contact(80, h / 2 + 64, 80, 9, 0.2)
    out += cuboid(40, h / 2 + 6, 120, 38, 70, c, top=lighten(c, 0.3), side=darken(c, 0.22), r=4)
    return place(out, 0, -16)


def circle_shape(cx, cy, r):
    return lambda a="": f'<circle cx="{cx}" cy="{cy}" r="{r}" {a}/>'


def _basil() -> str:
    from .core import leaf

    return leaf(80, 52, "#3E8E41", tip=0.6, depth=5)


ARCHETYPES = {"egg_carton": egg_carton, "butter": butter, "cheese": cheese}

_ = (CREAM, glyph, pth)
