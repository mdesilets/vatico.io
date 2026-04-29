"""
DEPRECATED 2026-04-29 — DO NOT RUN.

This was an interim front-end patch written when the upstream Supabase
extraction was missing supply for 46 of 209 DMAs (Watertown NY surfaced
as the "#1 underserved market" with practice_supply = 0). It patched
dma-whitespace.json using location_counts from dma-leader.json as a
minimum-honest estimate.

The proper fix landed upstream on 2026-04-29:
  - 34,291 location rows received dma_code + dma_name in Supabase
    (with-dma_code coverage 18,301 -> 52,443)
  - scripts/asset_pack/extract_07_dma_whitespace.py (parent project)
    now emits the new schema with whitespace_eligible, coverage_band,
    data_completeness_score, and a backward-compat practice_supply_count
    alias of injectable_supply_count.
  - asset-pack/visuals/07-dma-whitespace/data/dma-whitespace.json is the
    canonical source; data/dma-whitespace.json is synced from it.
  - See docs/dma-whitespace-audit-2026-04.md (parent project) for the
    full coverage scorecard and methodology footnote.

This script's assumption — that dma-leader.json::location_count is a
reasonable proxy for Injectable supply — is no longer true. The new leader
file's location_count is total *active SoV participants* in the trailing
24-month window; the canonical Injectable supply count lives in
dma-whitespace.json::injectable_supply_count.

Kept in-tree for audit history. To re-derive whitespace data, re-run the
upstream extractor and re-sync via the asset-pack/ -> data/ workflow.

----------- ORIGINAL DOCSTRING (for the record) -----------

Patch data/dma-whitespace.json using location counts from data/dma-leader.json.
Idempotent — safe to re-run after an upstream re-export.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WS_PATH = ROOT / "data" / "dma-whitespace.json"
LD_PATH = ROOT / "data" / "dma-leader.json"
META_PATH = ROOT / "data" / "dma_meta.json"


def main() -> None:
    print(
        "DEPRECATED — see module docstring. The Apr 2026 upstream fix replaces "
        "this script. Refusing to write.",
        file=sys.stderr,
    )
    sys.exit(2)
    ws = json.loads(WS_PATH.read_text(encoding="utf-8"))
    ld = json.loads(LD_PATH.read_text(encoding="utf-8"))
    ld_by_code = {str(r["dma_code"]): r for r in ld}

    patched: list[tuple[str, int]] = []
    unfixable: list[str] = []

    for r in ws:
        if r.get("has_supply_data"):
            continue
        leader = ld_by_code.get(str(r["dma_code"]))
        loc = (leader or {}).get("location_count") or 0
        if loc > 0:
            r["practice_supply_count"] = int(loc)
            r["has_supply_data"] = True
            patched.append((r["dma_name"], int(loc)))
        else:
            unfixable.append(r["dma_name"])

    # Recompute z-scores using the original recipe:
    #   supply_z = (log10(1+supply) - mean) / pstdev   (over all 209, missing=0)
    #   demand_z = (demand - mean) / pstdev            (over all 209, missing=0)
    #   white_space_score = clip(demand_z - supply_z, -3, +3)
    sup_log = [math.log10(1 + (r.get("practice_supply_count") or 0)) for r in ws]
    dem = [(r.get("consumer_demand_proxy") or 0) for r in ws]
    mu_s, sd_s = statistics.mean(sup_log), statistics.pstdev(sup_log)
    mu_d, sd_d = statistics.mean(dem), statistics.pstdev(dem)

    for r in ws:
        s = r.get("practice_supply_count") or 0
        d = r.get("consumer_demand_proxy") or 0
        sz = (math.log10(1 + s) - mu_s) / sd_s
        dz = (d - mu_d) / sd_d
        r["supply_z"] = round(sz, 3)
        r["demand_z"] = round(dz, 3)
        r["white_space_score"] = round(max(-3.0, min(3.0, dz - sz)), 3)

    WS_PATH.write_text(
        json.dumps(ws, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Refresh the meta summary so dashboards/READMEs aren't out of date.
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta["with_supply_data"] = sum(1 for r in ws if r.get("has_supply_data"))
    ranked = sorted(
        [r for r in ws if r.get("has_demand_data")],
        key=lambda r: -r["white_space_score"],
    )
    meta["top_10_whitespace"] = [
        {
            "dma_code": r["dma_code"],
            "dma_name": r["dma_name"],
            "white_space_score": r["white_space_score"],
        }
        for r in ranked[:10]
    ]
    meta["bottom_10_whitespace"] = [
        {
            "dma_code": r["dma_code"],
            "dma_name": r["dma_name"],
            "white_space_score": r["white_space_score"],
        }
        for r in ranked[-10:]
    ]
    meta.setdefault("supply_patch", {})
    meta["supply_patch"] = {
        "applied": True,
        "source": "data/dma-leader.json::location_count",
        "rule": "patched only rows where has_supply_data was false AND leader.location_count > 0",
        "patched_count": len(patched),
        "still_missing_count": len(unfixable),
        "still_missing": sorted(unfixable),
        "note": "leader.location_count is total locations in the DMA, used as a minimum-honest proxy for Injectable supply when the upstream Injectable-filtered count was missing.",
    }
    META_PATH.write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Patched {len(patched)} DMAs.")
    print(f"Still missing supply (no leader entry): {len(unfixable)}")
    for name in sorted(unfixable):
        print(f"  - {name}")


if __name__ == "__main__":
    main()
