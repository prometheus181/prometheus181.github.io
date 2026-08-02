#!/usr/bin/env python3
"""Prepare the four lotus-pose photos as hero turntable frames.

These are phone screenshots: black letterbox bars top and bottom, and a
visible room behind the subject. With no background removal available, the
frames get a soft elliptical alpha feather so the room dissolves into the
page background instead of ending at a hard rectangle edge.

Order matters — index maps to a quarter turn in hero.js.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

DOWNLOADS = Path.home() / "Downloads"
OUT = Path.home() / "Downloads" / "kenneth-site" / "hero"
OUT.mkdir(parents=True, exist_ok=True)

# Orbit order: front -> right -> back -> left.
FRAMES = [
    ("Mesh front.PNG", "angle-0.png"),
    ("Mesh side1.PNG", "angle-1.png"),
    ("Mesh back.PNG", "angle-2.png"),
    ("Mesh side2.PNG", "angle-3.png"),
]

TARGET = 900
BLACK = 18  # per-channel ceiling for "this row is letterbox"


def trim_letterbox(img: Image.Image) -> Image.Image:
    """Drop near-black rows from the top and bottom."""
    g = img.convert("L")
    w, h = g.size
    px = g.load()
    # Sample across the row rather than every pixel — 24 probes is plenty.
    probes = range(0, w, max(1, w // 24))

    def dark(y):
        return all(px[x, y] <= BLACK for x in probes)

    top = 0
    while top < h - 1 and dark(top):
        top += 1
    bottom = h - 1
    while bottom > top and dark(bottom):
        bottom -= 1
    return img.crop((0, top, w, bottom + 1))


def crop_to_subject(img: Image.Image) -> Image.Image:
    """Crop to the band the seated figure occupies.

    He is centred and seated in all four shots, so a fixed box beats trying
    to detect him — and it keeps the four frames framed identically, which
    is what sells the rotation.
    """
    w, h = img.size
    left = int(w * 0.10)
    right = int(w * 0.90)
    top = int(h * 0.17)
    bottom = int(h * 0.74)
    return img.crop((left, top, right, bottom))


def feather(img: Image.Image, size: int) -> Image.Image:
    """Fit to a square canvas and fade the edges out to transparent."""
    img = img.convert("RGB")
    w, h = img.size
    scale = size / max(w, h)
    img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    canvas = Image.new("RGB", (size, size), (13, 13, 18))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))

    # Ellipse inset from the edges, then blurred hard for a long falloff.
    mask = Image.new("L", (size, size), 0)
    inset = int(size * 0.06)
    ImageDraw.Draw(mask).ellipse(
        (inset, inset, size - inset, size - inset), fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(size * 0.06))

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(canvas, (0, 0), mask)
    return out


def main():
    missing = 0
    for src_name, out_name in FRAMES:
        src = DOWNLOADS / src_name
        if not src.exists():
            print(f"  MISSING {src_name}")
            missing += 1
            continue
        with Image.open(src) as im:
            trimmed = crop_to_subject(trim_letterbox(im))
            feather(trimmed, TARGET).save(OUT / out_name, "PNG", optimize=True)
        print(f"  {out_name}  <- {src_name}  (-> {trimmed.size})")

    # Side-by-side sheet to eyeball all four angles at once.
    sheet = Image.new("RGBA", (4 * 260, 260), (13, 13, 18, 255))
    for i, (_, out_name) in enumerate(FRAMES):
        p = OUT / out_name
        if not p.exists():
            continue
        with Image.open(p) as f:
            thumb = f.resize((260, 260), Image.LANCZOS)
            sheet.paste(thumb, (i * 260, 0), thumb)
    sheet.save(OUT / "contact-sheet.png")
    print(f"\ncontact sheet -> {OUT / 'contact-sheet.png'}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
