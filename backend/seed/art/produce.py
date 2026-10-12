"""Fresh produce archetypes. Each function returns SVG for the standard art box (see core.UNIT_BASE)."""

from __future__ import annotations

import math

from .core import (
    CREAM,
    LEAF,
    UNIT_BASE,
    arrange,
    blob_path,
    body,
    circle,
    contact,
    darken,
    ell,
    leaf,
    leaf_poly,
    lighten,
    line,
    mix,
    n,
    place,
    poly,
    pth,
    rrect,
    shine,
    stroke_path,
    tone,
)

STEM = "#6A4526"
LEAF_GREEN = "#4F8A4B"


def fit(inner: str, top: float, bottom: float, target: float = 190.0) -> str:
    """Scale/shift unit art so it is `target` px tall and rests on UNIT_BASE."""
    s = target / (bottom - top)
    return place(inner, 0, UNIT_BASE - bottom * s, s)


def vary(color, i: int, amount: float = 0.02):
    """Tiny deterministic tone shift so repeated items are not clones."""
    return tone(color, (((i * 37) % 7) - 3) * amount)


# --------------------------------------------------------------------------- tree fruit
APPLE = (
    "M0,-70 C20,-96 80,-104 102,-58 C124,-10 106,54 72,90 C52,108 28,106 0,92 "
    "C-28,106 -52,108 -72,90 C-106,54 -124,-10 -102,-58 C-80,-104 -20,-96 0,-70 Z"
)
PEAR = (
    "M0,-112 C22,-112 30,-88 34,-66 C46,-30 98,-8 98,48 C98,96 54,114 0,114 "
    "C-54,114 -98,96 -98,48 C-98,-8 -46,-30 -34,-66 C-30,-88 -22,-112 0,-112 Z"
)


def _stem_leaf(top_y: float, leaf_on: bool, x: float = 0) -> str:
    out = line(x, top_y + 8, x + 8, top_y - 34, 10, STEM)
    if leaf_on:
        out += leaf(78, 44, LEAF_GREEN, rot=62, x=x + 8, y=top_y - 22, depth=6)
    return out


def fruit_unit(kind: str, c: str, blush: str | None, leaf_on: bool, i: int) -> str:
    c = vary(c, i)
    if kind == "apple":
        out = body(pth(APPLE), c, depth=16)
        if blush:
            cid = f"blush{i}{abs(hash(c)) % 997}"
            out += (
                f'<clipPath id="{cid}">{pth(APPLE)("")}</clipPath><g clip-path="url(#{cid})">'
                f'<ellipse cx="42" cy="6" rx="64" ry="104" fill="{blush}" opacity=".55"/></g>'
            )
        out += stroke_path("M-26,-70 C-6,-54 6,-54 26,-70", 7, darken(c, 0.4), 0.5)
        out += _stem_leaf(-70, leaf_on)
        out += shine(-52, -34, 17, 30, -28)
        return fit(out, -112, 104)
    if kind == "pear":
        out = body(pth(PEAR), c, depth=15)
        if blush:
            cid = f"pb{i}"
            out += (
                f'<clipPath id="{cid}">{pth(PEAR)("")}</clipPath><g clip-path="url(#{cid})">'
                f'<ellipse cx="50" cy="60" rx="60" ry="70" fill="{blush}" opacity=".4"/></g>'
            )
        out += circle(-24, 50, 3.2, darken(c, 0.35), 0.5) + circle(22, 78, 3.2, darken(c, 0.35), 0.5)
        out += circle(40, 36, 3.2, darken(c, 0.35), 0.5) + circle(-50, 82, 3, darken(c, 0.35), 0.5)
        out += stroke_path("M0,-108 C4,-130 16,-140 28,-144", 9, STEM)
        if leaf_on:
            out += leaf(70, 38, LEAF_GREEN, rot=70, x=14, y=-128, depth=6)
        out += shine(-54, 36, 15, 34, 12)
        return fit(out, -146, 116)
    if kind == "peach":
        out = body(ell(0, 4, 98, 96), c, depth=16)
        cid = f"pc{i}"
        out += (
            f'<clipPath id="{cid}">{ell(0, 4, 98, 96)("")}</clipPath><g clip-path="url(#{cid})">'
            f'<ellipse cx="46" cy="30" rx="70" ry="100" fill="{blush or "#E0663A"}" opacity=".5"/></g>'
        )
        out += stroke_path("M4,-88 C-30,-36 -30,36 6,98", 6, darken(c, 0.35), 0.45)
        out += _stem_leaf(-90, leaf_on, 0)
        out += shine(-52, -34, 16, 28, -30)
        return fit(out, -132, 100)
    if kind == "plum":
        out = body(ell(0, 6, 90, 96), c, depth=15)
        out += stroke_path("M2,-86 C-24,-34 -22,40 4,98", 5, darken(c, 0.4), 0.5)
        out += '<ellipse cx="-34" cy="-20" rx="32" ry="50" transform="rotate(-24 -34 -20)" fill="#fff" opacity=".16"/>'
        out += _stem_leaf(-88, leaf_on, 0)
        out += shine(-44, -40, 13, 22, -28, 0.4)
        return fit(out, -130, 102)
    if kind == "orange":
        out = body(ell(0, 0, 100, 96), c, depth=17)
        for k in range(34):
            a = k * 2.399963
            r = 0.18 + 0.78 * ((k * 0.618) % 1)
            out += circle(math.cos(a) * 88 * r, math.sin(a) * 84 * r, 2.6, darken(c, 0.4), 0.28)
        out += ell(2, -92, 14, 6)(f'fill="{LEAF}"')
        out += shine(-48, -42, 20, 30, -32, 0.4)
        return fit(out, -98, 98)
    if kind == "tomato":
        out = body(ell(0, 8, 106, 90), c, depth=16)
        out += stroke_path("M-40,-60 C-54,-10 -50,40 -34,80", 4, darken(c, 0.35), 0.3)
        out += stroke_path("M40,-60 C54,-10 50,40 34,80", 4, darken(c, 0.35), 0.3)
        star = [
            (0, -76),
            (14, -64),
            (36, -72),
            (26, -52),
            (46, -42),
            (20, -42),
            (0, -34),
            (-20, -42),
            (-46, -42),
            (-26, -52),
            (-36, -72),
            (-14, -64),
        ]
        out += body(poly(star), "#3F8A3F", depth=3)
        out += line(0, -74, 4, -96, 8, "#4B7F3A")
        out += shine(-52, -26, 17, 28, -32, 0.45)
        return fit(out, -98, 98)
    # plain round fruit
    out = body(ell(0, 0, 100, 98), c, depth=16)
    out += shine(-46, -40, 18, 28, -30)
    return fit(out, -98, 98)


