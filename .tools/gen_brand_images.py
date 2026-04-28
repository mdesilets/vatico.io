"""Generate brand images (og:image, apple-touch-icon, manifest icons).

Run from repo root:
    python .tools/gen_brand_images.py

Outputs:
    assets/og-image.png            1200x630
    assets/apple-touch-icon.png    180x180
    assets/icon-192.png            192x192
    assets/icon-512.png            512x512

This script is deliberately self-contained and uses only Pillow so it
runs anywhere Python is installed. The output is committed; nobody else
needs to run this unless the brand needs a refresh.
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FONT_PATH = ROOT / "fonts" / "InterVariable.ttf"

BG = (8, 9, 13, 255)            # --bg
INK = (228, 232, 244, 255)      # --text
MUTED = (136, 146, 176, 255)    # --muted-2
RULE = (37, 43, 59, 255)        # --border-2

# Brand gradient colors for the accent rule (matches --grad-hero).
GRAD_LEFT = (16, 185, 129)
GRAD_MID = (59, 130, 246)
GRAD_RIGHT = (168, 85, 247)


def load_font(size: int, weight: int = 700) -> ImageFont.FreeTypeFont:
    """Load InterVariable at a given size and weight.

    Pillow 10+ supports variable-axis selection via `set_variation_by_axes`.
    Older Pillow falls back to the default weight (which still renders).
    """
    f = ImageFont.truetype(str(FONT_PATH), size=size)
    try:
        f.set_variation_by_axes([float(weight)])
    except (AttributeError, OSError):
        pass
    return f


def radial_glow(size: tuple[int, int], color: tuple[int, int, int],
                center: tuple[float, float], radius: float, alpha: int = 40) -> Image.Image:
    """A soft radial glow rendered into a transparent layer."""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    cx = int(center[0] * w)
    cy = int(center[1] * h)
    r = int(radius * max(w, h))
    draw = ImageDraw.Draw(layer)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*color, alpha))
    return layer.filter(ImageFilter.GaussianBlur(radius=r * 0.55))


def gradient_rule(size: tuple[int, int], height: int = 4) -> Image.Image:
    """Horizontal gradient rule: green -> blue -> purple."""
    w, _ = size
    rule = Image.new("RGBA", (w, height), (0, 0, 0, 0))
    px = rule.load()
    for x in range(w):
        t = x / max(1, w - 1)
        if t < 0.5:
            k = t / 0.5
            r = int(GRAD_LEFT[0] + (GRAD_MID[0] - GRAD_LEFT[0]) * k)
            g = int(GRAD_LEFT[1] + (GRAD_MID[1] - GRAD_LEFT[1]) * k)
            b = int(GRAD_LEFT[2] + (GRAD_MID[2] - GRAD_LEFT[2]) * k)
        else:
            k = (t - 0.5) / 0.5
            r = int(GRAD_MID[0] + (GRAD_RIGHT[0] - GRAD_MID[0]) * k)
            g = int(GRAD_MID[1] + (GRAD_RIGHT[1] - GRAD_MID[1]) * k)
            b = int(GRAD_MID[2] + (GRAD_RIGHT[2] - GRAD_MID[2]) * k)
        for y in range(height):
            px[x, y] = (r, g, b, 255)
    return rule


def make_og_image() -> None:
    """OpenGraph image, 1200x630."""
    W, H = 1200, 630
    img = Image.new("RGBA", (W, H), BG)
    img = Image.alpha_composite(img, radial_glow((W, H), GRAD_MID, (0.18, 0.32), 0.55, 35))
    img = Image.alpha_composite(img, radial_glow((W, H), GRAD_RIGHT, (0.85, 0.78), 0.45, 28))
    draw = ImageDraw.Draw(img)

    eyebrow_font = load_font(20, weight=600)
    wordmark_font = load_font(220, weight=900)
    tag_font = load_font(40, weight=600)
    foot_font = load_font(18, weight=500)

    pad = 64

    eyebrow = "00  /  THE AESTHETICS INDEX"
    draw.text((pad, pad), eyebrow, font=eyebrow_font, fill=MUTED, spacing=4)

    wordmark = "vatico"
    bbox = draw.textbbox((0, 0), wordmark, font=wordmark_font)
    wm_w = bbox[2] - bbox[0]
    wm_h = bbox[3] - bbox[1]
    wm_y = (H - wm_h) // 2 - 30
    draw.text(((W - wm_w) // 2 - bbox[0], wm_y - bbox[1]), wordmark,
              font=wordmark_font, fill=INK)

    rule = gradient_rule((W, H), height=4)
    rule_w = 240
    rule_x = (W - rule_w) // 2
    rule_y = wm_y + wm_h + 36
    img.paste(rule.resize((rule_w, 4)), (rule_x, rule_y), rule.resize((rule_w, 4)))

    tagline = "Market intelligence layer for medical aesthetics."
    tb = draw.textbbox((0, 0), tagline, font=tag_font)
    tw = tb[2] - tb[0]
    draw.text(((W - tw) // 2 - tb[0], rule_y + 36 - tb[1]), tagline,
              font=tag_font, fill=INK)

    foot = "vatico.io"
    fb = draw.textbbox((0, 0), foot, font=foot_font)
    fw = fb[2] - fb[0]
    draw.text((W - pad - fw - fb[0], H - pad - (fb[3] - fb[1]) - fb[1]),
              foot, font=foot_font, fill=MUTED)
    draw.text((pad, H - pad - (fb[3] - fb[1]) - fb[1]),
              "MEDICAL AESTHETICS, ON THE RECORD",
              font=foot_font, fill=MUTED)

    out = ASSETS / "og-image.png"
    img.convert("RGB").save(out, "PNG", optimize=True)
    print(f"  {out.relative_to(ROOT)}: {out.stat().st_size:,} bytes")


def make_icon(size: int, filename: str, mark_size_ratio: float = 0.62) -> None:
    """Square icon at `size`px. Centered 'V' on dark bg with a subtle ring."""
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)

    # Soft accent glow under the mark.
    glow = radial_glow((size, size), GRAD_MID, (0.5, 0.55), 0.55, 80)
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    mark_size = int(size * mark_size_ratio)
    font = load_font(mark_size, weight=900)
    bbox = draw.textbbox((0, 0), "v", font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) // 2 - bbox[0]
    # Optical center (the V looks bottom-heavy if we use geometric center).
    y = (size - h) // 2 - bbox[1] - int(size * 0.04)
    draw.text((x, y), "v", font=font, fill=INK)

    out = ASSETS / filename
    img.convert("RGB").save(out, "PNG", optimize=True)
    print(f"  {out.relative_to(ROOT)}: {out.stat().st_size:,} bytes")


if __name__ == "__main__":
    if not FONT_PATH.exists():
        raise SystemExit(f"font not found: {FONT_PATH}")
    if not ASSETS.exists():
        ASSETS.mkdir()
    print("Generating brand images...")
    make_og_image()
    make_icon(180, "apple-touch-icon.png")
    make_icon(192, "icon-192.png")
    make_icon(512, "icon-512.png")
    print("Done.")
