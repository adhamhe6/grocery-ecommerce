"""Packaged-goods archetypes: jars, tins, bags, boxes, bottles, cartons, pots, tubes, pouches.

Packs may carry a tiny fictional wordmark (`brand`) and a short pack name (`name`); both come from the product
record via the generator, so they always match the catalogue. Colours default to the brand colour.
"""

from __future__ import annotations

import math

from .core import (
    CREAM,
    INK,
    LEAF,
    arrange,
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
    mix,
    n,
    place,
    poly,
    pth,
    readable,
    rrect,
    shine,
    stroke_path,
    tone,
    txt,
)

PAPER_BAG = "#CDAA78"
METAL = "#C9CFD2"


def label_panel(cx, cy, w, h, bg, brand, name, fg, accent, glyph_name=None, name_size=30, stripe=None, r=14) -> str:
    from .core import label_layout

    accent = readable(accent, bg)
    out = rrect(cx - w / 2, cy - h / 2, w, h, r)(f'fill="{bg}"')
    top = cy - h / 2
    if stripe:
        out += rrect(cx - w / 2, top, w, 18, r)(f'fill="{stripe}"') + rrect(cx - w / 2, top + 9, w, 9, 0)(
            f'fill="{stripe}"'
        )
        top += 18
    inner_w = w - 16
    _, _, _, th = label_layout(brand or "", name or "", inner_w, name_size)
    avail = h - (top - (cy - h / 2)) - 14
    gs = 0.0
    if glyph_name:
        gs = max(0.0, min(avail - th - 6, h * 0.36, 60))
        if gs < 22:
            gs = 0.0
    block = gs + (6 if gs else 0) + th
    y = top + (h - (top - (cy - h / 2)) - block) / 2
    if gs:
        out += glyph(glyph_name, cx, y + gs / 2, gs, accent)
        y += gs + 6
    out += label_text(cx, y + th / 2, inner_w, brand or "", name or "", fg, accent, name_size)
    return out


def _on_light(color: str) -> bool:
    c = color.lstrip("#")
    r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150


def _fg(bg: str) -> str:
    return INK if _on_light(bg) else CREAM


# --------------------------------------------------------------------------- jars
def jar(
    content="#B8532F",
    lid="#C9A24A",
    label="#FBF7EF",
    shape="round",
    brand="",
    name="",
    accent=None,
    glyph_name=None,
    fill=0.82,
    **_,
) -> str:
    w, h = {"round": (240, 270), "tall": (190, 320), "squat": (270, 210), "small": (170, 190)}[shape]
    accent = accent or darken(content, 0.1)
    out = ""
    # glass body
    glass = rrect(-w / 2, -h / 2 + 34, w, h - 34, 30)
    out += body(glass, lighten(content, 0.78), depth=8, shade=0.12)
    # contents
    top = -h / 2 + 34 + (h - 34) * (1 - fill)
    cid = f"jc{abs(hash((content, shape, name))) % 100000}"
    out += f'<clipPath id="{cid}">{glass("")}</clipPath><g clip-path="url(#{cid})">'
    out += body(rrect(-w / 2, top, w, h / 2 - top + 4, 0), content, depth=14, shade=0.22) + "</g>"
    out += rrect(-w / 2 + 14, -h / 2 + 50, 12, h - 90, 6)('fill="#fff" opacity=".28"')
    # shoulders / neck ring and lid
    nw = w * 0.8
    out += body(rrect(-nw / 2, -h / 2 - 8, nw, 46, 12), lid, depth=6, shade=0.25)
    for k in range(-3, 4):
        out += line(k * nw / 8, -h / 2 - 2, k * nw / 8, -h / 2 + 30, 3, darken(lid, 0.3), op=0.35)
    out += line(-nw / 2 + 8, -h / 2, nw / 2 - 8, -h / 2, 4, lighten(lid, 0.5), op=0.5)
    # label
    lw, lh = w * 0.9, h * 0.6
    out += label_panel(0, h * 0.08, lw, lh, label, brand, name, _fg(label), accent, glyph_name, 30, r=12)
    return out


