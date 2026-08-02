#!/usr/bin/env python3
"""Turn Kenneth's selfies into game-ready sprites.

No background removal available locally, so every sprite gets a circular
alpha mask instead. A round sprite reads cleanly on any game background and
hides the room behind him without needing a real cutout.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

DOWNLOADS = Path.home() / "Downloads"
OUT = Path.home() / "Downloads" / "kenneth-site" / "assets" / "faces"
OUT.mkdir(parents=True, exist_ok=True)

# 2048 tiles, lowest value to highest. Kenneth numbered these himself.
TILES = [
    (2, "FACE 1.JPG"),
    (4, "FACE 2.JPG"),
    (8, "FACE3.JPG"),
    (16, "Face4.JPG"),
    (32, "Face5.JPG"),
    (64, "Face6.JPG"),
    (128, "Face7.JPG"),
    (256, "Face8.JPG"),
    (512, "Face9.JPG"),
    (1024, "Face10.JPG"),
    (2048, "Face11.JPG"),
]

# Game sprites. Megamind's blue reads against orange YC logos; the Minion's
# yellow reads against a blue sky.
SPRITES = [
    ("snake-head", "face1.JPG"),   # Megamind
    ("flappy", "FACE 1.JPG"),      # Minion
    ("toad", "FACE 2.JPG"),
    ("regular", "Regularface.JPG"),
]

# Faces sit high in a 9:16 selfie — crop a square centred here, not at 50%.
FACE_CENTER_Y = 0.42


def square_crop(img: Image.Image) -> Image.Image:
    w, h = img.size
    side = min(w, h)
    cx = w // 2
    cy = int(h * FACE_CENTER_Y)
    # Clamp so the crop box never runs off the top or bottom edge.
    top = max(0, min(cy - side // 2, h - side))
    left = max(0, min(cx - side // 2, w - side))
    return img.crop((left, top, left + side, top + side))


def circular(img: Image.Image, size: int) -> Image.Image:
    """Square image -> round RGBA sprite with a feathered edge."""
    img = img.convert("RGB").resize((size, size), Image.LANCZOS)
    # Supersample the mask so the feathered edge stays smooth when it lands
    # on the sprite at 1x.
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def build(src_name: str, out_name: str, size: int) -> bool:
    src = DOWNLOADS / src_name
    if not src.exists():
        print(f"  MISSING {src_name}")
        return False
    with Image.open(src) as im:
        im = im.convert("RGB")
        sprite = circular(square_crop(im), size)
        sprite.save(OUT / out_name, "PNG", optimize=True)
    print(f"  {out_name:22s} <- {src_name}")
    return True


def main():
    ok = True
    print("2048 tiles:")
    for value, src in TILES:
        ok &= build(src, f"tile-{value}.png", 256)

    print("game sprites:")
    for name, src in SPRITES:
        ok &= build(src, f"{name}.png", 256)

    # Contact sheet so the crops can be eyeballed in one look.
    sheet = Image.new("RGBA", (11 * 128, 128), (18, 18, 22, 255))
    for i, (value, _) in enumerate(TILES):
        with Image.open(OUT / f"tile-{value}.png") as t:
            sheet.paste(t.resize((128, 128), Image.LANCZOS), (i * 128, 0), t.resize((128, 128), Image.LANCZOS))
    sheet.save(OUT.parent / "contact-sheet.png")
    print(f"\ncontact sheet -> {OUT.parent / 'contact-sheet.png'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
