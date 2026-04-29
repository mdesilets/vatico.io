#!/usr/bin/env python3
"""
derive_reel_json.py — generate the curated mobile-reel dataset.

Reads data/ontology.json (the full tree the desktop force graph
consumes) and writes data/ontology.reel.json — a slim derived file
the mobile cinematic reel fetches.

Why a separate file:
  - Mobile must NEVER fetch the full ontology.json. That's the IP
    posture: the curated subset is the only thing exposed via the
    mobile network path.
  - Product names are stripped entirely. Products show up in the
    reel only as particle counts; their names never leave the
    server-side full tree.
  - Manufacturers and brands are top-N curated, not exhaustive.
    ~30 mfr names + ~90 brand names total vs 147 + 273 in full.
  - The "Independent / Unattributed" bucket is a source-extractor
    catch-all and reads as low-signal in a marketing reel; it's
    excluded from topMfrs but its brand/product counts still feed
    the totals so the headline stats are honest.

Idempotent: re-run any time ontology.json changes. Output is
deterministic for a given input (sorted, stable tie-breakers).

Usage:
    python .tools/derive_reel_json.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Defaults to the repo root regardless of where the script is
# invoked from. Resolve relative to the script's own location.
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "ontology.json"
DST = ROOT / "data" / "ontology.reel.json"

# Top-N curation knobs. If you change these, regen the file.
TOP_MFRS_PER_VERTICAL = 5
TOP_BRANDS_PER_MFR = 3
# Number of named products surfaced per top brand. Tiny by design:
# the deep-dive reel reveals 1-2 product names at the brand-zoom
# beat, all trademarked household names. Across 6 verticals × 1
# featured brand each, max ~12 product names ever leave the server.
TOP_PRODUCTS_PER_BRAND = 2

# Source extractor's catch-all label for brands without a real
# manufacturer_id. Excluded from topMfrs (low marketing signal)
# but its descendants still feed the totals so headline stats stay
# honest about what we track.
UNATTRIBUTED_PATTERNS = ("Independent / Unattributed",)


def _is_unattributed(label: str) -> bool:
    if not label:
        return False
    if label in UNATTRIBUTED_PATTERNS:
        return True
    return "unattributed" in label.lower()


def _count_descendants(node: dict, depth: int = 0) -> dict:
    """Count manufacturers / brands / products under a vertical.
    depth is the depth of *this* node where 0 = vertical."""
    counts = {"manufacturers": 0, "brands": 0, "products": 0}
    children = node.get("children") or []
    for child in children:
        ctype = child.get("type", "")
        if ctype == "manufacturer":
            counts["manufacturers"] += 1
        elif ctype == "brand":
            counts["brands"] += 1
        elif ctype == "product":
            counts["products"] += 1
        sub = _count_descendants(child, depth + 1)
        for k in counts:
            counts[k] += sub[k]
    return counts


def _curate_products(brand: dict) -> list[str]:
    """Pick the top N product names for a brand. Stable sort: by
    label so output is deterministic. Filtered to non-empty names."""
    products = brand.get("children") or []
    ranked = sorted(products, key=lambda p: (p.get("label") or "").lower())
    return [p.get("label", "") for p in ranked[:TOP_PRODUCTS_PER_BRAND] if p.get("label")]


def _curate_brands(mfr: dict) -> list[dict]:
    """Pick the top N brand objects for a manufacturer. Each entry
    carries label, productCount, and topProducts (1-2 named products).
    Sort key: descending product count, then ascending label."""
    brands = mfr.get("children") or []
    ranked = sorted(
        brands,
        key=lambda b: (-len(b.get("children") or []), (b.get("label") or "").lower()),
    )
    out = []
    for b in ranked[:TOP_BRANDS_PER_MFR]:
        label = b.get("label") or ""
        if not label:
            continue
        out.append({
            "label": label,
            "productCount": len(b.get("children") or []),
            "topProducts": _curate_products(b),
        })
    return out


def _curate_mfrs(vertical: dict) -> list[dict]:
    """Pick top-N named manufacturers for a vertical, with their
    top brands. Excludes the unattributed bucket."""
    mfrs = vertical.get("children") or []
    named = [m for m in mfrs if not _is_unattributed(m.get("label", ""))]
    ranked = sorted(
        named,
        key=lambda m: (
            -len(m.get("children") or []),
            (m.get("label") or "").lower(),
        ),
    )
    out = []
    for m in ranked[:TOP_MFRS_PER_VERTICAL]:
        label = m.get("label") or ""
        if not label:
            continue
        brand_count = len(m.get("children") or [])
        # Sum products under all of this mfr's brands so the reel can
        # render an honest "N products" count at the mfr-zoom beat.
        product_count = sum(
            len(b.get("children") or []) for b in (m.get("children") or [])
        )
        out.append({
            "label": label,
            "brandCount": brand_count,
            "productCount": product_count,
            "topBrands": _curate_brands(m),
        })
    return out


def derive(tree: dict) -> dict:
    verticals_in = tree.get("children") or []
    if len(verticals_in) != 6:
        # Not fatal — emit a warning so the operator notices upstream
        # data shape changes, but proceed.
        print(
            f"WARN: expected 6 verticals, found {len(verticals_in)}. "
            "Reel still generated; review the source.",
            file=sys.stderr,
        )

    verticals_out = []
    grand = {"manufacturers": 0, "brands": 0, "products": 0}

    for v in verticals_in:
        label = v.get("label") or ""
        color = v.get("color_hex") or "#5a6180"
        counts = _count_descendants(v)
        for k in grand:
            grand[k] += counts[k]
        verticals_out.append({
            "label": label,
            "color": color,
            "mfrCount": counts["manufacturers"],
            "brandCount": counts["brands"],
            "productCount": counts["products"],
            "topMfrs": _curate_mfrs(v),
        })

    return {
        "_license": {
            "owner": "Vatico, LLC",
            "copyright": "(c) 2026 Vatico, LLC. All rights reserved.",
            "notice": (
                "Proprietary research data. Not for redistribution, "
                "commercial use, scraping, or AI/ML training. "
                "Licensing inquiries: hello@vatico.io"
            ),
            "url": "https://vatico.io",
        },
        "_generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "_source": "data/ontology.json",
        "_curation": {
            "topMfrsPerVertical": TOP_MFRS_PER_VERTICAL,
            "topBrandsPerMfr": TOP_BRANDS_PER_MFR,
            "topProductsPerBrand": TOP_PRODUCTS_PER_BRAND,
            "excludesUnattributed": True,
            "productNamesIncluded": True,
            "productNamesNote": (
                "Up to TOP_PRODUCTS_PER_BRAND named products surface for "
                "the deepest zoom beat. Each loop highlights one brand, "
                "so total exposure across the cycle is small (~12 names) "
                "and limited to widely-published trademarked product names."
            ),
        },
        "totals": {
            "verticals": len(verticals_in),
            "manufacturers": grand["manufacturers"],
            "brands": grand["brands"],
            "products": grand["products"],
        },
        "verticals": verticals_out,
    }


def main() -> int:
    if not SRC.exists():
        print(f"ERROR: source not found: {SRC}", file=sys.stderr)
        return 1
    with SRC.open("r", encoding="utf-8") as f:
        tree = json.load(f)
    out = derive(tree)
    DST.parent.mkdir(parents=True, exist_ok=True)
    with DST.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    size_kb = DST.stat().st_size / 1024
    print(
        f"OK  wrote {DST.relative_to(ROOT)}  ({size_kb:.1f} KB, "
        f"{out['totals']['verticals']} verticals, "
        f"{out['totals']['manufacturers']} mfrs, "
        f"{out['totals']['brands']} brands, "
        f"{out['totals']['products']} products)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
