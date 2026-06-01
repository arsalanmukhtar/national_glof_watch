#!/usr/bin/env python3
"""Clip a GeoTIFF to a bounding box, polygon mask, or another raster's extent.

Trims a raster down to a target extent without resampling. The output
keeps the source's CRS, dtype, nodata sentinel, and (by default) the
source's compression settings — only the bounds change. No pixel
values are touched inside the kept area.

Extent sources (exactly one required):

  --bbox MINX MINY MAXX MAXY [--bbox-crs EPSG:4326]
      Rectangular crop. Coordinates are in the source CRS unless
      --bbox-crs is given (then they're reprojected to the source CRS
      first). The window is snapped to the source pixel grid, so no
      resampling — the kept pixels are bit-identical to the source.

  --mask shapes.geojson [--all-touched]
      Clip to one or more polygons from a GeoJSON file. Pixels outside
      every polygon are set to the source's nodata. The output bounds
      are the polygons' total bounds. ``--all-touched`` also keeps any
      pixel a polygon edge merely touches (default: only pixels whose
      center is inside).

  --like other_raster.tif
      Use the bounds of another GeoTIFF as the crop window. Handy for
      aligning multiple rasters to a common extent.

Examples::

    # Pakistan rectangle (approx) — fast, pixel-aligned bbox crop.
    python scripts/python/clip_raster.py \\
        data/rasters/global_pop_2025_CN_1km_R2025A_UA_v1.tif \\
        --bbox 60.5 23.5 77.5 37.5 --bbox-crs EPSG:4326 \\
        -o data/rasters/global_pop_pakistan_bbox.tif

    # Tight clip to Pakistan's national boundary polygon.
    python scripts/python/clip_raster.py \\
        data/rasters/global_pop_2025_CN_1km_R2025A_UA_v1.tif \\
        --mask data/geojsons/administrative_boundaries/pak_boundaries_national_boundary.geojson \\
        -o data/rasters/global_pop_pakistan.tif

    # Match another raster's extent.
    python scripts/python/clip_raster.py <big.tif> --like <reference.tif> -o <out.tif>

Install rasterio into the project venv if you haven't already::

    python -m venv .venv
    .venv\\Scripts\\activate           (PowerShell / cmd)
    source .venv/bin/activate         (bash / zsh)
    pip install -r scripts/python/requirements.txt
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import rasterio
    from rasterio.mask import mask as rio_mask
    from rasterio.warp import transform_bounds, transform_geom
    from rasterio.windows import Window, from_bounds as window_from_bounds
except ImportError:
    sys.exit(
        "error: rasterio is not installed in the active Python.\n"
        "       Set up the project venv (one time):\n"
        "         python -m venv .venv\n"
        "         .venv\\Scripts\\activate     (PowerShell)\n"
        "         source .venv/bin/activate    (bash)\n"
        "         pip install -r scripts/python/requirements.txt"
    )

# Override any stray system PROJ_DATA / GDAL_DATA env vars (typically
# left over from an OSGeo4W shell in the same session) so rasterio's
# bundled data wins. Without this, the first call into
# rasterio.warp.transform_geom fails with "Cannot find proj.db" because
# PROJ goes looking in the OSGeo4W tree which the venv's PROJ build
# has no reason to know about.
_rio_root = Path(rasterio.__file__).parent
if (_rio_root / "proj_data" / "proj.db").exists():
    os.environ["PROJ_DATA"] = str(_rio_root / "proj_data")
    os.environ["PROJ_LIB"] = str(_rio_root / "proj_data")
if (_rio_root / "gdal_data").is_dir():
    os.environ["GDAL_DATA"] = str(_rio_root / "gdal_data")


def auto_predictor(dtype: str) -> int:
    """Same heuristic as compress_raster.py — float types want
    predictor 3 (floating-point), integer types want 2 (horizontal
    differencing), everything else stays at 1 (none)."""
    if dtype in ("float32", "float64"):
        return 3
    if dtype in ("int16", "uint16", "int32", "uint32", "int64", "uint64"):
        return 2
    return 1


def human_mb(n_bytes: int) -> str:
    return f"{n_bytes / (1024 * 1024):.1f} MB"


def source_creation_options(src) -> dict:
    """Mirror the source's compression / tiling / predictor into the
    output profile so a clip of a ZSTD or LERC file doesn't silently
    fall back to GDAL's default LZW. Reads the predictor from the
    IMAGE_STRUCTURE tags since rasterio doesn't expose it directly on
    the profile."""
    prof = src.profile
    tags = src.tags(ns="IMAGE_STRUCTURE") or {}
    compress = prof.get("compress")

    options = {
        "tiled": True,
        "blockxsize": prof.get("blockxsize") or 512,
        "blockysize": prof.get("blockysize") or 512,
        "bigtiff": "IF_SAFER",
        "sparse_ok": True,
        "num_threads": "ALL_CPUS",
    }
    if compress:
        options["compress"] = compress
        # Source's predictor wins; fall back to dtype-based auto pick
        # if the source didn't record one (uncompressed sources etc).
        options["predictor"] = int(tags.get("PREDICTOR") or auto_predictor(src.dtypes[0]))
        if compress.lower() == "zstd":
            options["zstd_level"] = int(tags.get("ZSTD_LEVEL") or 15)
        elif compress.lower() == "deflate":
            options["zlevel"] = int(tags.get("ZLEVEL") or 9)
    else:
        # Uncompressed source — default to a sensible lossless setup
        # so the clipped output isn't gratuitously larger than it has
        # to be.
        options["compress"] = "zstd"
        options["predictor"] = auto_predictor(src.dtypes[0])
        options["zstd_level"] = 15
    return options


def parse_crs(s: str | None):
    """Accept 'EPSG:4326', '4326', 'epsg:4326'. Returns a CRS object
    or None for empty input."""
    if not s:
        return None
    s = s.strip()
    if s.isdigit():
        return rasterio.crs.CRS.from_epsg(int(s))
    return rasterio.crs.CRS.from_string(s)


def load_mask_geometries(mask_path: Path, target_crs) -> list[dict]:
    """Load polygon geometries from a GeoJSON file and reproject them
    into ``target_crs`` if a CRS is declared on the file. GeoJSON's
    spec defaults to EPSG:4326 when the file is silent, so that's the
    safe assumption — most modern tooling writes 4326 anyway."""
    with mask_path.open("r", encoding="utf-8") as f:
        gj = json.load(f)

    # Resolve the source CRS of the GeoJSON. The 2008 GeoJSON spec
    # allowed a top-level "crs" member; the 2016 RFC 7946 mandates
    # WGS84 and removed "crs". Support both, defaulting to EPSG:4326.
    src_crs = rasterio.crs.CRS.from_epsg(4326)
    crs_member = gj.get("crs")
    if isinstance(crs_member, dict):
        name = (crs_member.get("properties") or {}).get("name")
        if name:
            try:
                src_crs = rasterio.crs.CRS.from_string(name)
            except Exception:
                pass  # fall back to 4326

    feats = gj.get("features") if gj.get("type") == "FeatureCollection" else [gj]
    geoms: list[dict] = []
    for f in feats:
        geom = f.get("geometry") if "geometry" in f else f
        if not geom:
            continue
        if src_crs != target_crs:
            geom = transform_geom(src_crs, target_crs, geom)
        geoms.append(geom)
    if not geoms:
        sys.exit(f"error: no usable geometries in {mask_path}")
    return geoms


def clip_bbox(
    src_path: Path,
    dst_path: Path,
    bbox: tuple[float, float, float, float],
    bbox_crs,
    creation_override: dict | None,
) -> None:
    """Pixel-aligned bbox crop. Window arithmetic snaps the requested
    bounds to the source's pixel grid, so no resampling — every kept
    pixel value comes through unchanged."""
    with rasterio.open(src_path) as src:
        target_bbox = bbox
        if bbox_crs and bbox_crs != src.crs:
            target_bbox = transform_bounds(bbox_crs, src.crs, *bbox)

        # round_lengths + round_offsets snap to whole-pixel boundaries
        # so the output transform stays aligned to the source grid.
        win = window_from_bounds(*target_bbox, transform=src.transform)
        win = win.round_offsets().round_lengths()
        full = Window(0, 0, src.width, src.height)
        win = win.intersection(full)
        if win.width <= 0 or win.height <= 0:
            sys.exit("error: requested bbox does not overlap the source raster")

        out_transform = src.window_transform(win)
        profile = src.profile.copy()
        profile.update(
            width=int(win.width),
            height=int(win.height),
            transform=out_transform,
        )
        profile.update(creation_override or source_creation_options(src))

        with rasterio.open(dst_path, "w", **profile) as dst:
            for i in range(1, src.count + 1):
                dst.write(src.read(i, window=win), i)
            dst.update_tags(**src.tags())
            for i in range(1, src.count + 1):
                dst.update_tags(i, **src.tags(i))
            if src.descriptions:
                dst.descriptions = src.descriptions


def clip_mask(
    src_path: Path,
    dst_path: Path,
    mask_path: Path,
    all_touched: bool,
    creation_override: dict | None,
) -> None:
    """Vector polygon clip via ``rasterio.mask.mask``. Pixels outside
    every polygon are set to the source's nodata; the output extent is
    the polygons' total bounds."""
    with rasterio.open(src_path) as src:
        geoms = load_mask_geometries(mask_path, src.crs)

        out_image, out_transform = rio_mask(
            src,
            geoms,
            crop=True,
            all_touched=all_touched,
            # Use the source's nodata as the fill so masked-out pixels
            # round-trip cleanly. If the source has no nodata we fall
            # back to 0, which is the GDAL default and what most
            # downstream tools expect.
            nodata=src.nodata if src.nodata is not None else 0,
        )

        profile = src.profile.copy()
        profile.update(
            width=out_image.shape[2],
            height=out_image.shape[1],
            transform=out_transform,
        )
        profile.update(creation_override or source_creation_options(src))

        with rasterio.open(dst_path, "w", **profile) as dst:
            dst.write(out_image)
            dst.update_tags(**src.tags())
            for i in range(1, src.count + 1):
                dst.update_tags(i, **src.tags(i))
            if src.descriptions:
                dst.descriptions = src.descriptions


