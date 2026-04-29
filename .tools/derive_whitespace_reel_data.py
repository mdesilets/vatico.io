"""
Derive the runtime data bundle for the "Dataset Depth" reel.

The reel cycles through three zoom levels (country / NYC metro /
Manhattan), and at each zoom level it toggles through the six
verticals one at a time then shows them all together. Cardinality
is the whole pitch: "look how deep this dataset goes."

Inputs (read-only):
  - asset-pack/visuals/01-hero-canvas/data/locations.anon.json
        ~52K {lat, lng, v} entries.
  - asset-pack/visuals/07-dma-whitespace/data/dma-boundaries.geojson
        Used only to pull the canonical NYC DMA (501) bbox.

Outputs (written to data/, atomic via tmp + rename):
  - data/locations.anon.json          full ~52K dot list (copied)
  - data/locations.anon.mobile.json   uniform-random ~20K subset
  - data/whitespace-reel.json         tiny runtime bundle (one file
                                       for desktop AND mobile — it's
                                       <2KB so no need to split)

Bundle shape:

    {
      "extracted_utc": "...",
      "dot_count": 52370,
      "verticals": [
        {
          "id": "injectable",
          "label": "Injectable",
          "color": "#3B82F6",
          "counts": {"country": 16963, "nyc": 1597, "manhattan": 276}
        },
        ...
      ],
      "zooms": [
        {"id": "country",   "name": "Nationwide",       "bbox_lnglat": [...]},
        {"id": "nyc",       "name": "New York Metro",   "bbox_lnglat": [...]},
        {"id": "manhattan", "name": "Manhattan",        "bbox_lnglat": [...]}
      ]
    }

Idempotent and deterministic (mobile sample uses a locked seed).
"""
from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

# Mirrors MedSpot-v2/scripts/backfill_dma.py — point-in-polygon
# against Nielsen DMA boundaries with a small coastal snap threshold.
# Anything that falls outside every DMA AND is more than ~7 mi from
# the nearest DMA edge is treated as a geocoding artifact (ocean,
# Caribbean drift, lat/lng swap, etc.) and dropped.
from shapely.geometry import Point, shape  # noqa: E402
from shapely.strtree import STRtree         # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

LOCATIONS_SRC  = ROOT / "asset-pack" / "visuals" / "01-hero-canvas"   / "data" / "locations.anon.json"
BOUNDARIES_SRC = ROOT / "asset-pack" / "visuals" / "07-dma-whitespace" / "data" / "dma-boundaries.geojson"

DATA_DIR = ROOT / "data"
LOCATIONS_OUT        = DATA_DIR / "locations.anon.json"
LOCATIONS_MOBILE_OUT = DATA_DIR / "locations.anon.mobile.json"
BUNDLE_OUT           = DATA_DIR / "whitespace-reel.json"

MOBILE_TARGET = 20_000
MOBILE_SEED   = 20260429

# Vertical metadata. Order is the toggle order. Colors and labels
# mirror the production Consumer Finder palette so this pitch tool
# reads as the same dataset the dashboard renders.
#   Production source: dashboard/lib/map-point-types.ts CATEGORY_COLORS_HEX
VERTICALS = [
    {"id": "injectable",      "label": "Injectable",       "color": "#3B82F6"},
    {"id": "laser",           "label": "Laser",            "color": "#EC4899"},
    {"id": "body_contouring", "label": "Body Contouring",  "color": "#F97316"},
    {"id": "skin_treatment",  "label": "Skin Treatment",   "color": "#10B981"},
    {"id": "wellness",        "label": "Wellness",         "color": "#A855F7"},
    {"id": "cosmetic",        "label": "Cosmetic",         "color": "#94A3B8"},
]

# Manhattan bbox: Battery to ~86th St, river to river. ~7.6 km wide.
MANHATTAN_BBOX = [-74.020, 40.700, -73.930, 40.830]

# Country bbox: covers CONUS + AK/HI/PR insets that the projection
# stuffs into the lower-left. The reel renders this at "wide pose"
# so the camera fits everything; the bbox is informational.
COUNTRY_BBOX = [-130.0, 17.0, -65.0, 50.0]