def fruit(kind="apple", c="#B83A32", blush=None, n=3, leaf_on=True, **_) -> str:
    colours = c if isinstance(c, (list, tuple)) else [c]
    return arrange(n, lambda i: fruit_unit(kind, colours[i % len(colours)], blush, leaf_on, i))


# --------------------------------------------------------------------------- tomatoes on the vine
def tomato_vine(c="#C8402F", **kw) -> str:
    """Tomatoes resting on the ground with their vine draped behind them."""
    count = max(3, min(int(kw.get("n", 5)), 6))
    slots = sorted(LAYOUTS_VINE[count], key=lambda t: t[1])
    tops = []
    fruit_svg = ""
    for k, (x, ground, s_, r) in enumerate(slots):
        top = ground - 190 * s_
        tops.append((x, top + 14 * s_))
        fruit_svg += contact(x, ground, 88 * s_, 13 * s_, 0.22)
        fruit_svg += place(fruit_unit("tomato", vary(c, k, 0.03), None, False, k), x, ground - UNIT_BASE * s_, s_, r)
    pts = sorted(tops)
    path = f"M{n(pts[0][0] - 90)},{n(pts[0][1] + 24)}"
    prev = (pts[0][0] - 90, pts[0][1] + 24)
    for x, y in pts:
        path += f" Q{n((prev[0] + x) / 2)},{n(min(prev[1], y) - 40)} {n(x)},{n(y - 6)}"
        prev = (x, y - 6)
    path += f" Q{n(prev[0] + 60)},{n(prev[1] - 30)} {n(prev[0] + 110)},{n(prev[1] + 26)}"
    vine = stroke_path(path, 15, "#4F8A3C") + stroke_path(path, 6, "#86B85A", 0.8)
    vine += place(leaf(110, 62, "#4F8A4B", wave=0.1, k=3, rot=-58, depth=7), pts[0][0] - 70, pts[0][1] + 10)
    vine += place(leaf(110, 62, "#5A9A52", wave=0.1, k=3, rot=64, depth=7), pts[-1][0] + 90, pts[-1][1] + 10)
    return vine + fruit_svg


LAYOUTS_VINE = {
    3: [(-130, 252, 1.55, -5), (0, 200, 1.5, 3), (140, 254, 1.55, 6)],
    4: [(-190, 254, 1.4, -6), (-60, 214, 1.4, 3), (70, 256, 1.45, -3), (200, 236, 1.4, 6)],
    5: [(-210, 250, 1.3, -6), (-100, 214, 1.3, 3), (10, 258, 1.38, -2), (120, 214, 1.3, 5), (222, 246, 1.3, 7)],
    6: [
        (-230, 250, 1.2, -6),
        (-130, 212, 1.2, 3),
        (-20, 258, 1.3, -2),
        (90, 214, 1.2, 5),
        (190, 258, 1.24, 7),
        (270, 230, 1.1, 5),
    ],
}


# --------------------------------------------------------------------------- bananas
def banana_unit(c: str, tipc: str = "#5A4126") -> str:
    d = "M0,0 C70,66 240,74 336,-34 L322,-52 C240,40 90,26 14,-52 Z"
    out = body(pth(d), c, depth=11, shade=0.2)
    out += stroke_path("M22,-14 C100,52 236,54 318,-30", 4, darken(c, 0.35), 0.28)
    out += stroke_path("M18,-34 C80,10 210,20 300,-34", 5, "#fff", 0.28)
    out += ell(-4, -22, 16, 24, -10)(f'fill="{STEM}"')
    out += ell(329, -43, 9, 12, 40)(f'fill="{tipc}"')
    return out


def banana(c="#EBC84B", n=4, green=0.0, **_) -> str:
    n_ = max(2, min(int(n), 5))
    col = mix(c, "#8DB04A", green) if green else c
    out = ""
    angles = {2: [-9, 8], 3: [-14, 0, 14], 4: [-20, -7, 7, 20], 5: [-26, -13, 0, 13, 26]}[n_]
    for k, ang in enumerate(angles):
        out += place(banana_unit(tone(col, ((k * 3) % 4 - 1.5) * 0.02)), -170, -40 + k * 3, 1, ang - 6)
    crown = ell(-176, -30, 24, 30, 10)
    out += body(crown, "#7A5A2E", depth=5)
    return place(out, 0, 20, 1.18)


# --------------------------------------------------------------------------- citrus
def _segments(cx, cy, r, count, flesh, rind, pith):
    out = circle(cx, cy, r, rind)
    out += circle(cx, cy, r * 0.9, pith)
    out += circle(cx, cy, r * 0.8, flesh)
    for k in range(count):
        a = 2 * math.pi * k / count
        out += line(
            cx + math.cos(a) * r * 0.1,
            cy + math.sin(a) * r * 0.1,
            cx + math.cos(a) * r * 0.8,
            cy + math.sin(a) * r * 0.8,
            5,
            pith,
            op=0.95,
        )
    out += circle(cx, cy, r * 0.09, pith)
    for k in range(count):
        a = 2 * math.pi * (k + 0.5) / count
        out += circle(cx + math.cos(a) * r * 0.45, cy + math.sin(a) * r * 0.45, 3.2, lighten(flesh, 0.5), 0.5)
    return out