def clip_like(
    src_path: Path,
    dst_path: Path,
    like_path: Path,
    creation_override: dict | None,
) -> None:
    """Crop ``src`` to the bounds of ``like``. CRS-reprojects the
    reference bounds if necessary so this works across CRSs."""
    with rasterio.open(like_path) as like:
        ref_bounds = (like.bounds.left, like.bounds.bottom, like.bounds.right, like.bounds.top)
        ref_crs = like.crs
    clip_bbox(src_path, dst_path, ref_bounds, ref_crs, creation_override)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Clip a GeoTIFF to a bounding box, vector mask, or another "
            "raster's extent. No resampling — kept pixels are bit-identical."
        ),
    )
    p.add_argument("input", type=Path, help="Source .tif / .tiff file.")
    p.add_argument(
        "-o", "--output", type=Path, default=None,
        help="Destination path. Default: <input>.clipped.tif",
    )

    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument(
        "--bbox", nargs=4, type=float, metavar=("MINX", "MINY", "MAXX", "MAXY"),
        help="Rectangular bounding box in --bbox-crs coordinates.",
    )
    grp.add_argument(
        "--mask", type=Path,
        help="GeoJSON file with polygon(s) to clip to.",
    )
    grp.add_argument(
        "--like", type=Path,
        help="Another raster whose bounds to use as the clip extent.",
    )

    p.add_argument(
        "--bbox-crs", default=None,
        help="CRS of --bbox coordinates (e.g. EPSG:4326). "
             "Default: same CRS as the source raster.",
    )
    p.add_argument(
        "--all-touched", action="store_true",
        help="(--mask only) Include any pixel a polygon edge touches "
             "rather than only those with centers inside.",
    )
    p.add_argument(
        "--compress", default=None,
        help="Override output codec (e.g. zstd, deflate, lzw, lerc_zstd). "
             "Default: copy the source's codec.",
    )
    p.add_argument(
        "--predictor", type=int, default=None, choices=(1, 2, 3),
        help="Override output predictor. Default: copy the source's predictor.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    src: Path = args.input

    if not src.exists():
        sys.exit(f"error: {src} does not exist")
    if src.suffix.lower() not in (".tif", ".tiff"):
        sys.exit(f"error: {src} is not a .tif/.tiff file")

    dst: Path = args.output if args.output is not None else src.with_suffix(".clipped.tif")
    if dst.exists():
        sys.exit(f"error: {dst} already exists — delete it or pick another -o path.")

    # Optional encoding override — when present, beats the source-mirror
    # default in source_creation_options(). Lets the user clip *and*
    # re-encode in one shot (e.g. clip a LZW file out to ZSTD).
    creation_override = None
    if args.compress or args.predictor is not None:
        creation_override = {}
        with rasterio.open(src) as ds:
            dtype = ds.dtypes[0]
        creation_override.update(
            tiled=True, blockxsize=512, blockysize=512,
            bigtiff="IF_SAFER", sparse_ok=True, num_threads="ALL_CPUS",
        )
        creation_override["compress"] = (args.compress or "zstd").lower()
        creation_override["predictor"] = (
            args.predictor if args.predictor is not None else auto_predictor(dtype)
        )
        if creation_override["compress"] == "zstd":
            creation_override["zstd_level"] = 15
        elif creation_override["compress"] == "deflate":
            creation_override["zlevel"] = 9

    src_size = src.stat().st_size
    print(f"Source : {src}  ({human_mb(src_size)})")
    with rasterio.open(src) as ds:
        print(
            f"         {ds.width}x{ds.height}, {ds.count} band(s), {ds.dtypes[0]}, "
            f"crs={ds.crs.to_string() if ds.crs else 'none'}, nodata={ds.nodata}"
        )

    if args.bbox:
        print(f"Clip   : bbox {args.bbox} (crs={args.bbox_crs or 'source'})")
    elif args.mask:
        print(f"Clip   : mask {args.mask}{' (all-touched)' if args.all_touched else ''}")
    else:
        print(f"Clip   : extent of {args.like}")

    t0 = time.perf_counter()
    try:
        if args.bbox:
            clip_bbox(
                src, dst,
                tuple(args.bbox),
                parse_crs(args.bbox_crs),
                creation_override,
            )
        elif args.mask:
            clip_mask(src, dst, args.mask, args.all_touched, creation_override)
        else:
            clip_like(src, dst, args.like, creation_override)
    except SystemExit:
        raise
    except Exception as exc:
        try:
            dst.unlink()
        except FileNotFoundError:
            pass
        sys.exit(f"error: clip failed: {type(exc).__name__}: {exc}")
    elapsed = time.perf_counter() - t0

    dst_size = dst.stat().st_size
    ratio = src_size / max(dst_size, 1)
    with rasterio.open(dst) as ds:
        print(
            f"Wrote  : {dst}  ({human_mb(dst_size)}, {ratio:.1f}x smaller, "
            f"{elapsed:.1f}s)"
        )
        print(
            f"         {ds.width}x{ds.height}, "
            f"bounds=({ds.bounds.left:.4f}, {ds.bounds.bottom:.4f}, "
            f"{ds.bounds.right:.4f}, {ds.bounds.top:.4f})"
        )

    print(
        "Tip    : run scripts/python/generate_pyramids.py on the output "
        "to add overviews."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
