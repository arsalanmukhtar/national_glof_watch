#!/usr/bin/env python3
"""Split a single zonation GeoJSON into per-level files.

A zonation file ships every level (High / Medium / Low) as a single feature
in one FeatureCollection, distinguished by a property (default ``Zonation``).
Most regions in this project have already been split that way at source —
this is for the ones (e.g. brep) that ship combined.

Usage:
    python scripts/python/split_zonation.py data/geojsons/brep/brep_zonation.geojson
    python scripts/python/split_zonation.py <src> --prefix glof_brep --property Zonation

Default output filenames follow the project convention used by other regions:
    glof_<region>_high.geojson
    glof_<region>_medium.geojson
    glof_<region>_low.geojson

The region name is inferred from the source filename (strips ``_zonation``
and any leading ``glof_`` prefix); override with ``--prefix``.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LEVELS = ("high", "medium", "low")


def infer_prefix(src: Path) -> str:
    stem = src.stem.lower()
    for tail in ("_zonation", "_zones", "_risk"):
        if stem.endswith(tail):
            stem = stem[: -len(tail)]
            break
    if not stem.startswith("glof_"):
        stem = f"glof_{stem}"
    return stem


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", type=Path, help="Source GeoJSON FeatureCollection")
    ap.add_argument(
        "--prefix",
        default=None,
        help="Output filename prefix (default inferred from source filename)",
    )
    ap.add_argument(
        "--property",
        default="Zonation",
        help="Feature property holding the level label (default: Zonation)",
    )
    ap.add_argument(
        "--map",
        default=None,
        help=(
            "Comma-separated translation table for property values that don't "
            "already say high/medium/low — e.g. 'Sardar_Gol1=high,Sardar_Gol2=medium,Sardar_Gol3=low'. "
            "Keys are matched case-insensitively."
        ),
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output directory (default: same dir as source)",
    )
    args = ap.parse_args()

    translation: dict[str, str] = {}
    if args.map:
        for pair in args.map.split(","):
            pair = pair.strip()
            if not pair:
                continue
            if "=" not in pair:
                print(f"[fatal] bad --map entry (missing '='): {pair}", file=sys.stderr)
                return 1
            src, dst = (s.strip() for s in pair.split("=", 1))
            translation[src.lower()] = dst.lower()
        invalid = sorted(set(translation.values()) - set(LEVELS))
        if invalid:
            print(f"[fatal] --map values must be one of {LEVELS}; got: {invalid}", file=sys.stderr)
            return 1

    if not args.src.is_file():
        print(f"[fatal] source not found: {args.src}", file=sys.stderr)
        return 1

    out_dir = args.out or args.src.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or infer_prefix(args.src)

    data = json.loads(args.src.read_text(encoding="utf-8"))
    if data.get("type") != "FeatureCollection":
        print(f"[fatal] not a FeatureCollection: {args.src}", file=sys.stderr)
        return 1

    buckets: dict[str, list[dict]] = {lvl: [] for lvl in LEVELS}
    skipped = 0
    for feat in data.get("features", []):
        raw = (feat.get("properties") or {}).get(args.property)
        if not isinstance(raw, str):
            skipped += 1
            continue
        key = raw.strip().lower()
        lvl = translation.get(key, key)
        if lvl not in buckets:
            skipped += 1
            continue
        buckets[lvl].append(feat)

    print(f"[info] source : {args.src}")
    print(f"[info] prefix : {prefix}")
    print(f"[info] property: {args.property}")
    if skipped:
        print(f"[warn] {skipped} feature(s) skipped — property missing or unrecognised level")

    written = []
    for lvl, feats in buckets.items():
        if not feats:
            print(f"  - {lvl}: 0 features (no file written)")
            continue
        out_path = out_dir / f"{prefix}_{lvl}.geojson"
        fc = {
            "type": "FeatureCollection",
            "name": out_path.stem,
            "crs": data.get("crs"),
            "features": feats,
        }
        if fc["crs"] is None:
            fc.pop("crs")
        out_path.write_text(json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  - {lvl}: {len(feats)} feature(s) -> {out_path}")
        written.append(out_path)

    if not written:
        print("[fatal] no output files produced — check --property name", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