CITRUS_STYLE = {
    "orange": dict(rind="#EE8A22", flesh="#F6A53A", pith="#FBE3B0", segs=10, shape="round"),
    "lemon": dict(rind="#F0CE3A", flesh="#F7E27A", pith="#FCF4C8", segs=9, shape="lemon"),
    "lime": dict(rind="#6AA83A", flesh="#B8D96A", pith="#EAF3C5", segs=9, shape="lemon"),
    "mandarin": dict(rind="#F28C24", flesh="#F7A840", pith="#FCE3B4", segs=8, shape="flat"),
    "grapefruit": dict(rind="#EFB544", flesh="#F27A6A", pith="#FBE4D8", segs=11, shape="round"),
}
LEMON_PATH = "M-116,0 L-100,-12 C-86,-54 -44,-82 0,-82 C44,-82 86,-54 100,-12 L116,0 L100,12 C86,54 44,82 0,82 C-44,82 -86,54 -100,12 Z"


def citrus_whole(kind: str, i: int) -> str:
    st = CITRUS_STYLE[kind]
    c = vary(st["rind"], i, 0.025)
    if st["shape"] == "lemon":
        out = body(pth(LEMON_PATH), c, depth=14)
        for k in range(26):
            a = k * 2.399963
            r = 0.2 + 0.7 * ((k * 0.618) % 1)
            out += circle(math.cos(a) * 84 * r, math.sin(a) * 66 * r, 2.2, darken(c, 0.4), 0.25)
        out += shine(-44, -34, 18, 24, -26, 0.4)
        return place(out, 0, 0, 1, -18)
    ry = 78 if st["shape"] == "flat" else 96
    out = body(ell(0, 0, 100, ry), c, depth=16)
    for k in range(30):
        a = k * 2.399963
        r = 0.2 + 0.75 * ((k * 0.618) % 1)
        out += circle(math.cos(a) * 88 * r, math.sin(a) * ry * 0.9 * r, 2.4, darken(c, 0.4), 0.26)
    out += ell(0, -ry + 4, 12, 6)(f'fill="{LEAF}"')
    if kind == "mandarin":
        out += leaf(54, 30, LEAF_GREEN, rot=40, x=6, y=-ry + 2, depth=5)
    out += shine(-48, -40, 19, 28, -32, 0.4)
    return out


def citrus(kind="orange", n=2, cut=True, **_) -> str:
    st = CITRUS_STYLE[kind]
    out = ""
    whole = max(1, int(n))
    if cut:
        # cut half faces the viewer at right, whole fruit at left behind/beside it
        r = 112
        out += contact(120, 250, 130, 18)
        half = _segments(0, 0, r, st["segs"], st["flesh"], st["rind"], st["pith"])
        out += place(half + shine(-38, -44, 22, 12, -35, 0.35), 120, 140, 1.12)
        positions = [(-130, 165, 1.45), (-30, 70, 1.12)] if whole >= 2 else [(-110, 150, 1.5)]
        for k, (x, y, s) in enumerate(positions[:whole]):
            out += contact(x, y + 95 * s, 100 * s, 14 * s)
            out += place(citrus_whole(kind, k), x, y, s, -6 if k else 5)
        return place(out, 0, -14)
    return arrange(whole, lambda i: place(citrus_whole(kind, i), 0, 0, 0.98))


# --------------------------------------------------------------------------- berries
def punnet(w=300, h=130, c="#C9A877") -> str:
    d = f"M{-w / 2},0 L{w / 2},0 L{w / 2 - 22},{h} L{-w / 2 + 22},{h} Z"
    out = body(pth(d), c, depth=10, shade=0.2)
    for k in range(-3, 4):
        out += line(k * w / 8.4, 8, k * w / 8.4 * 0.9, h - 8, 5, darken(c, 0.3), op=0.35)
    out += line(-w / 2, 3, w / 2, 3, 7, lighten(c, 0.25))
    return out


def blueberry(c: str, i: int) -> str:
    out = body(circle_shape(0, 0, 44), c, depth=8, shade=0.3)
    star = [(0, -14), (4, -4), (14, -4), (6, 3), (9, 13), (0, 7), (-9, 13), (-6, 3), (-14, -4), (-4, -4)]
    out += place(poly(star)(f'fill="{darken(c, 0.5)}"'), 0, -4, 0.8)
    out += '<ellipse cx="-14" cy="-16" rx="9" ry="6" transform="rotate(-30 -14 -16)" fill="#fff" opacity=".32"/>'
    return out


def circle_shape(cx, cy, r):
    return lambda a="": f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" {a}/>'


def strawberry(c: str, i: int) -> str:
    d = "M0,-46 C34,-56 62,-34 58,-2 C54,36 22,66 0,82 C-22,66 -54,36 -58,-2 C-62,-34 -34,-56 0,-46 Z"
    out = body(pth(d), c, depth=10, shade=0.26)
    for row, y in enumerate(range(-22, 64, 21)):
        span = 40 - abs(y - 10) * 0.35 if y < 60 else 14
        for xi in range(-3, 4):
            x = xi * 17 + (8 if row % 2 else 0)
            if abs(x) < span:
                out += ell(x, y, 2.6, 4)('fill="#F5DC84" opacity=".92"')
    for k, ang in enumerate([-62, -28, 0, 28, 62]):
        out += place(leaf(30, 16, "#4C9446", vein=False, depth=3), 0, -42, 1, ang)
    out += line(0, -44, 2, -62, 6, "#4C9446")
    out += shine(-30, -18, 10, 16, -20, 0.38)
    return out


def raspberry(c: str, i: int) -> str:
    out = ""
    for k, (x, y) in enumerate(
        [(0, -30), (-26, -12), (26, -12), (-16, 14), (16, 14), (0, -6), (0, 32), (-34, 18), (34, 18)]
    ):
        out += body(circle_shape(x, y, 17), vary(c, k, 0.03), depth=4, shade=0.3)
        out += circle(x - 5, y - 6, 4, "#fff", 0.3)
    return out


def blackberry(c: str, i: int) -> str:
    return raspberry(c, i)


