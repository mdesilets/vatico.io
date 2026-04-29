"""
Render the static fallbacks for the "Dataset Depth" reel.

Produces two files (idempotent — re-run any time the data refreshes):

    og/whitespace-reel.png   1200x630, for OG/Twitter share cards.
                              Two-panel composition: country (left) and
                              Manhattan (right), both showing all six
                              verticals together, with title overlay.
                              Tells the breadth+depth story in one image.

    og/whitespace-reel.svg   crisp vector fallback for <noscript>.
                              Same composition, more readable in-page.

Inputs match the JS consumer:
  - data/whitespace-reel.json   small bundle with verticals + zooms
  - data/locations.anon.json    52K dot scatter

Pillow is the only required dep.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Pillow is required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT_DIR = ROOT / "og"
OUT_DIR.mkdir(parents=True, exist_ok=True)

OG_PATH  = OUT_DIR / "whitespace-reel.png"
SVG_PATH = OUT_DIR / "whitespace-reel.svg"

OG_W, OG_H = 1200, 630

DEG = math.pi / 180.0


# ---- Albers Equal-Area Conic projection ----------------------------------

def make_albers(p0_deg, p1_deg, ref_lat_deg, ref_lng_deg):
    phi0 = p0_deg * DEG
    phi1 = p1_deg * DEG
    ref_lat = ref_lat_deg * DEG
    ref_lng = ref_lng_deg * DEG
    n = 0.5 * (math.sin(phi0) + math.sin(phi1))
    C = math.cos(phi0) ** 2 + 2 * n * math.sin(phi0)
    rho0 = math.sqrt(C - 2 * n * math.sin(ref_lat)) / n

    def project(lng, lat):
        phi = lat * DEG
        lam = lng * DEG
        rho = math.sqrt(max(C - 2 * n * math.sin(phi), 1e-12)) / n
        theta = n * (lam - ref_lng)
        x = rho * math.sin(theta)
        # Negate so increasing latitude maps to decreasing screen y
        # (north = top). Without this Florida ends up at the top.
        y = rho * math.cos(theta) - rho0
        return (x, y)

    return project


CONUS = make_albers(29.5, 45.5, 23, -96)
AK    = make_albers(55, 65, 50, -154)
HI    = make_albers(8, 18, 3, -157)


def pr_project(lng, lat):
    return ((lng + 66) * math.cos(18 * DEG), -(lat - 18.2))


def region_of(lng, lat):
    if -67.5 < lng < -64 and 17 < lat < 19: return "PR"
    if lat > 50 and lng < -129: return "AK"
    if lng < -154 and lat < 23: return "HI"
    if -161 < lng < -154 and lat < 23: return "HI"
    return "CONUS"


def make_country_projection(panel_w, panel_h):
    """CONUS-only projection scaled to fill a panel. Drops the
    AK/HI/PR insets — for the OG card they read as noise at this
    output size."""
    min_x = math.inf; max_x = -math.inf
    min_y = math.inf; max_y = -math.inf
    for lng in range(-125, -65, 5):
        for lat in range(24, 51, 5):
            px, py = CONUS(lng, lat)
            if px < min_x: min_x = px
            if px > max_x: max_x = px
            if py < min_y: min_y = py
            if py > max_y: max_y = py
    conus_w = max_x - min_x
    conus_h = max_y - min_y
    margin = 0.06
    scale = min(
        (panel_w * (1 - margin * 2)) / conus_w,
        (panel_h * (1 - margin * 2 - 0.10)) / conus_h,   # leave room for title
    )
    tx = (panel_w - conus_w * scale) / 2 - min_x * scale
    ty = (panel_h - conus_h * scale) / 2 - min_y * scale + panel_h * 0.05
    def project(lng, lat):
        x, y = CONUS(lng, lat)
        return (tx + x * scale, ty + y * scale)
    return project


def make_bbox_projection(bbox, panel_w, panel_h, margin_top_px=0):
    """Linear lat/lng -> panel projection that fits the given bbox.
    Used for the Manhattan zoom panel — over a small bbox, plain
    cosine-corrected lng is indistinguishable from a real projection."""
    min_lng, min_lat, max_lng, max_lat = bbox
    cy = (min_lat + max_lat) / 2
    lng_per_unit = math.cos(cy * DEG)
    w_units = (max_lng - min_lng) * lng_per_unit
    h_units = (max_lat - min_lat)
    margin = 0.06
    avail_h = panel_h - margin_top_px
    scale = min(
        (panel_w * (1 - margin * 2)) / w_units,
        (avail_h * (1 - margin * 2)) / h_units,
    )
    tx = panel_w / 2
    ty = margin_top_px + avail_h / 2
    def project(lng, lat):
        x = (lng - (min_lng + max_lng) / 2) * lng_per_unit * scale
        y = -(lat - (min_lat + max_lat) / 2) * scale
        return (tx + x, ty + y)
    return project


# ---- Helpers -------------------------------------------------------------

def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def hex_to_rgb(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def load_font(size, italic=False):
    candidates = [
        ROOT / "fonts" / ("InterVariable-Italic.ttf" if italic else "InterVariable.ttf"),
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("/Library/Fonts/Helvetica.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for c in candidates:
        try:
            if Path(c).exists():
                return ImageFont.truetype(str(c), size)
        except Exception:
            continue
    return ImageFont.load_default()


def in_bbox(lng, lat, bbox):
    return bbox[0] <= lng <= bbox[2] and bbox[1] <= lat <= bbox[3]


# ---- PNG renderer --------------------------------------------------------

def render_png(out_path):
    bundle    = load_json(DATA / "whitespace-reel.json")
    locations = load_json(DATA / "locations.anon.json")

    img = Image.new("RGB", (OG_W, OG_H), (8, 9, 13))
    draw = ImageDraw.Draw(img, "RGBA")

    panel_w = OG_W // 2
    panel_h = OG_H

    # Subtle vertical divider so the two panels read as a comparison
    draw.line([(panel_w, 70), (panel_w, OG_H - 70)],
              fill=(228, 232, 244, 30), width=1)

    verticals = bundle["verticals"]
    nyc_zoom = next((z for z in bundle["zooms"] if z["id"] == "nyc"), None)
    manhattan_zoom = next((z for z in bundle["zooms"] if z["id"] == "manhattan"), None)
    if not manhattan_zoom:
        print("missing manhattan zoom in bundle", file=sys.stderr); sys.exit(2)

    # ---- LEFT panel: country, all six verticals ----
    proj_country = make_country_projection(panel_w, panel_h)
    for p in locations:
        v = p.get("v")
        color = next((vv["color"] for vv in verticals if vv["id"] == v), None)
        if not color:
            continue
        if region_of(p["lng"], p["lat"]) != "CONUS":
            continue
        x, y = proj_country(p["lng"], p["lat"])
        if not (0 <= x <= panel_w and 0 <= y <= panel_h):
            continue
        r, g, b = hex_to_rgb(color)
        draw.point((x, y), fill=(r, g, b, 130))

    # ---- RIGHT panel: Manhattan zoom, all six verticals ----
    bbox = manhattan_zoom["bbox_lnglat"]
    proj_man = make_bbox_projection(bbox, panel_w, panel_h, margin_top_px=70)
    for p in locations:
        if not in_bbox(p["lng"], p["lat"], bbox):
            continue
        v = p.get("v")
        color = next((vv["color"] for vv in verticals if vv["id"] == v), None)
        if not color:
            continue
        x, y = proj_man(p["lng"], p["lat"])
        # Slight glow effect for the Manhattan panel since dots are sparser.
        r, g, b = hex_to_rgb(color)
        draw.ellipse((panel_w + x - 2, y - 2, panel_w + x + 2, y + 2), fill=(r, g, b, 220))

    # ---- Headers ----
    title_font = load_font(34)
    sub_font   = load_font(15)
    num_font   = load_font(38)
    label_font = load_font(13)

    # Left header
    draw.text((36, 28), "Nationwide", fill=(228, 232, 244, 255), font=title_font)
    country_total = sum(v["counts"]["country"] for v in verticals)
    draw.text((36, 70), f"{country_total:,} indexed practices", fill=(136, 146, 176, 230), font=sub_font)

    # Right header
    draw.text((panel_w + 36, 28), "Manhattan", fill=(228, 232, 244, 255), font=title_font)
    man_total = sum(v["counts"]["manhattan"] for v in verticals)
    draw.text((panel_w + 36, 70), f"{man_total:,} indexed practices in a 7 km box",
              fill=(136, 146, 176, 230), font=sub_font)

    # Bridge line at top center: "52,000 practices · six verticals · nationwide → block"
    bridge = "Six verticals · 52,370 practices · nationwide ↘ a single Manhattan block"
    bridge_w = draw.textlength(bridge, font=label_font)
    draw.text(((OG_W - bridge_w) / 2, OG_H - 90),
              bridge.upper(),
              fill=(113, 121, 168, 255),
              font=label_font)

    # Vertical legend at bottom
    legend_w_total = 0
    items = [(v["label"].upper(), v["color"]) for v in verticals]
    chip_h = 12
    chip_pad = 6
    legend_chip_font = load_font(11)
    item_widths = []
    for label, color in items:
        w = chip_h + chip_pad + draw.textlength(label, font=legend_chip_font)
        item_widths.append(w)
        legend_w_total += w
    legend_gap = 28
    legend_w_total += legend_gap * (len(items) - 1)
    lx = (OG_W - legend_w_total) / 2
    ly = OG_H - 50
    for (label, color), w in zip(items, item_widths):
        r, g, b = hex_to_rgb(color)
        draw.ellipse((lx, ly, lx + chip_h, ly + chip_h), fill=(r, g, b, 240))
        draw.text((lx + chip_h + chip_pad, ly + chip_h / 2), label,
                  fill=(170, 178, 207, 240), font=legend_chip_font, anchor="lm")
        lx += w + legend_gap

    # Vatico watermark top-right of the entire image (overlap with right header is OK — it's small)
    draw.text((OG_W - 36, OG_H - 18), "VATICO — THE AESTHETICS INDEX",
              fill=(90, 97, 128, 230), font=load_font(11), anchor="rb")

    img.save(out_path, "PNG", optimize=True)
    print(f"  wrote {out_path.relative_to(ROOT)} ({out_path.stat().st_size // 1024} KB)")


# ---- SVG renderer (noscript fallback) -----------------------------------

def render_svg(out_path):
    bundle    = load_json(DATA / "whitespace-reel.json")
    locations = load_json(DATA / "locations.anon.json")

    SVG_W, SVG_H = 1200, 630
    panel_w = SVG_W // 2

    proj_country = make_country_projection(panel_w, SVG_H)
    manhattan_zoom = next(z for z in bundle["zooms"] if z["id"] == "manhattan")
    bbox = manhattan_zoom["bbox_lnglat"]
    proj_man = make_bbox_projection(bbox, panel_w, SVG_H, margin_top_px=70)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SVG_W} {SVG_H}" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Vatico aesthetic-medicine dataset — six verticals from nationwide to a Manhattan block">',
        f'<rect width="{SVG_W}" height="{SVG_H}" fill="#08090d"/>',
        f'<line x1="{panel_w}" y1="70" x2="{panel_w}" y2="{SVG_H - 70}" stroke="#e4e8f4" stroke-opacity="0.12" stroke-width="1"/>',
    ]

    color_by_v = {v["id"]: v["color"] for v in bundle["verticals"]}

    # LEFT — country dots, down-sampled to keep the SVG under ~250KB.
    # Every 6th CONUS dot still reads as a country shape.
    parts.append('<g opacity="0.55">')
    written = 0
    for i, p in enumerate(locations):
        if i % 6 != 0:
            continue
        if region_of(p["lng"], p["lat"]) != "CONUS":
            continue
        color = color_by_v.get(p["v"])
        if not color:
            continue
        x, y = proj_country(p["lng"], p["lat"])
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="1.6" height="1.6" fill="{color}"/>')
        written += 1
    parts.append('</g>')
    print(f'  (svg country panel: {written:,} dots after down-sample)')

    # RIGHT — Manhattan dots (sparse, render as small circles)
    parts.append('<g>')
    for p in locations:
        if not in_bbox(p["lng"], p["lat"], bbox):
            continue
        color = color_by_v.get(p["v"])
        if not color:
            continue
        x, y = proj_man(p["lng"], p["lat"])
        parts.append(f'<circle cx="{panel_w + x:.1f}" cy="{y:.1f}" r="2.5" fill="{color}" fill-opacity="0.9"/>')
    parts.append('</g>')

    country_total = sum(v["counts"]["country"] for v in bundle["verticals"])
    man_total = sum(v["counts"]["manhattan"] for v in bundle["verticals"])

    parts.append('<g font-family="Inter, system-ui, sans-serif">')
    parts.append(f'<text x="36" y="50" font-size="32" font-weight="800" fill="#e4e8f4" letter-spacing="-0.02em">Nationwide</text>')
    parts.append(f'<text x="36" y="78" font-size="14" fill="#8892b0">{country_total:,} indexed practices</text>')
    parts.append(f'<text x="{panel_w + 36}" y="50" font-size="32" font-weight="800" fill="#e4e8f4" letter-spacing="-0.02em">Manhattan</text>')
    parts.append(f'<text x="{panel_w + 36}" y="78" font-size="14" fill="#8892b0">{man_total:,} practices in a 7 km box</text>')

    bridge = "SIX VERTICALS · 52,370 PRACTICES · NATIONWIDE \u2198 A SINGLE MANHATTAN BLOCK"
    parts.append(f'<text x="{SVG_W//2}" y="{SVG_H - 78}" font-size="11" font-weight="700" letter-spacing="0.18em" text-anchor="middle" fill="#7179a8">{bridge}</text>')

    # Legend
    items = [(v["label"].upper(), v["color"]) for v in bundle["verticals"]]
    spacing = 150
    total_w = spacing * (len(items) - 1)
    start_x = (SVG_W - total_w) / 2
    for i, (label, color) in enumerate(items):
        x = start_x + i * spacing
        parts.append(f'<circle cx="{x - 8}" cy="{SVG_H - 38}" r="5" fill="{color}"/>')
        parts.append(f'<text x="{x}" y="{SVG_H - 35}" font-size="10" font-weight="700" letter-spacing="0.08em" fill="#aab2cf">{label}</text>')

    parts.append(f'<text x="{SVG_W - 36}" y="{SVG_H - 14}" font-size="10" font-weight="700" letter-spacing="0.18em" text-anchor="end" fill="#5a6180">VATICO \u2014 THE AESTHETICS INDEX</text>')
    parts.append('</g>')

    parts.append('</svg>')
    out_path.write_text("\n".join(parts), encoding="utf-8")
    print(f"  wrote {out_path.relative_to(ROOT)} ({out_path.stat().st_size // 1024} KB)")


def main():
    print("rendering static fallbacks ...")
    render_svg(SVG_PATH)
    render_png(OG_PATH)
    print("done.")


if __name__ == "__main__":
    main()