# --------------------------------------------------------------------------- tins
def tin_unit(c="#B8532F", band="#FBF7EF", brand="", name="", glyph_name=None, short=False, accent=None) -> str:
    h = 150 if short else 240
    w = 200
    y0 = -h / 2
    accent = accent or c
    out = ""
    out += body(rrect(-w / 2, y0, w, h, 6), c, depth=14, shade=0.26)
    out += ell(0, h / 2, w / 2, 22)(f'fill="{darken(c, 0.3)}"')
    # label band (wraps the whole tin) laid out with the shared label helper
    bh = h * 0.72 if not short else h * 0.7
    out += label_panel(0, 2, w, bh, band, brand, name, _fg(band), accent, glyph_name, 30 if not short else 26, r=2)
    out += rrect(-w / 2 + 14, -bh / 2 + 2, 12, bh - 2, 4)('fill="#fff" opacity=".25"')
    # rim and top
    out += rrect(-w / 2 - 4, y0 - 4, w + 8, 14, 5)(f'fill="{METAL}"') + rrect(-w / 2 - 4, h / 2 - 8, w + 8, 14, 5)(
        f'fill="{METAL}"'
    )
    out += body(ell(0, y0, w / 2 + 4, 26), "#D8DDDF", depth=4, shade=0.15)
    out += ell(0, y0, w / 2 - 14, 17)(f'fill="{lighten(METAL, 0.2)}" stroke="{darken(METAL, 0.2)}" stroke-width="3"')
    out += f'<ellipse cx="0" cy="{n(y0)}" rx="26" ry="10" fill="none" stroke="{darken(METAL, 0.3)}" stroke-width="5"/>'
    out += shine(-w / 2 + 28, y0 + 4, 24, 5, -6, 0.5)
    return out


def tin(c="#B8532F", band="#FBF7EF", brand="", name="", glyph_name=None, count=1, short=False, accent=None, **_) -> str:
    if count == 1:
        return tin_unit(c, band, brand, name, glyph_name, short, accent)
    h = 150 if short else 240
    scale = 150 / (h + 26)
    if count == 3:  # a row of three, no overlap (labels stay readable)
        out = ""
        for i, x in enumerate((-215, 0, 215)):
            out += contact(x, 140, 100, 12, 0.2)
            out += place(tin_unit(tone(c, (i - 1) * 0.03), band, brand, name, glyph_name, short, accent), x, 0, 1.0)
        return out
    return arrange(
        count,
        lambda i: place(
            tin_unit(tone(c, ((i * 3) % 4 - 1.5) * 0.03), band, brand, name, glyph_name, short, accent), 0, 0, scale
        ),
    )


