"""Bakery archetypes: loaves, rolls, pastries and cakes."""

from __future__ import annotations

import math

from .core import (
    arrange,
    body,
    circle,
    contact,
    darken,
    ell,
    lighten,
    line,
    place,
    poly,
    pth,
    rrect,
    shine,
    stroke_path,
    tone,
)

CRUST = "#C98A45"
CRUMB = "#F2DDB0"


def _flour(cx, cy, rx, ry, rot=0, op=0.25) -> str:
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" transform="rotate({rot} {cx} {cy})" fill="#FFF8E8" opacity="{op}"/>'


def _seeds(cx, cy, rx, ry, count, color="#F4E6C0", size=5.5) -> str:
    out = ""
    for k in range(count):
        a = k * 2.399963
        r = math.sqrt((k + 0.5) / count)
        x, y = cx + math.cos(a) * rx * r, cy + math.sin(a) * ry * r
        out += f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{size}" ry="{size * 0.55}" transform="rotate({(k * 53) % 180} {x:.1f} {y:.1f})" fill="{color}"/>'
    return out


def slice_unit(crust: str, crumb: str, seeds: bool = False) -> str:
    outer = "M-74,92 L-74,-6 C-108,-26 -98,-88 -44,-88 C-22,-102 22,-102 44,-88 C98,-88 108,-26 74,-6 L74,92 Z"
    inner = "M-62,82 L-62,-2 C-92,-22 -84,-76 -40,-76 C-20,-88 20,-88 40,-76 C84,-76 92,-22 62,-2 L62,82 Z"
    out = body(pth(outer), crust, depth=7, shade=0.25)
    out += pth(inner)(f'fill="{crumb}"')
    for k in range(26):
        a = k * 2.399963
        out += ell(math.cos(a) * 44 * ((k * 0.7) % 1), -8 + math.sin(a) * 66 * ((k * 0.43) % 1), 3.2, 2.2)(f'fill="{darken(crumb, 0.22)}" opacity=".45"')
    if seeds:
        out += _seeds(0, -10, 44, 62, 18, darken(crumb, 0.35), 4)
    return out


def loaf(kind="batard", crust=CRUST, crumb=CRUMB, seeds=False, sliced=True, n=1, **_) -> str:
    out = ""
    if kind == "tin":
        # sandwich loaf: tin-baked body with a domed top and two slices in front
        out += body(rrect(-170, -10, 340, 110, 18), tone(crust, 0.1), depth=10, shade=0.25)
        out += body(ell(0, -22, 182, 76), crust, depth=14, shade=0.24)
        if seeds:
            out += _seeds(0, -40, 120, 30, 26, "#F4E6C0", 6)
        out += shine(-90, -62, 52, 9, -4, 0.35)
        if sliced:
            out += contact(-60, 106, 100, 12, 0.2) + place(slice_unit(crust, crumb, seeds), -30, 20, 1.05, -4)
            out += contact(90, 112, 100, 12, 0.2) + place(slice_unit(crust, crumb, seeds), 110, 26, 1.0, 5)
        return out
    if kind == "boule":
        out += body(ell(0, 10, 170, 112), crust, depth=18, shade=0.26)
        out += _flour(-20, -30, 130, 56, -4, 0.28)
        # cross-hatch scoring and a lifted ear
        out += stroke_path("M-90,-50 C-30,-92 40,-96 96,-50", 14, lighten(crumb, 0.1), 0.95)
        out += stroke_path("M-70,-62 C-30,-86 30,-90 76,-62", 5, darken(crust, 0.3), 0.5)
        out += stroke_path("M-120,10 C-60,-26 0,-30 40,-24", 7, lighten(crumb, 0.1), 0.65)
        out += shine(-84, -58, 40, 8, -22, 0.3)
        return out
    if kind == "baguette":
        for k, (y, r, s_) in enumerate([(-40, -8, 0.92), (50, 4, 1.0)][: max(1, min(n, 2))]):
            d = "M-250,0 C-240,-34 -190,-44 -120,-44 L120,-44 C200,-44 250,-34 262,0 C250,34 200,44 120,44 L-120,44 C-190,44 -240,34 -250,0 Z"
            u = body(pth(d), tone(crust, k * -0.04), depth=11, shade=0.26)
            for j in range(6):
                x = -165 + j * 66
                u += ell(x, -10, 26, 7, 28)(f'fill="{lighten(crumb, 0.1)}" opacity=".9"')
            u += _flour(-20, -22, 190, 12, 0, 0.3)
            out += contact(0, 44, 230, 12, 0.2) + place(u, 0, y, s_, r)
        return place(out, 0, 20, 1.0)
    # batard (default) - oval loaf with diagonal slashes
    d = "M-200,52 C-208,-34 -126,-92 0,-92 C126,-92 208,-34 200,52 C196,86 150,102 0,102 C-150,102 -196,86 -200,52 Z"
    out += body(pth(d), crust, depth=17, shade=0.26)
    out += _flour(-10, -34, 150, 46, -2, 0.28)
    for k in range(4):
        x = -105 + k * 70
        out += ell(x, -28, 38, 11, 24)(f'fill="{lighten(crumb, 0.15)}"')
        out += ell(x + 4, -26, 30, 6, 24)(f'fill="{crumb}" opacity=".9"')
    if seeds:
        out += _seeds(0, -40, 150, 42, 36)
    out += shine(-110, -56, 48, 8, -16, 0.3)
    return out


