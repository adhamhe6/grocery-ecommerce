"""Pillow-only compositing: category/department tiles, banners and labelled contact sheets from product cut-outs."""

from __future__ import annotations

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

# soft tints per department (muted, harmonious with the paper background)
DEPT_TINT = {
    "fresh-produce": ("#E4EEDB", "#C9DDBB"),
    "pantry": ("#F4E6C6", "#E6CE9C"),
    "chilled-dairy": ("#E2EBF3", "#C4D6E8"),
    "bakery": ("#F5E0C8", "#E8C39A"),
    "meat-fish-frozen": ("#E9E4F0", "#D2CADF"),
    "drinks-snacks": ("#F6E2CF", "#EBC4A1"),
    "specialty-home": ("#E7EBDD", "#CFD8BE"),
}


def _rgb(color: str):
    color = color.lstrip("#")
    return tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))


def gradient(size, top: str, bottom: str) -> Image.Image:
    w, h = size
    ramp = Image.linear_gradient("L").resize((w, h))
    return ImageOps.colorize(ramp, _rgb(top), _rgb(bottom)).convert("RGB")


def _shadow(canvas: Image.Image, cx: float, ground: float, width: float, opacity: float = 0.26) -> None:
    layer = Image.new("L", canvas.size, 0)
    d = ImageDraw.Draw(layer)
    rx, ry = width * 0.5, max(10, width * 0.055)
    d.ellipse((cx - rx, ground - ry + 6, cx + rx, ground + ry + 6), fill=int(255 * opacity))
    layer = layer.filter(ImageFilter.GaussianBlur(max(8, width * 0.04)))
    dark = Image.new("RGB", canvas.size, (74, 54, 34))
    canvas.paste(dark, (0, 0), layer)


def paste_item(canvas: Image.Image, cut: Image.Image, cx: float, ground: float, max_w: float, max_h: float) -> None:
    scale = min(max_w / cut.width, max_h / cut.height)
    w, h = max(1, round(cut.width * scale)), max(1, round(cut.height * scale))
    item = cut.resize((w, h), Image.LANCZOS)
    _shadow(canvas, cx, ground, w * 0.92)
    canvas.paste(item, (round(cx - w / 2), round(ground - h)), item)


TILE_LAYOUT = {
    1: [(450, 700, 620, 520)],
    2: [(290, 668, 430, 450), (620, 706, 450, 470)],
    3: [(290, 548, 380, 380), (615, 560, 380, 380), (452, 742, 470, 480)],
    4: [(270, 520, 340, 340), (632, 524, 340, 340), (296, 750, 390, 400), (610, 756, 390, 400)],
}


def tile(cutouts: list[Image.Image], dept: str, size: int = 900) -> Image.Image:
    top, bottom = DEPT_TINT.get(dept, ("#F6F0E4", "#E8DCC4"))
    canvas = gradient((size, size), top, bottom)
    # a big soft disc behind the arrangement
    disc = Image.new("L", (size, size), 0)
    ImageDraw.Draw(disc).ellipse((size * 0.08, size * 0.1, size * 0.92, size * 0.94), fill=120)
    disc = disc.filter(ImageFilter.GaussianBlur(40))
    canvas.paste(Image.new("RGB", (size, size), (255, 252, 244)), (0, 0), disc)
    slots = sorted(TILE_LAYOUT[min(len(cutouts), 4)], key=lambda s: s[1])
    for cut, (cx, ground, mw, mh) in zip(cutouts[: len(slots)], slots, strict=False):
        paste_item(canvas, cut, cx, ground, mw, mh)
    return canvas


BANNER_LAYOUT = [
    (1010, 540, 330, 330),
    (1290, 530, 340, 340),
    (1500, 560, 270, 290),
    (1000, 800, 400, 400),
    (1310, 820, 430, 430),
    (1530, 830, 250, 300),
]


def banner(cutouts: list[Image.Image], top: str, bottom: str, size=(1600, 900), mirror: bool = False) -> Image.Image:
    w, h = size
    canvas = gradient(size, top, bottom)
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse((w * 0.42, -h * 0.1, w * 1.05, h * 1.05), fill=130)
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    canvas.paste(Image.new("RGB", size, (255, 251, 240)), (0, 0), glow)
    slots = sorted(BANNER_LAYOUT[: len(cutouts)], key=lambda s: s[1])
    # larger items nearer the viewer: assign cut-outs by slot size so the first cut-out is the "hero" item
    order = sorted(range(len(cutouts)), key=lambda i: -BANNER_LAYOUT[i][2])
    by_slot = {slot: cutouts[i] for slot, i in zip(BANNER_LAYOUT[: len(cutouts)], order, strict=False)}
    for slot in slots:
        cx, ground, mw, mh = slot
        paste_item(canvas, by_slot[slot], cx, ground, mw, mh)
    return ImageOps.mirror(canvas) if mirror else canvas


def contact_sheet(images: list[tuple[str, Image.Image]], path: str, cols: int = 6, tile_px: int = 300) -> None:
    lab = 22
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_px, rows * (tile_px + lab)), "white")
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Medium.otf", 13)
    except OSError:
        font = ImageFont.load_default()
    for i, (label, im) in enumerate(images):
        x, y = (i % cols) * tile_px, (i // cols) * (tile_px + lab)
        thumb = ImageOps.contain(im.convert("RGB"), (tile_px, tile_px), Image.LANCZOS)
        sheet.paste(thumb, (x, y + lab))
        d.text((x + 6, y + 4), label, fill=(20, 20, 20), font=font)
    sheet.save(path)


_ = ImageChops