def grape_bunch(c: str) -> str:
    out = ""
    rows = [(0, 3), (46, 5), (92, 7), (138, 8)]
    for row, (y, cnt) in enumerate(rows):
        for k in range(cnt):
            x = (k - (cnt - 1) / 2) * 56 + ((row * 13) % 7 - 3)
            out += body(circle_shape(x, y, 33), vary(c, row * 5 + k, 0.025), depth=6, shade=0.3)
            out += circle(x - 10, y - 12, 7, "#fff", 0.34)
    out += stroke_path("M-6,-30 C-12,-70 -36,-92 -70,-96", 11, STEM)
    out += leaf(120, 80, "#5A9A4A", wave=0.1, k=2, rot=-30, x=-40, y=-80, depth=7)
    out += leaf(100, 70, "#4E8E42", wave=0.1, k=2, rot=40, x=14, y=-40, depth=7)
    return out


def cherry_pair(c: str) -> str:
    out = stroke_path("M-40,40 C-30,-30 6,-80 30,-96", 5, "#5C8E3E") + stroke_path(
        "M40,50 C34,-10 28,-60 30,-96", 5, "#5C8E3E"
    )
    out += body(circle_shape(-40, 70, 44), c, depth=8, shade=0.3) + body(
        circle_shape(44, 82, 44), c, depth=8, shade=0.3
    )
    out += circle(-54, 54, 9, "#fff", 0.32) + circle(30, 66, 9, "#fff", 0.32)
    return place(out, 0, -4)


def berries(kind="blueberry", c=None, n=1, punnet_on=True, **_) -> str:
    base = {
        "blueberry": "#3F4E8C",
        "strawberry": "#D2323A",
        "raspberry": "#C23A5A",
        "blackberry": "#3B2A4F",
        "grape": "#6B3F8C",
        "cherry": "#A4122A",
    }
    c = c or base[kind]
    if kind == "grape":
        return grape_bunch(c)
    if kind == "cherry":
        return place(cherry_pair(c), 0, 20, 2.0)
    unit = {"blueberry": blueberry, "strawberry": strawberry, "raspberry": raspberry, "blackberry": blackberry}[kind]
    out = ""
    heap = []
    if kind == "blueberry":
        for row, (y, cnt) in enumerate([(0, 3), (34, 5), (66, 7), (96, 8)]):
            for k in range(cnt):
                heap.append(((k - (cnt - 1) / 2) * 62 + ((row * 17) % 9 - 4), y - 70, 1.0 + ((k * 3 + row) % 3) * 0.04))
    elif kind == "strawberry":
        heap = [(-130, 36, 1.1), (130, 40, 1.08), (-62, -14, 1.14), (66, -8, 1.12), (0, 30, 1.2), (-4, -66, 1.0)]
    else:
        heap = [(-110, 28, 1.3), (100, 34, 1.3), (-20, -36, 1.34), (6, 42, 1.4), (-60, 90, 1.2), (82, 96, 1.2)]
    base_y = 62
    if punnet_on:
        out += place(punnet(), 0, base_y + 50, 1.0)
    for k, (x, y, s) in enumerate(sorted(heap, key=lambda t: t[1])):
        out += place(unit(vary(c, k, 0.02), k), x, y, s * 1.12, ((k * 29) % 23) - 11)
    if punnet_on:
        # front lip of the punnet over the berries
        front = rrect(-150, 0, 300, 90, 8)('fill="#C9A877"') + "".join(
            line(k * 36, 8, k * 33, 82, 5, "#9C7E4E", op=0.4) for k in range(-4, 5)
        )
        front += line(-150, 0, 150, 0, 8, "#E0C595")
        out += place(front, 0, base_y + 54, 1.0)
    return place(out, 0, 0, 1.45) if punnet_on else place(out, 0, 20, 1.5)


# --------------------------------------------------------------------------- leafy greens
def leaves(kind="romaine", c="#4E9A4B", c2=None, **_) -> str:
    out = ""
    if kind == "romaine":
        c2 = c2 or lighten(c, 0.38)
        spec = [(-52, 0.86, 0), (52, 0.86, 1), (-34, 0.94, 2), (34, 0.94, 3), (-16, 1.0, 4), (16, 1.0, 5), (0, 1.0, 6)]
        for ang, ln, k in spec:
            col = vary(c if abs(ang) > 20 else mix(c, c2, 0.5), k, 0.03)
            out += place(leaf(300 * ln, 168, col, wave=0.04, k=3, tip=1.35, depth=9), 0, 250, 1, ang)
        out += place(leaf(240, 130, c2, wave=0.04, k=3, tip=1.3, depth=7), 0, 250, 1, 0)
        out += (
            rrect(-46, 196, 92, 70, 26)('fill="#E4E2B6"')
            + line(-22, 206, -24, 256, 5, "#C4C08C", op=0.7)
            + line(22, 206, 24, 256, 5, "#C4C08C", op=0.7)
        )
        return out
    if kind == "spinach":
        for k, (x, ang, ln) in enumerate(
            [
                (-130, -52, 250),
                (130, 52, 250),
                (-70, -30, 290),
                (70, 30, 290),
                (0, 0, 300),
                (-30, -14, 270),
                (30, 14, 270),
            ]
        ):
            lc = vary(c, k, 0.03)
            out += place(
                stroke_path("M0,0 L0,-50", 9, "#9CC060") + place(leaf(ln - 40, 128, lc, tip=0.5, depth=7), 0, -42),
                x * 0.5,
                262,
                1.0,
                ang,
            )
        return place(out, 0, -12)
    if kind == "kale":
        for k, (ang, ln) in enumerate([(-50, 270), (-30, 310), (-10, 340), (10, 340), (30, 310), (50, 270)]):
            out += place(
                stroke_path("M0,0 L0,-120", 9, "#9CC060")
                + place(leaf(ln - 100, 150, vary(c, k, 0.03), wave=0.13, k=5, tip=0.6, depth=8), 0, -110),
                0,
                262,
                1.0,
                ang,
            )
        return place(out, 0, -12)
    # butterhead-style rosette
    for ring, (cnt, r, s) in enumerate([(9, 120, 1.0), (7, 78, 0.8), (5, 36, 0.6)]):
        for k in range(cnt):
            a = 360 * k / cnt + ring * 20
            out += place(
                leaf(150 * s, 120 * s, vary(tone(c, ring * 0.1), k, 0.03), wave=0.1, k=3, tip=0.6, depth=7), 0, 40, 1, a
            )
    return place(out, 0, 0, 1.35)