def bun_unit(c: str, seeds: bool, glaze: bool, i: int, bottom: bool = False) -> str:
    out = body(pth("M-100,38 C-104,-30 -64,-72 0,-72 C64,-72 104,-30 100,38 C98,60 60,66 0,66 C-60,66 -98,60 -100,38 Z"), tone(c, ((i * 3) % 4 - 1.5) * 0.02), depth=14, shade=0.26)
    out += stroke_path("M-96,40 C-50,52 50,52 96,40", 4, darken(c, 0.3), 0.35)
    if seeds:
        out += _seeds(0, -28, 62, 28, 22, "#F7EAC4", 5.5)
    if glaze:
        out += shine(-40, -40, 34, 9, -14, 0.5)
    else:
        out += _flour(-8, -34, 60, 18, -4, 0.35)
    return out


def rolls(c="#D79A55", n=6, seeds=False, glaze=False, **_) -> str:
    from .core import UNIT_BASE

    return arrange(max(1, int(n)), lambda i: place(bun_unit(c, seeds, glaze, i), 0, UNIT_BASE - 66 - 20, 1.0))


def pastry(kind="croissant", c="#D99A4A", n=1, **_) -> str:
    if kind == "croissant":
        # crescent silhouette: thick centre, horns curling down, with curved ridges across the body
        steps = 40
        top, bot, mid = [], [], []
        def center(t):
            return -210 + 420 * t, 70 - 90 * math.sin(math.pi * t) ** 0.9

        for k in range(steps + 1):
            t = k / steps
            cx_, cy_ = center(t)
            ax, ay = center(min(1.0, t + 0.01))
            bx_, by_ = center(max(0.0, t - 0.01))
            dx, dy = ax - bx_, ay - by_
            ln = math.hypot(dx, dy) or 1
            nx, ny = -dy / ln, dx / ln
            wid = 12 + 150 * math.sin(math.pi * t) ** 0.7
            top.append((cx_ - nx * wid / 2, cy_ - ny * wid / 2))
            bot.append((cx_ + nx * wid / 2, cy_ + ny * wid / 2))
            mid.append((cx_, cy_, nx, ny, wid))
        from .core import smooth_closed

        outline = top + bot[::-1]
        out = body(pth(smooth_closed(outline[::2])), c, depth=10, shade=0.3)
        for k in range(3, steps - 2, 5):
            cx_, cy_, nx, ny, wid = mid[k]
            x1, y1, x2, y2 = cx_ - nx * wid * 0.5, cy_ - ny * wid * 0.5, cx_ + nx * wid * 0.5, cy_ + ny * wid * 0.5
            out += stroke_path(f"M{x1:.0f},{y1:.0f} Q{(x1 + x2) / 2 + 14:.0f},{(y1 + y2) / 2 - 6:.0f} {x2:.0f},{y2:.0f}", 5, darken(c, 0.4), 0.42)
        for k in range(6, steps - 5, 5):
            cx_, cy_, nx, ny, wid = mid[k]
            out += ell(cx_ - nx * wid * 0.22, cy_ - ny * wid * 0.22, 14, 5, -20)('fill="#fff" opacity=".28"')
        return out
    if kind == "pain_choc":
        d = "M-170,10 C-170,-60 -110,-84 -40,-84 L80,-84 C150,-84 190,-50 190,10 C190,60 150,90 80,90 L-40,90 C-110,90 -170,70 -170,10 Z"
        out = body(pth(d), c, depth=14, shade=0.28)
        for k in range(5):
            x = -110 + k * 56
            out += stroke_path(f"M{x},-80 C{x + 14},-30 {x + 14},40 {x},86", 6, darken(c, 0.35), 0.3)
        out += body(ell(184, 4, 18, 52), "#4A2A1A", depth=4, shade=0.3)
        out += shine(-100, -56, 70, 9, -6, 0.32)
        return out
    # cinnamon roll(s)
    def roll(i):
        out = body(ell(0, 22, 108, 74), tone(c, ((i * 3) % 4 - 1.5) * 0.02), depth=14, shade=0.28)
        sp = "M0,22 "
        for k in range(1, 60):
            a = k * 0.34
            r = 2 + k * 1.55
            sp += f"L{math.cos(a) * r * 1.08:.1f},{22 + math.sin(a) * r * 0.74:.1f} "
        out += stroke_path(sp, 7, darken(c, 0.38), 0.5)
        for k in range(5):
            out += stroke_path(f"M{-70 + k * 36},{4 + (k % 2) * 8} q18,-18 36,6", 9, "#FFF8EA", 0.92)
        out += shine(-52, -8, 30, 8, -14, 0.4)
        return out

    from .core import UNIT_BASE

    return arrange(max(1, int(n)), lambda i: place(roll(i), 0, UNIT_BASE - 96, 0.95))