# --------------------------------------------------------------------------- bags
def _grain_dots(x, y, w, h, color, count=60, size=3.4, shape="dot") -> str:
    out = ""
    for k in range(count):
        px = x + ((k * 0.618034) % 1) * w
        py = y + ((k * 0.381966 + (k // 7) * 0.13) % 1) * h
        if shape == "dot":
            out += circle(px, py, size, color, 0.9)
        else:
            out += f'<ellipse cx="{n(px)}" cy="{n(py)}" rx="{size * 1.7}" ry="{size * 0.8}" transform="rotate({(k * 47) % 180} {n(px)} {n(py)})" fill="{color}" opacity=".95"/>'
    return out


def bag(
    kind="paper",
    c=PAPER_BAG,
    brand="",
    name="",
    glyph_name=None,
    window=None,
    grains="#F4EBD0",
    label="#FBF7EF",
    accent=None,
    frost=False,
    handle=False,
    **_,
) -> str:
    accent = accent or darken(c, 0.25)
    out = ""
    if kind == "paper":
        w, h = 250, 360
        shape = rrect(-w / 2, -h / 2 + 20, w, h - 20, 14)
        out += body(shape, c, depth=14, shade=0.22)
        out += poly([(w / 2, -h / 2 + 20), (w / 2 + 36, -h / 2 + 4), (w / 2 + 36, h / 2 - 16), (w / 2, h / 2)])(
            f'fill="{darken(c, 0.28)}"'
        )
        out += body(
            poly(
                [
                    (-w / 2, -h / 2 + 20),
                    (-w / 2 + 30, -h / 2 - 20),
                    (w / 2 + 36, -h / 2 - 20),
                    (w / 2 + 36, -h / 2 + 4),
                    (w / 2, -h / 2 + 20),
                ]
            ),
            lighten(c, 0.12),
            depth=4,
            shade=0.2,
        )
        out += line(-w / 2 + 6, -h / 2 + 34, w / 2 - 6, -h / 2 + 34, 4, darken(c, 0.3), op=0.4, dash="10 10")
        pw, ph = w - 40, 140
        out += label_panel(0, -20, pw, ph, label, brand, name, _fg(label), accent, glyph_name, 28)
        if window:
            wy = h / 2 - 96
            out += rrect(-pw / 2, wy - 36, pw, 72, 14)(f'fill="{window}" stroke="{lighten(c, 0.4)}" stroke-width="5"')
            out += _grain_dots(-pw / 2 + 12, wy - 28, pw - 24, 56, grains, 70, 3.2, "grain")
        return out
    if kind == "sack":
        w, h = 270, 400
        d = (
            f"M{-w / 2},{-h / 2 + 50} C{-w / 2 - 14},{-h / 6} {-w / 2 - 20},{h / 4} {-w / 2 + 4},{h / 2 - 10} "
            f"C{-w / 4},{h / 2 + 8} {w / 4},{h / 2 + 8} {w / 2 - 4},{h / 2 - 10} "
            f"C{w / 2 + 20},{h / 4} {w / 2 + 14},{-h / 6} {w / 2},{-h / 2 + 50} Z"
        )
        out += body(pth(d), c, depth=16, shade=0.22)
        out += body(
            poly(
                [
                    (-w / 2 + 6, -h / 2 + 50),
                    (-w / 2 + 30, -h / 2 - 10),
                    (w / 2 - 30, -h / 2 - 10),
                    (w / 2 - 6, -h / 2 + 50),
                ]
            ),
            lighten(c, 0.1),
            depth=4,
            shade=0.2,
        )
        out += stroke_path(
            f"M{-w / 2 + 10},{-h / 2 + 50} C{-w / 6},{-h / 2 + 62} {w / 6},{-h / 2 + 62} {w / 2 - 10},{-h / 2 + 50}",
            5,
            darken(c, 0.35),
            0.6,
        )
        out += label_panel(0, 8, w - 70, 190, label, brand, name, _fg(label), accent, glyph_name, 30)
        return out
    if kind == "coffee":
        w, h = 240, 380
        d = f"M{-w / 2},{-h / 2 + 30} L{w / 2},{-h / 2 + 30} L{w / 2 + 8},{h / 2 - 12} C{w / 2},{h / 2 + 4} {-w / 2},{h / 2 + 4} {-w / 2 - 8},{h / 2 - 12} Z"
        out += body(pth(d), c, depth=15, shade=0.3)
        out += body(rrect(-w / 2, -h / 2, w, 40, 6), lighten(c, 0.1), depth=4, shade=0.3)
        out += line(-w / 2 + 14, -h / 2 + 20, w / 2 - 14, -h / 2 + 20, 4, darken(c, 0.4), op=0.5, dash="8 8")
        out += circle(w / 2 - 50, -h / 2 + 78, 17, darken(c, 0.35)) + circle(
            w / 2 - 50, -h / 2 + 78, 8, lighten(c, 0.3), 0.5
        )
        out += label_panel(0, 30, w - 56, 190, label, brand, name, _fg(label), accent, glyph_name, 30)
        out += rrect(-w / 2 + 10, -h / 2 + 30, 14, h - 50, 7)('fill="#fff" opacity=".12"')
        return out
    # pillow bag with crimped top and bottom
    w, h = 300, 340
    top = [(-w / 2, -h / 2)]
    for k in range(0, 21):
        top.append((-w / 2 + k * w / 20, -h / 2 + (14 if k % 2 else 0)))
    bot = [(w / 2, h / 2)]
    for k in range(20, -1, -1):
        bot.append((-w / 2 + k * w / 20, h / 2 - (14 if k % 2 else 0)))
    d = f"M{-w / 2},{-h / 2 + 46} C{-w / 2 - 30},{-h / 6} {-w / 2 - 30},{h / 6} {-w / 2},{h / 2 - 46} L{w / 2},{h / 2 - 46} C{w / 2 + 30},{h / 6} {w / 2 + 30},{-h / 6} {w / 2},{-h / 2 + 46} Z"
    out += body(pth(d), c, depth=16, shade=0.24)
    out += body(poly(top + [(w / 2, -h / 2 + 52), (-w / 2, -h / 2 + 52)]), lighten(c, 0.08), depth=5, shade=0.2)
    out += body(
        poly([(-w / 2, h / 2 - 52), (w / 2, h / 2 - 52)] + bot[::-1][::-1]), lighten(c, 0.08), depth=5, shade=0.2
    )
    for k in range(1, 8):
        out += line(-w / 2 + k * w / 8, -h / 2 + 4, -w / 2 + k * w / 8, -h / 2 + 50, 3, darken(c, 0.3), op=0.18)
    if handle:
        out += rrect(-46, -h / 2 + 18, 92, 26, 13)('fill="#F6F0E4"')
    ph = 170 if not window else 124
    py = 0 if not window else -34
    out += label_panel(0, py, w - 64, ph, label, brand, name, _fg(label), accent, glyph_name, 30)
    if window:
        wy = h / 2 - 110
        out += rrect(-w / 2 + 34, wy - 28, w - 68, 56, 14)(
            f'fill="{window}" stroke="{lighten(c, 0.4)}" stroke-width="4"'
        )
        out += _grain_dots(-w / 2 + 44, wy - 22, w - 88, 44, grains, 50, 4, "grain")
    if frost:
        out += glyph("snow", w / 2 - 54, -h / 2 + 96, 44, "#EAF6FB")
        out += stroke_path(f"M{-w / 2 + 10},{-h / 2 + 56} L{w / 2 - 10},{-h / 2 + 56}", 3, "#EAF6FB", 0.7)
    out += rrect(-w / 2 + 6, -h / 2 + 60, 12, h - 120, 6)('fill="#fff" opacity=".16"')
    return out


# --------------------------------------------------------------------------- boxes
def box(
    kind="cereal",
    c="#E3A72F",
    brand="",
    name="",
    glyph_name=None,
    window=None,
    grains="#E9C27A",
    label=None,
    accent=None,
    **_,
) -> str:
    dims = {
        "cereal": (230, 340, 96),
        "tea": (200, 230, 110),
        "pasta": (170, 330, 60),
        "cracker": (320, 200, 70),
        "biscuit": (240, 150, 90),
    }
    w, h, d = dims[kind]
    accent = accent or darken(c, 0.2)
    out = cuboid(-w / 2, -h / 2, w, h, d, c, r=8)
    fg = _fg(c)
    if kind == "cereal":
        # sun-burst behind a bowl pictogram, wordmark and name on top
        cid = f"cb{abs(hash((c, name))) % 100000}"
        out += f'<clipPath id="{cid}">{rrect(-w / 2, -h / 2, w, h, 8)("")}</clipPath><g clip-path="url(#{cid})">'
        for k in range(10):
            a = math.radians(-90 + (k - 4.5) * 14)
            pts = [
                (0, -20),
                (math.cos(a - 0.09) * 190, -20 + math.sin(a - 0.09) * 190),
                (math.cos(a + 0.09) * 190, -20 + math.sin(a + 0.09) * 190),
            ]
            out += poly(pts)(f'fill="{lighten(c, 0.18)}" opacity=".55"')
        out += "</g>"
        out += f'<path d="M-62,-6 L62,-6 C58,50 30,70 0,70 C-30,70 -58,50 -62,-6 Z" fill="{CREAM}"/>'
        out += ell(0, -6, 62, 14)(f'fill="{lighten(accent, 0.55)}"')
        out += "".join(
            circle(-40 + k * 20, -8 + ((k * 7) % 5), 9, mix(accent, "#E3A72F", (k % 3) / 3)) for k in range(5)
        )
        out += label_text(0, -h / 2 + 62, w - 30, brand, name, fg, lighten(c, 0.7) if not _on_light(c) else accent, 36)
        out += rrect(-w / 2 + 12, h / 2 - 54, w - 24, 34, 8)(f'fill="{accent}" opacity=".9"') + (
            glyph(glyph_name, 0, h / 2 - 37, 26, CREAM) if glyph_name else ""
        )
        return out
    if kind == "tea":
        out += label_panel(
            0, 6, w - 44, h - 60, label or CREAM, brand, name, INK, accent, glyph_name, 30, stripe=c, r=10
        )
        return out
    if kind == "pasta":
        out += label_panel(0, -h / 2 + 78, w - 24, 118, label or CREAM, brand, name, INK, accent, glyph_name, 26, r=8)
        wy = h / 2 - 96
        out += rrect(-w / 2 + 20, wy - 52, w - 40, 128, 10)(
            f'fill="#F6EFE0" stroke="{lighten(c, 0.5)}" stroke-width="4"'
        )
        if window:
            out += _pasta_window(-w / 2 + 28, wy - 44, w - 56, 112, window, grains)
        return out
    if kind == "cracker":
        out += label_panel(0, 0, w - 60, h - 50, label or CREAM, brand, name, INK, accent, glyph_name, 32, r=10)
        return out
    out += label_panel(0, 0, w - 40, h - 36, label or CREAM, brand, name, INK, accent, glyph_name, 30, r=10)
    return out


def _pasta_window(x, y, w, h, shape, color) -> str:
    out = ""
    if shape == "spaghetti":
        for k in range(9):
            out += line(
                x + 10 + k * (w - 20) / 8, y + 4, x + 10 + k * (w - 20) / 8 + ((k % 3) - 1) * 3, y + h - 4, 7, color
            )
    elif shape == "penne":
        for r_ in range(3):
            for k in range(4):
                px, py = x + 22 + k * (w - 36) / 3.4 + (r_ % 2) * 14, y + 20 + r_ * 36
                out += f'<g transform="rotate(-35 {n(px)} {n(py)})">{rrect(px - 16, py - 8, 36, 17, 5)(f'fill="{color}"')}{rrect(px - 16, py - 8, 36, 5, 2)('fill="#fff" opacity=".3"')}</g>'
    elif shape == "fusilli":
        for r_ in range(3):
            for k in range(4):
                px, py = x + 22 + k * (w - 36) / 3.4 + (r_ % 2) * 14, y + 22 + r_ * 36
                out += stroke_path(f"M{n(px - 14)},{n(py)} q8,-14 14,0 q8,14 14,0", 8, color)
    else:  # nests (tagliatelle)
        for k in range(2):
            px, py = x + w * (0.3 + k * 0.4), y + h / 2
            for j in range(4):
                out += f'<ellipse cx="{n(px)}" cy="{n(py)}" rx="{26 - j * 5}" ry="{24 - j * 5}" fill="none" stroke="{color}" stroke-width="6"/>'
    return out


# --------------------------------------------------------------------------- bottles
def bottle(
    kind="oil",
    liquid="#C9A21F",
    cap="#2B2B2B",
    label="#FBF7EF",
    brand="",
    name="",
    glyph_name=None,
    accent=None,
    glass=None,
    **_,
) -> str:
    accent = accent or darken(liquid, 0.1)
    out = ""
    if kind == "oil":
        d = "M-84,-10 C-84,-80 -34,-100 -28,-150 L-28,-196 L28,-196 L28,-150 C34,-100 84,-80 84,-10 L84,190 C84,208 68,218 50,218 L-50,218 C-68,218 -84,208 -84,190 Z"
        out += body(pth(d), lighten(liquid, 0.2) if glass is None else glass, depth=1, shade=0.1)
        cid = f"bc{abs(hash((liquid, name, kind))) % 100000}"
        out += (
            f'<clipPath id="{cid}">{pth(d)("")}</clipPath><g clip-path="url(#{cid})">'
            + body(rrect(-100, -140, 200, 360, 0), liquid, depth=14, shade=0.25)
            + "</g>"
        )
        out += body(rrect(-34, -226, 68, 44, 8), cap, depth=5, shade=0.3)
        out += rrect(-70, -80, 12, 200, 6)('fill="#fff" opacity=".3"')
        out += label_panel(0, 70, 160, 190, label, brand, name, _fg(label), accent, glyph_name, 30, r=10)
        return out
    if kind == "round":
        d = "M-96,-4 C-96,-70 -40,-86 -30,-120 L-30,-150 L30,-150 L30,-120 C40,-86 96,-70 96,-4 L96,160 C96,184 76,196 54,196 L-54,196 C-76,196 -96,184 -96,160 Z"
        out += body(pth(d), liquid, depth=14, shade=0.3)
        out += body(rrect(-36, -178, 72, 40, 8), cap, depth=5, shade=0.3)
        out += rrect(-80, -60, 12, 200, 6)('fill="#fff" opacity=".22"')
        out += label_panel(0, 60, 176, 176, label, brand, name, _fg(label), accent, glyph_name, 30, r=10)
        return out
    if kind == "water":
        d = (
            "M-70,-110 C-70,-150 -26,-160 -24,-190 L-24,-212 L24,-212 L24,-190 C26,-160 70,-150 70,-110 "
            "L70,-60 C70,-36 56,-30 56,-8 C56,20 74,34 74,60 L74,176 C74,200 60,212 40,212 L-40,212 C-60,212 -74,200 -74,176 "
            "L-74,60 C-74,34 -56,20 -56,-8 C-56,-30 -70,-36 -70,-60 Z"
        )
        out += body(pth(d), liquid, depth=12, shade=0.14)
        out += body(rrect(-28, -240, 56, 40, 6), cap, depth=4, shade=0.3)
        for k in range(3):
            out += stroke_path(
                f"M-72,{-90 + k * 14} C-30,{-84 + k * 14} 30,{-84 + k * 14} 72,{-90 + k * 14}", 3, "#fff", 0.35
            )
        out += rrect(-58, -10, 116, 140, 8)(f'fill="{label}"') + rrect(-58, -10, 116, 18, 8)(f'fill="{accent}"')
        out += label_text(0, 82, 108, brand, name, _fg(label), accent, 26)
        out += glyph(glyph_name or "drop", 0, 26, 30, accent) if glyph_name != "none" else ""
        out += rrect(-62, 20, 10, 150, 5)('fill="#fff" opacity=".35"')
        return out
    # juice / squat bottle
    d = "M-100,-20 C-100,-70 -50,-84 -38,-114 L-38,-134 L38,-134 L38,-114 C50,-84 100,-70 100,-20 L100,170 C100,194 80,206 56,206 L-56,206 C-80,206 -100,194 -100,170 Z"
    out += body(pth(d), liquid, depth=14, shade=0.26)
    out += body(rrect(-44, -166, 88, 44, 8), cap, depth=5, shade=0.3)
    out += rrect(-84, -40, 12, 190, 6)('fill="#fff" opacity=".28"')
    out += label_panel(0, 66, 184, 176, label, brand, name, _fg(label), accent, glyph_name, 30, r=10)
    return out


# --------------------------------------------------------------------------- cartons (gable top) and jugs
def carton(c="#FBF7EF", band="#3E6FB0", brand="", name="", glyph_name=None, cap="#3E6FB0", accent=None, **_) -> str:
    w, h, dx, dy = 200, 300, 64, 34
    roof = 62
    x0, y0 = -w / 2 - 20, -h / 2 + 40
    x1, y1 = x0 + w, y0 + h
    accent = accent or band
    xm = (x0 + x1) / 2
    out = ""
    # right roof slope, side face
    out += poly([(xm, y0 - roof), (x1, y0), (x1 + dx, y0 - dy), (xm + dx, y0 - roof - dy)])(f'fill="{darken(c, 0.12)}"')
    out += poly([(x1, y0), (x1 + dx, y0 - dy), (x1 + dx, y1 - dy), (x1, y1)])(f'fill="{darken(c, 0.26)}"')
    # fin on the ridge
    out += poly([(xm, y0 - roof), (xm + dx, y0 - roof - dy), (xm + dx, y0 - roof - dy - 16), (xm, y0 - roof - 16)])(
        f'fill="{lighten(c, 0.2)}" stroke="{darken(c, 0.2)}" stroke-width="2"'
    )
    out += body(poly([(x0, y0), (xm, y0 - roof), (x1, y0)]), lighten(c, 0.1), depth=6, shade=0.14)
    out += body(rrect(x0, y0, w, h, 4), c, depth=12, shade=0.14)
    out += rrect(x0, y0 + h * 0.55, w, h * 0.45, 0)(f'fill="{band}"') if band else ""
    out += rrect(x0 + 12, y0 + 18, 12, h - 36, 6)('fill="#fff" opacity=".28"')
    out += label_text(xm, y0 + 110, w - 24, brand, name, INK if _on_light(c) else CREAM, accent, 30)
    if glyph_name:
        out += glyph(glyph_name, xm, y0 + h * 0.55 + 62, 70, CREAM)
    out += circle(x1 - 30, y0 + 26, 14, cap) + circle(x1 - 30, y0 + 26, 7, lighten(cap, 0.3))
    return out


def jug(c="#F4F1EA", cap="#3E6FB0", band="#3E6FB0", brand="", name="", glyph_name=None, accent=None, **_) -> str:
    accent = accent or band
    d = "M-96,-70 C-96,-110 -62,-136 -42,-158 L-42,-190 L42,-190 L42,-158 C62,-136 96,-110 96,-70 L96,170 C96,196 76,208 50,208 L-50,208 C-76,208 -96,196 -96,170 Z"
    out = stroke_path("M96,-90 C150,-90 160,-40 150,10 C140,50 112,50 96,46", 22, darken(c, 0.12))
    out += body(pth(d), c, depth=15, shade=0.14)
    out += body(rrect(-50, -226, 100, 44, 8), cap, depth=5, shade=0.3)
    out += rrect(-96, 30, 192, 120, 0)(f'fill="{band}" opacity=".95"')
    out += rrect(-78, -80, 12, 230, 6)('fill="#fff" opacity=".3"')
    out += label_text(0, -30, 170, brand, name, INK, accent, 34)
    if glyph_name:
        out += glyph(glyph_name, 0, 92, 62, CREAM)
    return out


# --------------------------------------------------------------------------- pots
def pot_unit(
    c="#FBF7EF", lid="#6E8FD0", band="#6E8FD0", brand="", name="", glyph_name=None, accent=None, size="tub"
) -> str:
    accent = accent or band
    on_band = CREAM if not _on_light(band) else INK
    if size == "cup":
        d = "M-80,-60 L80,-60 L64,110 Q62,122 50,122 L-50,122 Q-62,122 -64,110 Z"
        out = body(pth(d), c, depth=10, shade=0.16)
        out += body(rrect(-88, -92, 176, 36, 10), METAL, depth=4, shade=0.2)
        out += rrect(-72, -10, 144, 86, 0)(f'fill="{band}" opacity=".95"')
        out += glyph(glyph_name, 0, -34, 40, band) if glyph_name else ""
        out += label_text(0, 34, 128, "", name, on_band, accent, 26)
        out += rrect(-58, -40, 10, 140, 5)('fill="#fff" opacity=".3"')
        return out
    d = "M-130,-64 L130,-64 L104,126 Q102,140 88,140 L-88,140 Q-102,140 -104,126 Z"
    out = body(pth(d), c, depth=12, shade=0.14)
    out += rrect(-118, 20, 236, 102, 0)(f'fill="{band}"')
    out += label_text(0, 72, 214, brand, name, on_band, on_band, 34)
    out += body(rrect(-140, -96, 280, 40, 12), lid, depth=5, shade=0.25)
    out += line(-124, -86, 124, -86, 4, lighten(lid, 0.5), op=0.5)
    out += rrect(-96, -50, 12, 160, 6)('fill="#fff" opacity=".3"')
    if glyph_name:
        out += glyph(glyph_name, 0, -14, 60, band)
    return out


def pot(
    c="#FBF7EF",
    lid="#6E8FD0",
    band="#6E8FD0",
    brand="",
    name="",
    glyph_name=None,
    accent=None,
    size="tub",
    count=4,
    **_,
) -> str:
    if size == "multi":
        out = ""
        slots = [(-92, -70), (92, -70), (-92, 70), (92, 70)][: max(2, min(count, 4))]
        for i, (x, y) in enumerate(slots):
            unit = pot_unit(c, lid, tone(band, (i % 2) * 0.08), brand, name, glyph_name, accent, "cup")
            out += contact(x, y + 88, 70, 10, 0.2) + place(unit, x, y, 0.82)
        return out
    return pot_unit(c, lid, band, brand, name, glyph_name, accent, size)


ARCHETYPES = {
    "jar": jar,
    "tin": tin,
    "bag": bag,
    "box": box,
    "bottle": bottle,
    "carton": carton,
    "jug": jug,
    "pot": pot,
}

_ = (LEAF, contact, txt, tone)
