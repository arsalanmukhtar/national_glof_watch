#!/usr/bin/env python3
"""Sentinel-2 L2A imagery fetch + on-the-fly index computation.

Talks to the Element84 Earth Search STAC (https://earth-search.aws.
element84.com/v1) which anonymously points at the AWS Sentinel-2 open-
data bucket. No account, no OAuth, no signed URLs, no expiring keys —
per-band COGs are read directly with rasterio via windowed range reads
so multi-tile clips don't have to pull whole scenes.

Usage:
    python sentinel_analysis.py \
        --geojson path/to/aoi.geojson \
        --window-a 2026-06-01/2026-06-30 \
        --window-b 2026-07-01/2026-07-31 \
        --index NDVI \
        --max-cloud 40 \
        --out data/rasters/analysis/<hash>

Emits a JSON summary to stdout when it succeeds:
    {
      "ok": true,
      "index": "NDVI",
      "windowA": { "sceneId", "sceneDate", "cloudCover", "cogPath", "stats" },
      "windowB": { ... },
      "delta":   { "cogPath", "stats" },
      "bounds":  [minLng, minLat, maxLng, maxLat]
    }

On failure it emits `{"ok": false, "error": "..."}` and exits with a
non-zero status.

Index formulas (Sentinel-2 band conventions, MSI L2A):
    NDVI = (B08 - B04) / (B08 + B04)   vegetation      (10 m)
    NDWI = (B03 - B08) / (B03 + B08)   surface water   (10 m)
    NDBI = (B11 - B08) / (B11 + B08)   built-up        (20 m -> 10 m)
    NDSI = (B03 - B11) / (B03 + B11)   snow / ice      (10 m + 20 m)

Cloud masking uses the SCL (Scene Classification Layer) band. Pixels
in {4=vegetation, 5=bare, 6=water, 7=unclassified, 11=snow} are kept.
Everything else (defective, cloud shadow, medium/high cloud, thin
cirrus, nodata) becomes NaN in the index output.

Install rasterio + pystac-client + shapely into the project venv:
    pip install -r scripts/python/requirements.txt
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

# Point PROJ at rasterio's bundled database BEFORE the extension is
# imported. rasterio's Windows wheel ships proj.db under
# site-packages/rasterio/proj_data/ but does NOT set PROJ's lookup
# env vars (`PROJ_DATA`, `PROJ_LIB`) on import. Set them ourselves —
# and *always* override, because a system-wide OSGeo4W install can
# leave `PROJ_LIB=C:\OSGeo4W\share\proj` on the environment even when
# that path is empty or missing (which yields the "Cannot find
# proj.db" error deep inside a transform_bounds call).
def _configure_proj_data() -> None:
    from pathlib import Path as _Path
    proj_dir = None
    for entry in sys.path:
        candidate = _Path(entry) / "rasterio" / "proj_data"
        if (candidate / "proj.db").exists():
            proj_dir = candidate
            break
    if proj_dir is None:
        _here = _Path(__file__).resolve()
        venv_data = (
            _here.parents[2] / ".venv" / "Lib" / "site-packages"
            / "rasterio" / "proj_data"
        )
        if (venv_data / "proj.db").exists():
            proj_dir = venv_data
    if proj_dir is None:
        return
    # Override — a stale system-wide PROJ_LIB pointing at a non-existent
    # OSGeo4W path is worse than no env var at all.
    os.environ["PROJ_DATA"] = str(proj_dir)
    os.environ["PROJ_LIB"] = str(proj_dir)


_configure_proj_data()

try:
    import numpy as np
    import rasterio
    from rasterio.warp import (
        Resampling,
        calculate_default_transform,
        reproject,
        transform_bounds,
    )
    from rasterio.windows import from_bounds as window_from_bounds
    from pystac_client import Client
    from shapely.geometry import shape as shp_shape, mapping as shp_mapping
except ImportError as e:
    sys.stderr.write(
        f"error: {e.name} missing. Install with:\n"
        "  pip install -r scripts/python/requirements.txt\n"
    )
    sys.exit(2)


STAC_URL = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"

# Element84's asset keys for the Sentinel-2 L2A COGs. `nir` is B08 at
# 10 m; `swir16` is B11 at 20 m. SCL is the 20 m cloud/land classifier.
INDEX_BANDS = {
    "NDVI": ("nir", "red"),        # (B08, B04)
    "NDWI": ("green", "nir"),      # (B03, B08)
    "NDBI": ("swir16", "nir"),     # (B11, B08)
    "NDSI": ("green", "swir16"),   # (B03, B11)
}

# SCL classes kept as valid data. See sen2cor Level-2A ATBD.
VALID_SCL = {4, 5, 6, 7, 11}


def _emit_fail(msg: str, code: int = 1) -> None:
    """Write a JSON failure envelope to stdout and exit."""
    sys.stdout.write(json.dumps({"ok": False, "error": msg}))
    sys.stdout.flush()
    sys.exit(code)


def _log(msg: str) -> None:
    """Diagnostic line to stderr so it doesn't corrupt the stdout JSON."""
    sys.stderr.write(f"[sentinel] {msg}\n")
    sys.stderr.flush()