# --------------------------------------------------------------------------- herbs
def herbs(kind="basil", c="#3E8E41", **_) -> str:
    out = ""
    stems = [(-34, -16, 300), (-12, -6, 330), (14, 8, 330), (36, 18, 300), (0, 0, 280)]
    tie_y = 140
    # stems first
    for k, (x, ang, ln) in enumerate(stems):
        out += place(line(0, 0, 0, -ln, 7, "#7DA84E"), x * 0.55, 215, 1, ang)
    # leaves
    for k, (x, ang, ln) in enumerate(stems):
        group = ""
        if kind == "basil":
            for j, y in enumerate(range(-90, -ln + 40, -62)):
                group += place(leaf(104, 70, vary(c, k + j, 0.03), tip=0.6, depth=6), 0, y, 1, -52)
                group += place(leaf(104, 70, vary(c, k + j + 2, 0.03), tip=0.6, depth=6), 0, y, 1, 52)
            group += place(leaf(90, 58, vary(c, k, 0.03), tip=0.6, depth=6), 0, -ln + 10, 1, 0)
        elif kind == "parsley":
            for j, y in enumerate(range(-120, -ln + 20, -86)):
                for a in (-46, 0, 46):
                    group += place(leaf(92, 62, vary(c, k + j + a, 0.03), wave=0.18, k=3, tip=0.6, depth=5), 0, y, 1, a)
            for a in (-40, 0, 40):
                group += place(leaf(86, 58, vary(c, k + a, 0.03), wave=0.18, k=3, tip=0.6, depth=5), 0, -ln + 12, 1, a)
        elif kind == "cilantro":
            for j, y in enumerate(range(-120, -ln + 20, -86)):
                for a in (-52, 0, 52):
                    group += place(
                        leaf(80, 62, vary(c, k + j + a, 0.03), wave=0.2, k=4, tip=0.5, vein=False, depth=5), 0, y, 1, a
                    )
            for a in (-44, 0, 44):
                group += place(
                    leaf(78, 60, vary(c, k + a, 0.03), wave=0.2, k=4, tip=0.5, vein=False, depth=5), 0, -ln + 12, 1, a
                )
        else:  # rosemary / thyme: needle sprigs
            for j, y in enumerate(range(-60, -ln + 10, -20)):
                group += line(0, y, -34, y - 22, 6, vary(c, k + j, 0.03)) + line(
                    0, y, 34, y - 22, 6, vary(c, k + j + 1, 0.03)
                )
            group += line(0, -ln + 8, 0, -ln - 20, 6, c)
        out += place(group, x * 0.55, 215, 1, ang)
    # twine tie and cut ends
    out += (
        rrect(-46, 188, 92, 26, 12)('fill="#B58B52"')
        + line(-40, 196, 40, 196, 3, "#8F6A38", op=0.5)
        + line(-40, 206, 40, 206, 3, "#8F6A38", op=0.5)
    )
    out += place(stroke_path("M0,0 C-30,18 -40,40 -20,50", 5, "#B58B52"), 20, 206, 1)
    return place(out, 0, -8, 0.98)


# --------------------------------------------------------------------------- roots and bulbs
def carrot_unit(c: str, i: int) -> str:
    d = "M-34,-120 C-42,-50 -22,40 0,150 C22,40 42,-50 34,-120 C20,-134 -20,-134 -34,-120 Z"
    out = body(pth(d), c, depth=11, shade=0.2)
    for y in (-70, -20, 30, 80):
        out += line(-18 + y * -0.02, y, 18, y + 4, 4, darken(c, 0.35), 0.28)
    out += shine(-14, -80, 6, 30, 4, 0.34)
    tops = ""
    for a in (-24, 0, 24):
        tops += place(leaf(120, 36, "#4F8A4B", wave=0.2, k=3, tip=0.9, depth=4), 0, -122, 1, a)
    return tops + out


def beet_unit(c: str, i: int) -> str:
    out = body(ell(0, 18, 86, 80), c, depth=14, shade=0.3)
    out += line(0, 96, 4, 150, 8, darken(c, 0.15))
    for a in (-18, 0, 18):
        out += line(0, -56, a * 1.6, -120, 9, "#B8324A")
        out += place(leaf(88, 54, "#4B8A47", wave=0.1, k=3, tip=0.7, depth=5), a * 1.6, -118, 1, a * 1.2)
    out += stroke_path("M-40,-30 C-20,-50 20,-50 40,-30", 4, darken(c, 0.4), 0.4)
    out += shine(-40, -10, 14, 24, -20, 0.3)
    return out


def sweet_potato_unit(c: str, i: int) -> str:
    top, bottom = [], []
    for k in range(25):
        t = k / 24
        wdt = 70 * math.sin(math.pi * t) ** 0.75 + 4
        bend = -26 * math.sin(math.pi * t)
        x = -170 + 340 * t
        top.append((x, bend - wdt))
        bottom.append((x, bend + wdt))
    pts = top + bottom[::-1][1:-1]
    from .core import smooth_closed

    out = body(pth(smooth_closed(pts)), c, depth=13, shade=0.25)
    for k in range(14):
        t = 0.1 + 0.8 * ((k * 0.37) % 1)
        x = -170 + 340 * t
        out += ell(x, -26 * math.sin(math.pi * t) + (((k * 29) % 41) - 20) * 0.9, 6, 3, 10)(
            f'fill="{darken(c, 0.4)}" opacity=".35"'
        )
    out += stroke_path("M-120,-30 C-40,-62 60,-58 120,-34", 5, lighten(c, 0.3), 0.45)
    out += shine(-60, -52, 38, 8, -8, 0.3)
    return out