def write_atomic(path: Path, payload: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(path)


def bbox_of_geometry(geom: dict) -> list[float]:
    minx = miny = float("inf")
    maxx = maxy = float("-inf")

    def walk(coords):
        nonlocal minx, miny, maxx, maxy
        if isinstance(coords[0], (int, float)):
            x, y = coords[0], coords[1]
            if x < minx: minx = x
            if x > maxx: maxx = x
            if y < miny: miny = y
            if y > maxy: maxy = y
        else:
            for c in coords:
                walk(c)

    walk(geom["coordinates"])
    return [minx, miny, maxx, maxy]


def in_bbox(p: dict, b: list[float]) -> bool:
    return b[0] <= p["lng"] <= b[2] and b[1] <= p["lat"] <= b[3]


# ------------------------------------------------------------------
# DMA-based land filter (medspot-v2 parity)
# ------------------------------------------------------------------

# 0.1° ≈ 7 mi at this latitude. Allows truly coastal practices to
# survive (their geocode often lands in the harbor/sound) while
# still catching dots that have drifted into open water. Same value
# MedSpot-v2 uses (SNAP_THRESHOLD_DEG in backfill_dma.py).
SNAP_THRESHOLD_DEG = 0.1

# Hawaii / Alaska / PR have no Nielsen DMA polygons in the boundary
# file — accept a state-bbox fallback so we don't drop legitimate
# practices in those territories. Mirrors MedSpot-v2's
# FALLBACK_DMAS map.
TERRITORY_BBOXES = [
    # name, [w, s, e, n]
    ("Hawaii",       [-160.5,  18.5, -154.5,  22.5]),
    ("Alaska",       [-180.0,  51.0, -129.0,  72.0]),
    ("Puerto Rico",  [-67.5,   17.7,  -65.5,  18.6]),
    ("US Virgin Is", [-65.1,   17.6,  -64.5,  18.5]),
]


def _in_any_territory(lng: float, lat: float) -> bool:
    for _, (w, s, e, n) in TERRITORY_BBOXES:
        if w <= lng <= e and s <= lat <= n:
            return True
    return False


def filter_to_dma_land(locations: list[dict], boundaries: dict) -> tuple[list[dict], dict]:
    """Drop any location not inside (or near) a Nielsen DMA polygon.

    Returns (kept, stats) where stats counts kept/dropped per reason.
    """
    polys = [shape(f["geometry"]) for f in boundaries["features"]]
    tree = STRtree(polys)

    kept: list[dict] = []
    n_in_poly = n_snapped = n_territory = n_dropped = 0

    for p in locations:
        lng = p["lng"]; lat = p["lat"]
        pt = Point(lng, lat)

        # 1. Fast path — nearest polygon contains the point.
        idx = int(tree.nearest(pt))
        if polys[idx].contains(pt):
            kept.append(p); n_in_poly += 1
            continue

        # 2. Coastal snap — within ~7 mi of nearest DMA edge.
        if polys[idx].distance(pt) < SNAP_THRESHOLD_DEG:
            kept.append(p); n_snapped += 1
            continue

        # 3. Territory fallback (HI/AK/PR/VI have no DMA polygons).
        if _in_any_territory(lng, lat):
            kept.append(p); n_territory += 1
            continue

        # 4. Otherwise it's almost certainly a geocoding artifact —
        #    drop it. (Open ocean, lat/lng swap, etc.)
        n_dropped += 1

    stats = {
        "in_polygon":      n_in_poly,
        "coastal_snapped": n_snapped,
        "territory":       n_territory,
        "dropped":         n_dropped,
        "input_total":     len(locations),
        "kept_total":      len(kept),
    }
    return kept, stats


def main() -> None:
    if not LOCATIONS_SRC.exists():
        print(f"missing source: {LOCATIONS_SRC}", file=sys.stderr); sys.exit(1)
    if not BOUNDARIES_SRC.exists():
        print(f"missing source: {BOUNDARIES_SRC}", file=sys.stderr); sys.exit(1)

    print(f"reading {LOCATIONS_SRC.name} ...")
    locations_raw = json.loads(LOCATIONS_SRC.read_text(encoding="utf-8"))
    print(f"  {len(locations_raw):,} dots (raw)")

    print(f"reading {BOUNDARIES_SRC.name} ...")
    boundaries = json.loads(BOUNDARIES_SRC.read_text(encoding="utf-8"))
    nyc_feat = next((f for f in boundaries["features"] if f["properties"]["dma"] == 501), None)
    if nyc_feat is None:
        print("could not find NYC DMA (501) in boundaries", file=sys.stderr); sys.exit(2)
    nyc_bbox = bbox_of_geometry(nyc_feat["geometry"])
    print(f"  NYC DMA bbox: {nyc_bbox}")

    # Land filter (medspot-v2 parity) — drop dots that aren't in or
    # near a real DMA polygon. Cleans up offshore geocoding artifacts.
    print("filtering to DMA-land (medspot-v2 parity) ...")
    locations, land_stats = filter_to_dma_land(locations_raw, boundaries)
    print(
        f"  in_polygon={land_stats['in_polygon']:>6,}  "
        f"coastal_snap={land_stats['coastal_snapped']:>4,}  "
        f"territory={land_stats['territory']:>4,}  "
        f"DROPPED={land_stats['dropped']:>4,}"
    )
    if land_stats["dropped"] > 0:
        pct = land_stats["dropped"] / land_stats["input_total"] * 100
        print(f"  dropped {land_stats['dropped']:,} dots ({pct:.2f}%) outside any DMA polygon")

    zooms = [
        {"id": "country",   "name": "Nationwide",     "bbox_lnglat": COUNTRY_BBOX},
        {"id": "nyc",       "name": "New York Metro", "bbox_lnglat": nyc_bbox},
        {"id": "manhattan", "name": "Manhattan",      "bbox_lnglat": MANHATTAN_BBOX},
    ]

    # Vertical counts per (zoom, vertical). The "country" count is the
    # full national total — we don't filter against the country bbox
    # because the AK/HI/PR insets are valid and shouldn't be excluded.
    print("counting per (zoom, vertical) ...")
    verticals_out = []
    for v in VERTICALS:
        vid = v["id"]
        all_v_dots = [p for p in locations if p["v"] == vid]
        counts = {
            "country":   len(all_v_dots),
            "nyc":       sum(1 for p in all_v_dots if in_bbox(p, nyc_bbox)),
            "manhattan": sum(1 for p in all_v_dots if in_bbox(p, MANHATTAN_BBOX)),
        }
        verticals_out.append({**v, "counts": counts})
        print(f"  {v['label']:<18}  national={counts['country']:>6,}  nyc={counts['nyc']:>5,}  manhattan={counts['manhattan']:>4,}")

    # Mobile down-sample (uniform random, seeded).
    rng = random.Random(MOBILE_SEED)
    n_mobile = min(MOBILE_TARGET, len(locations))
    mobile_indices = sorted(rng.sample(range(len(locations)), n_mobile))
    mobile_locations = [locations[i] for i in mobile_indices]
    print(f"mobile sample: {len(mobile_locations):,} dots (seed={MOBILE_SEED})")

    extracted_utc = datetime.now(timezone.utc).isoformat()
    bundle = {
        "extracted_utc": extracted_utc,
        "dot_count": len(locations),
        "dot_count_mobile": len(mobile_locations),
        "locations_file":        "data/locations.anon.json",
        "locations_file_mobile": "data/locations.anon.mobile.json",
        "verticals": verticals_out,
        "zooms": zooms,
    }

    print("writing outputs ...")
    write_atomic(BUNDLE_OUT, json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
    print(f"  {BUNDLE_OUT.relative_to(ROOT)}        ({BUNDLE_OUT.stat().st_size} B)")

    write_atomic(LOCATIONS_OUT,        json.dumps(locations,        ensure_ascii=False) + "\n")
    write_atomic(LOCATIONS_MOBILE_OUT, json.dumps(mobile_locations, ensure_ascii=False) + "\n")
    print(f"  {LOCATIONS_OUT.relative_to(ROOT)}        ({LOCATIONS_OUT.stat().st_size // 1024} KB)")
    print(f"  {LOCATIONS_MOBILE_OUT.relative_to(ROOT)} ({LOCATIONS_MOBILE_OUT.stat().st_size // 1024} KB)")

    print("done.")


if __name__ == "__main__":
    main()
