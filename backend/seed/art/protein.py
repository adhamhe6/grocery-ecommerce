"""Meat, poultry and seafood archetypes (drawn on a plain white tray where sensible)."""

from __future__ import annotations

import math

from .core import (
    blob_path,
    body,
    circle,
    contact,
    darken,
    ell,
    leaf,
    lighten,
    line,
    place,
    pth,
    rrect,
    shine,
    smooth_closed,
    stroke_path,
    tone,
)

TRAY = "#F7F5EF"


def tray(w=420, h=60) -> str:
    out = body(rrect(-w / 2, -6, w, h, 16), TRAY, depth=6, shade=0.14)
    out += rrect(-w / 2 + 12, -2, w - 24, 18, 8)('fill="#E9E5DA"')
    out += line(-w / 2 + 16, 4, w / 2 - 16, 4, 3, "#fff", op=0.8)
    return out


def _film(w=440, h=240, y=-190) -> str:
    return f'<g opacity=".16"><polygon points="{-w / 2},{y + h} {-w / 2 + 120},{y} {-w / 2 + 190},{y} {-w / 2 + 70},{y + h}" fill="#fff"/></g>'


def _fillet_unit(c: str, i: int) -> str:
    path = blob_path(122, 70, 0.1, seed=i + 3, k=3)
    out = body(pth(path), c, depth=12, shade=0.2)
    out += stroke_path("M-80,-10 C-30,-34 40,-30 84,-8", 5, lighten(c, 0.4), 0.6)
    out += stroke_path("M-70,24 C-20,6 40,10 80,26", 4, darken(c, 0.2), 0.3)
    out += shine(-52, -30, 34, 8, -10, 0.45)
    return out


def meat(kind="breast", c="#F1C2A6", **_) -> str:
    out = tray(460, 56)
    if kind == "breast":
        out += place(_fillet_unit(tone(c, -0.02), 1), -100, -64, 1.0, -6)
        out += place(_fillet_unit(c, 2), 96, -58, 0.95, 8)
        return place(out + _film(), 0, 20)
    if kind == "mince":
        heap = "M-200,-6 C-200,-70 -120,-110 0,-112 C120,-110 200,-70 200,-6 C150,16 -150,16 -200,-6 Z"
        out += place(body(pth(heap), c, depth=14, shade=0.28), 0, -34)
        for k in range(120):
            a = k * 2.399963
            r = math.sqrt((k + 0.5) / 120)
            x, y = math.cos(a) * 176 * r, -64 + math.sin(a) * 36 * r - 26 * (1 - r)
            out += ell(x, y, 15, 7, (k * 47) % 180)(f'fill="{tone(c, ((k * 7) % 9 - 4) * 0.045)}"')
        for k in range(26):
            a = k * 2.399963 + 1
            r = math.sqrt((k + 0.5) / 26)
            out += ell(math.cos(a) * 150 * r, -72 + math.sin(a) * 26 * r, 8, 3.4, (k * 31) % 180)('fill="#F4D6CC" opacity=".4"')
        return place(out + _film(), 0, 10)
    # steak / chop
    d = "M-150,0 C-150,-60 -80,-92 0,-92 C90,-92 150,-50 150,4 C150,52 90,80 0,80 C-80,80 -150,56 -150,0 Z"
    out += place(body(pth(d), c, depth=12, shade=0.25), 0, -30, 1.0, -3)
    out += place(stroke_path("M-90,-20 C-30,-60 40,-60 100,-24", 14, "#F6E6D4", 0.8), 0, -30)
    out += place(stroke_path("M-70,20 C-20,0 40,2 90,22", 5, "#F6E6D4", 0.6), 0, -30)
    out += place(body(ell(0, 0, 38, 30), "#F6EFE4", depth=5, shade=0.2), 70, -14)
    return place(out, 0, 20)