def cake(kind="whole", sponge="#F0D79A", frosting="#FFFFFF", accent="#E56B8C", topping="sprinkles", **_) -> str:
    if kind == "slice":
        out = ""
        # side view of a layered slice
        layers = [sponge, frosting, sponge, frosting, sponge]
        hs = [38, 16, 38, 16, 38]
        y = 86
        for col, h in zip(layers[::-1], hs[::-1], strict=False):
            y -= h
            out += body(rrect(-150, y, 290, h, 2), col, depth=3, shade=0.2)
        top = poly([(-150, y), (140, y), (60, y - 82), (-90, y - 70)])
        out += body(top, frosting, depth=4, shade=0.14)
        out += body(rrect(-150, y - 4, 290, 14, 5), frosting, depth=3, shade=0.14)
        out += body(ell(-10, y - 58, 30, 22), accent, depth=5, shade=0.28)
        out += shine(-18, y - 66, 8, 5, -30, 0.5)
        return out
    if kind == "loaf":
        d = "M-190,-8 C-190,-66 -130,-86 -60,-86 L60,-86 C130,-86 190,-66 190,-8 L190,88 L-190,88 Z"
        out = body(pth(d), sponge, depth=12, shade=0.25)
        out += body(rrect(-190, -92, 380, 50, 22), frosting, depth=6, shade=0.14)
        for k in range(8):
            x = -150 + k * 44
            out += body(rrect(x, -50, 30, 22 + (k * 13) % 34, 14), frosting, depth=3, shade=0.14)
        for k, x in enumerate((-80, 70)):
            out += body(ell(x, -100, 40, 14), "#F0D04A", depth=4, shade=0.22) + ell(x, -100, 26, 7)('fill="#FBEA8C"')
        out += shine(-130, -70, 40, 7, -4, 0.45)
        return out
    # whole round cake on a stand
    out = body(rrect(-26, 112, 52, 58, 6), "#E9E2D2", depth=6, shade=0.2)
    out += body(ell(0, 176, 120, 22), "#E9E2D2", depth=6, shade=0.2)
    out += body(ell(0, 108, 214, 34), "#F4EFE4", depth=6, shade=0.16)
    out += body(pth("M-176,-40 L-176,96 C-176,116 176,116 176,96 L176,-40 Z"), sponge, depth=14, shade=0.22)
    out += body(rrect(-176, 32, 352, 18, 0), frosting, depth=3, shade=0.14)
    out += body(ell(0, -40, 176, 56), frosting, depth=8, shade=0.14)
    drips = "M-176,-40 L-176,-6 "
    for k in range(8):
        x = -176 + k * 44
        drips += f"Q{x + 22},{10 + (k * 17) % 36} {x + 44},-6 "
    out += pth(drips + "L176,-40 Z")(f'fill="{frosting}"')
    for k in range(34):
        a = k * 2.399963
        r = math.sqrt((k + 0.5) / 34)
        x, y = math.cos(a) * 130 * r, -42 + math.sin(a) * 36 * r
        col = ["#E56B8C", "#F0C040", "#6FBF9A", "#7FA6E0"][k % 4]
        out += f'<rect x="{x - 7:.1f}" y="{y - 2.2:.1f}" width="14" height="4.4" rx="2.2" transform="rotate({(k * 61) % 180} {x:.1f} {y:.1f})" fill="{col}"/>'
    out += shine(-110, -64, 54, 8, -8, 0.5)
    return place(out, 0, 0)


ARCHETYPES = {"loaf": loaf, "rolls": rolls, "pastry": pastry, "cake": cake}

_ = (line, poly)