def radish_unit(c: str, i: int) -> str:
    out = body(ell(0, 14, 62, 62), c, depth=10, shade=0.25) + line(0, 70, 3, 112, 6, "#F4EEE6")
    for a in (-14, 0, 14):
        out += place(leaf(100, 46, "#4F8A4B", wave=0.1, k=3, depth=4), a * 0.8, -42, 1, a)
    out += shine(-24, -6, 10, 18, -20, 0.34)
    return out


def roots(kind="carrot", c=None, n=1, **_) -> str:
    c = (
        c
        or {
            "carrot": "#EE8B2B",
            "beet": "#8E2A57",
            "sweetpotato": "#B9684A",
            "radish": "#D8386B",
            "parsnip": "#EFD9A8",
        }[kind]
    )
    if kind in ("carrot", "parsnip"):
        cnt = max(3, int(n))
        out = ""
        pos = [(-200, -14), (-110, 6), (-20, -8), (70, 10), (160, -6), (240, 12)][:cnt]
        for k, (x, a) in enumerate(pos):
            out += place(
                carrot_unit(vary(c, k, 0.025), k),
                x - (cnt - 3) * 20,
                24 + (k % 2) * 6,
                0.98,
                14 + a * 0.6 - 4 * k + 10 * (k - cnt / 2) * 0.4,
            )
        return place(out, 0, 10)
    if kind == "sweetpotato":
        out = ""
        for k, (x, y, r, s) in enumerate([(30, -40, 6, 0.95), (-40, 60, -5, 1.0), (50, 150, 4, 1.05)]):
            out += place(sweet_potato_unit(vary(c, k, 0.03), k), x, y, s, r)
        return out
    unit = {"beet": beet_unit, "radish": radish_unit}[kind]
    return arrange(
        max(2, int(n)),
        lambda i: fit(unit(vary(c, i, 0.03), i), -170, 160)
        if kind == "beet"
        else fit(unit(vary(c, i, 0.03), i), -150, 120),
    )


def onion_unit(kind: str, c: str, i: int) -> str:
    if kind == "garlic":
        d = "M0,-108 C16,-84 24,-60 56,-40 C100,-14 108,40 76,80 C54,104 20,108 0,100 C-20,108 -54,104 -76,80 C-108,40 -100,-14 -56,-40 C-24,-60 -16,-84 0,-108 Z"
        out = body(pth(d), c, depth=13, shade=0.18)
        for x in (-48, -22, 4, 30, 56):
            out += stroke_path(
                f"M{x * 0.3:.0f},-60 C{x * 1.2:.0f},-10 {x * 1.25:.0f},50 {x * 0.7:.0f},96", 4, darken(c, 0.25), 0.4
            )
        out += (
            line(0, 100, -8, 118, 5, "#C9B28A")
            + line(8, 100, 12, 118, 5, "#C9B28A")
            + line(0, 100, 2, 120, 4, "#C9B28A")
        )
        out += shine(-42, -10, 10, 32, 20, 0.38)
        return fit(out, -108, 118)
    d = "M0,-112 C8,-96 14,-80 24,-70 C70,-50 100,-10 94,34 C88,80 50,100 0,100 C-50,100 -88,80 -94,34 C-100,-10 -70,-50 -24,-70 C-14,-80 -8,-96 0,-112 Z"
    out = body(pth(d), c, depth=15, shade=0.26)
    for x in (-52, -26, 0, 26, 52):
        out += stroke_path(
            f"M{x * 0.25:.0f},-72 C{x * 1.5:.0f},-20 {x * 1.4:.0f},50 {x * 0.5:.0f},98", 3.5, darken(c, 0.4), 0.3
        )
    out += stroke_path("M-6,-112 C-4,-126 4,-132 14,-136", 6, darken(c, 0.2))
    for k in (-14, -4, 6, 16):
        out += line(k, 100, k * 1.5, 120, 3, "#D9C8A3")
    out += shine(-44, -14, 14, 34, 18, 0.34)
    return fit(out, -136, 120)


def onion(kind="onion", c=None, n=3, **_) -> str:
    c = c or {"onion": "#D9A24C", "garlic": "#F1E8D6", "shallot": "#B8785A", "red": "#9C3F6B"}.get(kind, "#D9A24C")
    k = "garlic" if kind == "garlic" else "onion"
    return arrange(max(1, int(n)), lambda i: onion_unit(k, c, i))


def potato_unit(c: str, i: int) -> str:
    path = blob_path(112, 78, 0.07, seed=i + 2, k=3)
    out = body(pth(path), c, depth=14, shade=0.24)
    for k in range(7):
        a = k * 2.399963 + i
        r = 0.2 + 0.7 * ((k * 0.62) % 1)
        out += ell(math.cos(a) * 82 * r, math.sin(a) * 52 * r, 5, 3.2, k * 20)(f'fill="{darken(c, 0.4)}" opacity=".55"')
    for k in range(22):
        a = k * 2.399963
        r = 0.2 + 0.78 * ((k * 0.382) % 1)
        out += circle(math.cos(a) * 96 * r, math.sin(a) * 62 * r, 1.8, darken(c, 0.3), 0.28)
    out += shine(-52, -30, 28, 9, -10, 0.3)
    return fit(out, -80, 80, 150)


def potato(c="#C9A06A", n=4, **_) -> str:
    return arrange(max(1, int(n)), lambda i: potato_unit(vary(c, i, 0.03), i))


# --------------------------------------------------------------------------- peppers, gourds, mushrooms
PEPPER = (
    "M-84,-54 C-108,-14 -108,52 -76,92 C-56,116 -22,106 0,96 C22,106 56,116 76,92 C108,52 108,-14 84,-54 "
    "C64,-78 30,-72 0,-66 C-30,-72 -64,-78 -84,-54 Z"
)