def chicken(c="#F0C79C", **_) -> str:
    out = ""
    # wings tucked at the sides
    out += place(body(ell(0, 0, 58, 36), tone(c, -0.05), depth=7, shade=0.25), -138, -40, 1, -30)
    out += place(body(ell(0, 0, 58, 36), tone(c, -0.05), depth=7, shade=0.25), 138, -40, 1, 30)
    out += body(pth(blob_path(150, 118, 0.03, seed=2, k=3)), c, depth=17, shade=0.22)
    # breast line and skin texture
    out += stroke_path("M0,-100 C-6,-40 -6,20 0,70", 5, darken(c, 0.25), 0.28)
    for k in range(40):
        a = k * 2.399963
        r = math.sqrt((k + 0.5) / 40)
        out += circle(math.cos(a) * 120 * r, -4 + math.sin(a) * 92 * r, 2.6, darken(c, 0.25), 0.3)
    # legs
    for sx in (-1, 1):
        leg = body(ell(0, 0, 50, 70), tone(c, -0.03), depth=9, shade=0.25)
        out += place(leg, sx * 92, 82, 1, sx * -18)
        out += place(rrect(-12, 0, 24, 36, 10)('fill="#F6EFE0"'), sx * 126, 134, 1, sx * -18)
    out += shine(-60, -70, 36, 14, -28, 0.42)
    # neck stub
    out += body(ell(0, -118, 30, 16), darken(c, 0.12), depth=4, shade=0.25)
    return place(out, 0, 0)


def fish(kind="salmon", c="#F0875B", **_) -> str:
    if kind == "prawns":
        return shrimp(c)
    d = "M-200,30 C-182,-40 -62,-74 40,-64 C130,-54 196,-20 206,12 C176,52 76,70 -30,68 C-112,66 -190,62 -200,30 Z"
    flesh = c
    out = tray(470, 56)
    fil = body(pth(d), flesh, depth=13, shade=0.2)
    if kind == "salmon":
        for k in range(7):
            x = -150 + k * 46
            fil += stroke_path(f"M{x},{-34 + abs(k - 3) * 4} C{x + 18},{-10} {x + 14},{20} {x - 6},{54 - abs(k - 3) * 4}", 8, "#FCE3D2", 0.7)
        out += place(fil, 0, -60)
        out += place(stroke_path("M-190,40 C-110,70 90,72 196,22", 10, "#B9C2C7", 0.9), 0, -60)
    else:
        for k in range(6):
            x = -150 + k * 54
            fil += stroke_path(f"M{x},{-30} C{x + 16},{-8} {x + 12},{22} {x - 6},{52}", 6, darken(flesh, 0.16), 0.5)
        out += place(fil, 0, -60)
    out += shine(-90, -108, 50, 7, -8, 0.4)
    # lemon wedge garnish
    wedge = body(pth("M-50,0 A50,50 0 0 1 50,0 Z"), "#F0CE3A", depth=5, shade=0.22) + pth("M-38,-2 A38,38 0 0 1 38,-2 Z")('fill="#FAEE9A"')
    out += place(wedge, 150, -22, 0.8, 8)
    return place(out + _film(500, 200, -170), 0, 24)


def shrimp(c="#F29C7A") -> str:
    out = tray(470, 56)
    units = [(-130, -58, -8, 1.0), (50, -50, 10, 1.05), (-30, -128, 4, 0.95), (170, -26, -18, 0.85)]
    for k, (x, y, r, s) in enumerate(units):
        seg = ""
        total = 7
        for j in range(total):
            t = j / (total - 1)
            a = math.radians(30 + 250 * t)
            px, py = math.cos(a) * 62, math.sin(a) * 62
            size = 30 - 12 * t
            seg += body(ell(px, py, size, size * 0.8, math.degrees(a) + 90), tone(c, 0.04 * math.sin(j * 1.4)), depth=5, shade=0.26)
            seg += stroke_path(f"M{px - size * 0.8:.1f},{py:.1f} L{px + size * 0.8:.1f},{py:.1f}", 3, darken(c, 0.3), 0.3)
        tail = math.radians(30 + 250)
        tx, ty = math.cos(tail) * 62, math.sin(tail) * 62
        for ang in (170, 205, 240):
            seg += place(leaf(36, 18, tone(c, -0.05), vein=False, depth=3), tx, ty, 1, ang)
        hx, hy = math.cos(math.radians(30)) * 62, math.sin(math.radians(30)) * 62
        seg += stroke_path(f"M{hx + 20:.0f},{hy - 8:.0f} q26,-18 44,-4", 3, darken(c, 0.2), 0.7)
        seg += circle(hx + 6, hy - 6, 4, "#2B1A10")
        out += place(seg, x, y, s * 1.35, r)
    return place(out + _film(500, 200, -170), 0, 24)


def circle_shape(cx, cy, r):
    return lambda a="": f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" {a}/>'


ARCHETYPES = {"meat": meat, "chicken": chicken, "fish": fish}

_ = (contact, smooth_closed)