def load_aoi(geojson_path: Path):
    """Load a GeoJSON file and return a shapely geometry in EPSG:4326."""
    with open(geojson_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if raw.get("type") == "FeatureCollection":
        feats = raw.get("features", [])
        if not feats:
            _emit_fail("AOI FeatureCollection is empty")
        geom = shp_shape(feats[0]["geometry"])
    elif raw.get("type") == "Feature":
        geom = shp_shape(raw["geometry"])
    elif "coordinates" in raw:
        geom = shp_shape(raw)
    else:
        _emit_fail("AOI GeoJSON is not a Feature / FeatureCollection / geometry")
    if not geom.is_valid:
        geom = geom.buffer(0)
    return geom


def parse_window(s: str) -> str:
    """Accept 'YYYY-MM-DD/YYYY-MM-DD' or 'YYYY-MM' and normalise to the
    slash form pystac-client understands.
    """
    s = s.strip()
    if "/" in s:
        return s
    # YYYY-MM -> the whole calendar month
    if len(s) == 7 and s[4] == "-":
        y, m = int(s[:4]), int(s[5:7])
        last_day = 31
        if m in (4, 6, 9, 11):
            last_day = 30
        elif m == 2:
            last_day = 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28
        return f"{s}-01/{s}-{last_day:02d}"
    _emit_fail(f"Unrecognised date window '{s}' (use 'YYYY-MM-DD/YYYY-MM-DD' or 'YYYY-MM')")


def search_scene(client: Client, aoi_geom, date_range: str, max_cloud: float):
    """Return the least-cloudy S2 L2A scene in `date_range` covering `aoi_geom`.

    STAC search happens over the AOI's bbox — cheap and matches the tile
    footprints. A follow-up `.intersects` filter would be stricter but
    the bbox result is already sorted by cloud cover, and hand-drawn
    polygons rarely miss all bbox-hit tiles.
    """
    bounds = aoi_geom.bounds
    _log(f"STAC search bbox={bounds} range={date_range} max_cloud={max_cloud}")
    t0 = time.time()
    search = client.search(
        collections=[COLLECTION],
        bbox=bounds,
        datetime=date_range,
        query={"eo:cloud_cover": {"lt": float(max_cloud)}},
        limit=100,
    )
    items = list(search.items())
    _log(f"STAC returned {len(items)} scene(s) in {time.time() - t0:.2f}s")
    if not items:
        return None
    items.sort(key=lambda it: it.properties.get("eo:cloud_cover", 100))
    return items[0]


def read_band_over_aoi(item, band_key: str, aoi_geom):
    """Windowed read of one COG band clipped to the AOI's bbox.

    Returns (array, transform, crs). The output CRS is the source COG's
    native UTM zone — resample-to-common-grid happens later.
    """
    if band_key not in item.assets:
        raise RuntimeError(f"Band '{band_key}' missing on scene {item.id}")
    href = item.assets[band_key].href
    t0 = time.time()
    with rasterio.open(href) as src:
        aoi_bounds_src = transform_bounds("EPSG:4326", src.crs, *aoi_geom.bounds)
        window = window_from_bounds(*aoi_bounds_src, transform=src.transform)
        window = window.round_offsets().round_lengths()
        # Clamp to raster extent — a hand-drawn AOI that grazes the
        # scene edge otherwise produces a negative-width window and a
        # rasterio ReadError.
        window = window.intersection(
            rasterio.windows.Window(0, 0, src.width, src.height)
        )
        if window.width <= 0 or window.height <= 0:
            raise RuntimeError(f"AOI outside scene {item.id} for band {band_key}")
        data = src.read(1, window=window)
        transform = src.window_transform(window)
        crs = src.crs
    _log(
        f"read {band_key} from {item.id} "
        f"({data.shape[1]}x{data.shape[0]}) in {time.time() - t0:.2f}s"
    )
    return data, transform, crs


def resample_to_shape(src_arr, src_transform, src_crs, dst_shape, dst_transform, dst_crs,
                     resampling=Resampling.nearest):
    """Reproject / resample one 2D band into an existing (transform, shape, crs) grid."""
    dst = np.empty(dst_shape, dtype=src_arr.dtype)
    reproject(
        source=src_arr,
        destination=dst,
        src_transform=src_transform,
        src_crs=src_crs,
        dst_transform=dst_transform,
        dst_crs=dst_crs,
        resampling=resampling,
    )
    return dst


def compute_normalized_diff(a, b):
    """Return (a - b) / (a + b) as float32, NaN where the denominator is 0."""
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    denom = a + b
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(denom != 0, (a - b) / denom, np.nan).astype(np.float32)


def apply_scl_mask(arr, scl):
    """NaN out every pixel whose SCL class isn't in VALID_SCL."""
    valid = np.isin(scl, list(VALID_SCL))
    out = arr.copy()
    out[~valid] = np.nan
    return out


def compute_stats(arr, sample_cap: int = 500_000):
    """Zonal statistics + a 20-bin histogram over finite pixels."""
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return {
            "count": 0, "mean": None, "min": None, "max": None,
            "std": None, "median": None, "p10": None, "p90": None,
            "histogram": [],
        }
    # np.percentile is O(n log n) — for very large clips cap the sample
    # so stats stay under a few hundred ms.
    if finite.size > sample_cap:
        idx = np.random.default_rng(0).choice(finite.size, sample_cap, replace=False)
        sample = finite[idx]
    else:
        sample = finite
    hist, edges = np.histogram(finite, bins=20)
    return {
        "count":  int(finite.size),
        "mean":   float(np.mean(finite)),
        "min":    float(np.min(finite)),
        "max":    float(np.max(finite)),
        "std":    float(np.std(finite)),
        "median": float(np.median(sample)),
        "p10":    float(np.percentile(sample, 10)),
        "p90":    float(np.percentile(sample, 90)),
        "histogram": [
            {"lo": float(edges[i]), "hi": float(edges[i + 1]), "count": int(hist[i])}
            for i in range(len(hist))
        ],
    }


def write_cog(arr, transform, crs, out_path: Path, nodata=np.nan):
    """Write a single-band float32 COG with internal overviews.

    rasterio 1.3's COG driver builds pyramids + interleaves tiles
    automatically. `predictor=3` gives ~2-3x better compression on
    smooth float rasters like NDVI.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    height, width = arr.shape
    profile = {
        "driver": "COG",
        "dtype": "float32",
        "count": 1,
        "height": height,
        "width": width,
        "transform": transform,
        "crs": crs,
        "nodata": float(nodata) if isinstance(nodata, float) and math.isnan(nodata) else nodata,
        "compress": "LZW",
        "predictor": 3,
        "blocksize": 256,
        "overview_resampling": "average",
    }
    # COG driver doesn't accept `nodata=nan` directly on some builds —
    # write with a sentinel and store nan in the array. Callers of the
    # generated file must respect the nodata tag.
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(arr.astype(np.float32), 1)


def compute_index_for_window(client: Client, aoi_geom, date_range: str,
                             index_name: str, max_cloud: float,
                             out_cog: Path):
    """Fetch the best scene in `date_range`, compute `index_name` clipped
    to `aoi_geom`, cloud-mask via SCL, write a COG, return (result, arr,
    transform, crs). Returns (None, None, None, None) if no scene found.
    """
    item = search_scene(client, aoi_geom, date_range, max_cloud)
    if item is None:
        return None, None, None, None

    band_a_key, band_b_key = INDEX_BANDS[index_name]
    band_a, transform, crs = read_band_over_aoi(item, band_a_key, aoi_geom)
    band_b, tr_b, crs_b = read_band_over_aoi(item, band_b_key, aoi_geom)

    # If bands are at different native resolutions (e.g. NDBI mixes B11
    # at 20 m with B08 at 10 m), resample the coarser one up to match
    # the finer grid before doing pixel math.
    if band_b.shape != band_a.shape:
        band_b = resample_to_shape(
            band_b, tr_b, crs_b, band_a.shape, transform, crs,
            resampling=Resampling.bilinear,
        )

    scl, tr_scl, crs_scl = read_band_over_aoi(item, "scl", aoi_geom)
    if scl.shape != band_a.shape:
        scl = resample_to_shape(
            scl, tr_scl, crs_scl, band_a.shape, transform, crs,
            resampling=Resampling.nearest,
        )

    index_arr = compute_normalized_diff(band_a, band_b)
    index_arr = apply_scl_mask(index_arr, scl)

    write_cog(index_arr, transform, crs, out_cog)
    stats = compute_stats(index_arr)

    return (
        {
            "sceneId":    item.id,
            "sceneDate":  item.properties.get("datetime"),
            "cloudCover": item.properties.get("eo:cloud_cover"),
            "cogPath":    str(out_cog),
            "stats":      stats,
        },
        index_arr,
        transform,
        crs,
    )


def compute_delta(arr_a, transform_a, crs_a, arr_b, transform_b, crs_b, out_cog: Path):
    """Align B onto A's grid, subtract, write delta COG, return stats."""
    if arr_b.shape != arr_a.shape or transform_b != transform_a or crs_b != crs_a:
        arr_b_aligned = resample_to_shape(
            arr_b, transform_b, crs_b, arr_a.shape, transform_a, crs_a,
            resampling=Resampling.bilinear,
        )
    else:
        arr_b_aligned = arr_b
    delta = (arr_b_aligned - arr_a).astype(np.float32)
    # NaN carries through — where either input was NaN the delta is NaN.
    write_cog(delta, transform_a, crs_a, out_cog)
    return {"cogPath": str(out_cog), "stats": compute_stats(delta)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--geojson",   required=True, help="Path to AOI GeoJSON (EPSG:4326)")
    ap.add_argument("--window-a",  required=True, help="First date window (YYYY-MM or YYYY-MM-DD/YYYY-MM-DD)")
    ap.add_argument("--window-b",  default=None,  help="Second date window (optional, for delta)")
    ap.add_argument("--index",     required=True, choices=list(INDEX_BANDS.keys()))
    ap.add_argument("--max-cloud", type=float, default=40.0)
    ap.add_argument("--out",       required=True, help="Output directory (created if missing)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        aoi = load_aoi(Path(args.geojson))
    except Exception as e:
        _emit_fail(f"AOI load failed: {e}")

    window_a = parse_window(args.window_a)
    window_b = parse_window(args.window_b) if args.window_b else None
    index = args.index

    client = Client.open(STAC_URL)

    cog_a = out_dir / f"{index}_a.tif"
    result_a, arr_a, tr_a, crs_a = compute_index_for_window(
        client, aoi, window_a, index, args.max_cloud, cog_a,
    )
    if result_a is None:
        _emit_fail(f"No suitable scene found for window A ({window_a}) under {args.max_cloud}% cloud")

    payload = {
        "ok": True,
        "index": index,
        "bounds": list(aoi.bounds),
        "windowA": result_a,
    }

    if window_b:
        cog_b = out_dir / f"{index}_b.tif"
        result_b, arr_b, tr_b, crs_b = compute_index_for_window(
            client, aoi, window_b, index, args.max_cloud, cog_b,
        )
        if result_b is None:
            _emit_fail(f"No suitable scene found for window B ({window_b}) under {args.max_cloud}% cloud")

        cog_delta = out_dir / f"{index}_delta.tif"
        delta = compute_delta(arr_a, tr_a, crs_a, arr_b, tr_b, crs_b, cog_delta)

        payload["windowB"] = result_b
        payload["delta"] = delta

    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