def pepper_unit(kind: str, c: str, i: int) -> str:
    c = vary(c, i, 0.02)
    if kind == "chilli":
        d = "M-40,-90 C-20,-100 20,-100 40,-90 C70,-40 60,60 -10,150 C-26,160 -34,150 -28,138 C10,60 -4,-20 -40,-90 Z"
        out = body(pth(d), c, depth=10, shade=0.25)
        out += body(ell(0, -96, 36, 16), "#3E8A3E", depth=3) + line(0, -104, 10, -140, 10, "#3E8A3E")
        out += shine(-12, -50, 6, 30, 8, 0.38)
        return fit(out, -142, 160)
    out = body(pth(PEPPER), c, depth=15, shade=0.25)
    out += stroke_path("M-30,-60 C-48,-10 -44,50 -22,98", 4, darken(c, 0.38), 0.3)
    out += stroke_path("M30,-60 C48,-10 44,50 22,98", 4, darken(c, 0.38), 0.3)
    out += body(ell(0, -68, 38, 14), "#4B8E3C", depth=4) + stroke_path("M0,-72 C-4,-90 6,-104 18,-110", 11, "#4B8E3C")
    out += shine(-60, -18, 12, 34, 12, 0.4)
    return fit(out, -112, 116)


def pepper(kind="bell", c="#C93A2E", n=3, **_) -> str:
    return arrange(
        max(1, int(n)), lambda i: pepper_unit(kind, c if not isinstance(c, (list, tuple)) else c[i % len(c)], i)
    )


def cucumber_unit(c: str, i: int, kind: str = "cucumber") -> str:
    d = "M-170,-30 C-170,-62 -120,-66 0,-66 C120,-66 170,-62 170,-30 L170,30 C170,62 120,66 0,66 C-120,66 -170,62 -170,30 Z"
    if kind == "zucchini":
        d = "M-180,-20 C-180,-52 -140,-62 -60,-62 L110,-66 C160,-66 188,-56 188,-30 L188,30 C188,56 160,66 110,66 L-60,64 C-140,64 -180,54 -180,20 Z"
    out = body(pth(d), c, depth=12, shade=0.25)
    pale = lighten(c, 0.35)
    for y in (-34, -10, 14, 38):
        out += stroke_path(
            f"M-160,{y} C-60,{y - 6} 60,{y - 6} 160,{y}", 4 if kind == "cucumber" else 3, pale, 0.5, "round"
        )
    if kind == "zucchini":
        for k in range(24):
            a = k * 2.399963
            out += circle(
                math.cos(a) * 130 * ((k * 0.7) % 1), math.sin(a) * 36 * ((k * 0.3) % 1), 2.2, lighten(c, 0.5), 0.55
            )
        out += body(rrect(-196, -22, 34, 44, 12), darken(c, 0.1), depth=5)
    else:
        out += body(rrect(-186, -20, 24, 40, 12), "#7FAE4B", depth=4)
    out += shine(-90, -46, 56, 7, -2, 0.34)
    return out


def eggplant_unit(c: str, i: int) -> str:
    d = "M-30,-74 C-34,-30 -80,-4 -86,48 C-90,100 -50,128 0,128 C50,128 90,100 86,48 C80,-4 34,-30 30,-74 C20,-88 -20,-88 -30,-74 Z"
    out = body(pth(d), c, depth=14, shade=0.3)
    out += body(ell(0, -78, 46, 20), "#3F8A3F", depth=4)
    for a, x in ((-30, -26), (0, 0), (30, 26)):
        out += place(leaf(36, 22, "#3F8A3F", vein=False, depth=2), x, -70, 1, a * 2.4)
    out += line(0, -86, 6, -120, 11, "#3F8A3F")
    out += shine(-46, 20, 12, 40, 10, 0.34)
    return fit(out, -122, 130)


def corn_unit(i: int) -> str:
    d = "M-44,-120 C-60,-20 -50,60 -26,120 C-10,134 10,134 26,120 C50,60 60,-20 44,-120 C22,-146 -22,-146 -44,-120 Z"
    out = body(pth(d), "#F0C93C", depth=12, shade=0.22)
    for y in range(-110, 120, 22):
        out += line(-40 + abs(y) * 0.05, y, 40 - abs(y) * 0.05, y, 2.6, darken("#F0C93C", 0.3), 0.35)
    for x in range(-36, 40, 18):
        out += line(x, -120, x * 0.8, 124, 2.6, darken("#F0C93C", 0.3), 0.3)
    out += place(leaf(190, 80, "#6DA24A", wave=0.04, tip=0.7, depth=6), -26, 130, 1, -16)
    out += place(leaf(190, 80, "#5F9340", wave=0.04, tip=0.7, depth=6), 26, 130, 1, 16)
    out += shine(-24, -70, 8, 40, 6, 0.38)
    return fit(out, -146, 134)


def gourd(kind="cucumber", c=None, n=2, **_) -> str:
    c = c or {"cucumber": "#3F7F3A", "zucchini": "#4A8A44", "eggplant": "#4B2A5E", "corn": "#F0C93C"}[kind]
    if kind in ("cucumber", "zucchini"):
        cnt = max(1, min(int(n), 3))
        out = ""
        slots = {1: [(0, 40, -5)], 2: [(-10, -40, -6), (20, 90, 4)], 3: [(-10, -90, -6), (15, -0, 3), (-10, 90, -2)]}[
            cnt
        ]
        for k, (x, y, r) in enumerate(slots):
            out += contact(x, y + 60, 190, 14) + place(cucumber_unit(vary(c, k, 0.03), k, kind), x, y, 1.18, r)
        if kind == "cucumber":  # a couple of slices in front
            for k, (x, y) in enumerate([(-160, 170), (-60, 196)]):
                out += place(
                    circle(0, 0, 44, "#C6DE8E")
                    + circle(0, 0, 38, "#E8F2C4")
                    + circle(0, 0, 22, "#DCEBA8")
                    + "".join(circle(math.cos(a) * 14, math.sin(a) * 14, 3, "#B7CF7A") for a in (0, 1.6, 3.2, 4.8)),
                    x,
                    y,
                    1.0,
                )
        return place(out, 0, 0)
    if kind == "eggplant":
        return arrange(max(1, int(n)), lambda i: eggplant_unit(vary(c, i, 0.03), i))
    return arrange(max(1, int(n)), lambda i: corn_unit(i))


def mushroom_unit(cap: str, stem: str, i: int) -> str:
    stem_path = "M-30,10 C-34,60 -36,90 -30,100 C-10,110 10,110 30,100 C36,90 34,60 30,10 Z"
    out = body(pth(stem_path), stem, depth=9, shade=0.22)
    cap_path = "M-104,22 C-110,-60 -50,-100 0,-100 C50,-100 110,-60 104,22 C60,34 -60,34 -104,22 Z"
    out += body(pth(cap_path), cap, depth=12, shade=0.25)
    out += stroke_path("M-96,24 C-40,40 40,40 96,24", 5, darken(stem, 0.25), 0.7)
    for k in range(9):
        a = k * 2.399963
        out += circle(
            math.cos(a) * 62 * ((k * 0.7) % 1), -36 + math.sin(a) * 34 * ((k * 0.5) % 1), 2.6, darken(cap, 0.3), 0.3
        )
    out += shine(-46, -62, 24, 10, -28, 0.36)
    return fit(out, -100, 112)


def mushroom(cap="#A47B56", stem="#EDE1CE", n=5, **_) -> str:
    return arrange(max(1, int(n)), lambda i: mushroom_unit(vary(cap, i, 0.03), stem, i))


# --------------------------------------------------------------------------- brassicas and avocado
def brassica(kind="broccoli", c="#3F8A3F", **_) -> str:
    out = ""
    if kind == "broccoli":
        stalk = "M-40,60 C-34,140 -56,200 -64,250 L64,250 C56,200 34,140 40,60 Z"
        out += body(pth(stalk), "#9CC46A", depth=10, shade=0.2)
        for ang, x in ((-30, -40), (0, 0), (30, 40)):
            out += place(line(0, 0, 0, -80, 22, "#8FB85E"), x, 80, 1, ang)
    else:
        out += place(leaf(250, 150, "#6BA450", wave=0.06, k=3, tip=0.6, depth=8), -40, 250, 1, -50)
        out += place(leaf(250, 150, "#5E9846", wave=0.06, k=3, tip=0.6, depth=8), 40, 250, 1, 50)
        out += body(ell(0, 110, 142, 110), "#E9E0C8", depth=0.1)  # base plate hidden behind head
    cols = [c, tone(c, -0.1), tone(c, 0.1)]
    pts = []
    for ring, (cnt, r, size) in enumerate([(1, 0, 52), (6, 58, 44), (11, 118, 40), (16, 170, 34)]):
        for k in range(cnt):
            a = 2 * math.pi * k / cnt + ring * 0.4
            x, y = math.cos(a) * r * 1.0, math.sin(a) * r * 0.78
            pts.append((y, x, y, size, ring + k))
    cy = -30
    for _, x, y, size, k in sorted(pts, key=lambda t: t[0]):
        col = cols[k % 3]
        out += body(
            lambda a, x=x, y=y, size=size: f'<circle cx="{n(x)}" cy="{n(cy + y)}" r="{n(size)}" {a}/>',
            col,
            depth=5,
            shade=0.25,
        )
        out += circle(x - size * 0.3, cy + y - size * 0.32, size * 0.18, "#fff", 0.24)
    if kind == "cauliflower":
        pass
    return place(out, 0, 0, 1.0)


def halved(kind="avocado", c="#2F4A2C", **_) -> str:
    # whole avocado at left, halved with stone at right
    d = "M0,-116 C34,-116 50,-76 60,-44 C86,-8 104,14 100,54 C96,100 56,122 0,122 C-56,122 -96,100 -100,54 C-104,14 -86,-8 -60,-44 C-50,-76 -34,-116 0,-116 Z"
    whole = body(pth(d), c, depth=14, shade=0.3)
    for k in range(18):
        a = k * 2.399963
        whole += circle(
            math.cos(a) * 66 * ((k * 0.7) % 1), 20 + math.sin(a) * 70 * ((k * 0.5) % 1), 2.4, lighten(c, 0.3), 0.3
        )
    whole += shine(-52, -4, 14, 40, 12, 0.3)
    half = body(pth(d), c, depth=1, shade=0.3)
    inner = "M0,-98 C28,-98 42,-66 50,-38 C74,-6 90,14 86,52 C82,90 48,106 0,106 C-48,106 -82,90 -86,52 C-90,14 -74,-6 -50,-38 C-42,-66 -28,-98 0,-98 Z"
    half += pth(inner)('fill="#CFE08A"') + pth(
        "M0,-80 C22,-80 34,-54 40,-30 C60,-2 74,16 70,50 C66,82 40,92 0,92 C-40,92 -66,82 -70,50 C-74,16 -60,-2 -40,-30 C-34,-54 -22,-80 0,-80 Z"
    )('fill="#E6EDA2"')
    half += body(circle_shape(0, 44, 46), "#8A5A36", depth=9, shade=0.3) + shine(-14, 28, 12, 8, -30, 0.4)
    out = contact(-150, 250, 120, 16) + place(whole, -150, 150, 1.3, -5)
    out += contact(130, 252, 140, 16) + place(half, 130, 142, 1.38, 6)
    return place(out, 0, -6)


ARCHETYPES = {
    "fruit": fruit,
    "tomato_vine": tomato_vine,
    "banana": banana,
    "citrus": citrus,
    "berries": berries,
    "leaves": leaves,
    "herbs": herbs,
    "roots": roots,
    "onion": onion,
    "potato": potato,
    "pepper": pepper,
    "gourd": gourd,
    "mushroom": mushroom,
    "brassica": brassica,
    "halved": halved,
}

# silence "unused import" for helpers re-exported to sibling modules
_ = (CREAM, LEAF, lighten, leaf_poly)
