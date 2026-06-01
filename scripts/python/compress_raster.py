#!/usr/bin/env python3
"""Losslessly shrink a GeoTIFF without changing pixel size or values.

Re-encodes a raster with modern lossless compression (ZSTD by default)
plus the floating-point predictor, tiling, and sparse-block skipping so
the on-disk size drops sharply — often ~10x for sparse data like global
population counts where most pixels are nodata over oceans — while every
pixel value, the CRS, geo-transform, nodata sentinel, dtype, and band
tags stay bit-identical to the source.

What this script does NOT do:
  * Resample, reproject, or change resolution (no pixel-size change).
  * Downcast dtype, quantise floats, or apply a lossy LERC tolerance.
  * Touch the input file unless ``--replace`` is passed (and even then
    the original is preserved as ``<file>.bak`` first).

Examples::

    # Default: write <file>.compressed.tif next to the source.
    python scripts/python/compress_raster.py \\
        data/rasters/global_pop_2025_CN_1km_R2025A_UA_v1.tif

    # Pick the output path explicitly.
    python scripts/python/compress_raster.py <in.tif> -o <out.tif>

    # Replace the source (keeps <file>.bak so you can verify first).
    python scripts/python/compress_raster.py <in.tif> --replace

    # Force a specific codec / predictor.
    python scripts/python/compress_raster.py <in.tif> --compress deflate --predictor 3

    # Drop existing overviews instead of re-encoding them.
    python scripts/python/compress_raster.py <in.tif> --no-overviews

After ``--replace`` succeeds you can re-pyramidise the smaller file
with ``scripts/python/generate_pyramids.py`` if you dropped overviews.

Install rasterio into the project venv if you haven't already::

    python -m venv .venv
    .venv\\Scripts\\activate           (PowerShell / cmd)
    source .venv/bin/activate         (bash / zsh)
    pip install -r scripts/python/requirements.txt
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

try:
    import rasterio
    from rasterio.shutil import copy as rio_copy
except ImportError:
    sys.exit(
        "error: rasterio is not installed in the active Python.\n"
        "       Set up the project venv (one time):\n"
        "         python -m venv .venv\n"
        "         .venv\\Scripts\\activate     (PowerShell)\n"
        "         source .venv/bin/activate    (bash)\n"
        "         pip install -r scripts/python/requirements.txt\n"
        "       Then re-run this script with the venv active."
    )


# Lossless codecs available on the bundled GDAL build. ZSTD wins on
# both ratio and decode speed for the population / DEM-style rasters
# we run through here, so it's the default.
CODECS = ("zstd", "deflate", "lzw", "packbits")


def auto_predictor(dtype: str) -> int:
    """Pick the GDAL TIFF predictor that actually makes lossless
    compression small for this dtype.

      * 3 -- floating-point predictor (encodes IEEE-754 exponent/
            mantissa correlation; the only way float rasters compress
            to anything respectable).
      * 2 -- horizontal differencing for integer samples.
      * 1 -- no predictor; the safe fallback for Byte / Complex / etc.

    Pairing the wrong predictor with float data is the single most
    common reason "compressed" GeoTIFFs are still huge.
    """
    if dtype in ("float32", "float64"):
        return 3
    if dtype in ("int16", "uint16", "int32", "uint32", "int64", "uint64"):
        return 2
    return 1


def human_mb(n_bytes: int) -> str:
    return f"{n_bytes / (1024 * 1024):.1f} MB"


def compress_raster(
    src: Path,
    dst: Path,
    codec: str,
    predictor: int,
    blocksize: int,
    zstd_level: int,
    keep_overviews: bool,
) -> None:
    """Re-encode `src` to `dst` via GDAL's CreateCopy (through
    ``rasterio.shutil.copy``). CreateCopy streams the source block by
    block — memory stays bounded even on multi-gigapixel inputs —
    and propagates georeferencing, nodata, masks, and band tags for
    free, so the only thing we override is the encoding."""
    options = dict(
        COMPRESS=codec.upper(),
        PREDICTOR=str(predictor),
        TILED="YES",
        BLOCKXSIZE=str(blocksize),
        BLOCKYSIZE=str(blocksize),
        # IF_SAFER promotes to BigTIFF only when the output might
        # exceed 4 GB; small outputs stay classic TIFF and read in
        # every legacy GeoTIFF reader.
        BIGTIFF="IF_SAFER",
        # All-nodata / all-zero blocks aren't written to disk at all.
        # For a global population raster with huge ocean nodata
        # regions this is most of the file-size win on its own.
        SPARSE_OK="TRUE",
        # Parallel block compression — every core does work.
        NUM_THREADS="ALL_CPUS",
        # Re-compress whatever overviews are already embedded so the
        # user doesn't have to re-run generate_pyramids.py just to
        # get the smaller-file benefit at every zoom level.
        COPY_SRC_OVERVIEWS="YES" if keep_overviews else "NO",
    )
    if codec.lower() == "zstd":
        options["ZSTD_LEVEL"] = str(zstd_level)
    elif codec.lower() == "deflate":
        # 9 is the max DEFLATE level; the marginal speed cost is
        # invisible next to the I/O for the file sizes we deal with.
        options["ZLEVEL"] = "9"

    rio_copy(str(src), str(dst), driver="GTiff", **options)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Losslessly shrink a GeoTIFF (no resampling, no dtype change). "
            "Bit-identical pixels, CRS, transform, and nodata; just a smaller file."
        ),
    )
    p.add_argument("input", type=Path, help="Source .tif / .tiff file.")
    p.add_argument(
        "-o", "--output", type=Path, default=None,
        help="Destination path. Default: <input>.compressed.tif",
    )
    p.add_argument(
        "--replace", action="store_true",
        help="Replace the input file with the compressed output. The "
             "original is renamed to <input>.bak first so nothing is lost.",
    )
    p.add_argument(
        "--compress", dest="codec", default="zstd", choices=CODECS,
        help="Codec (default: zstd — best ratio + fastest decode).",
    )
    p.add_argument(
        "--predictor", type=int, default=None, choices=(1, 2, 3),
        help="1=none, 2=integer differencing, 3=floating-point. "
             "Default: auto-picked from the source dtype.",
    )
    p.add_argument(
        "--blocksize", type=int, default=512,
        help="Tile size in pixels (default: 512). Smaller blocks give "
             "finer random access; larger blocks compress slightly better.",
    )
    p.add_argument(
        "--zstd-level", type=int, default=15,
        help="ZSTD compression level 1-22 (default: 15). 15 is a sweet "
             "spot; 22 squeezes out a few extra %% at a real time cost.",
    )
    p.add_argument(
        "--no-overviews", action="store_true",
        help="Drop existing overviews rather than re-encoding them. "
             "Rebuild later with scripts/python/generate_pyramids.py.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    src: Path = args.input

    if not src.exists():
        sys.exit(f"error: {src} does not exist")
    if src.suffix.lower() not in (".tif", ".tiff"):
        sys.exit(f"error: {src} is not a .tif/.tiff file")

    # When replacing, write to a sibling temp first and only swap the
    # original out at the very end — a failed encode shouldn't be able
    # to wipe the source.
    if args.replace:
        dst = src.with_suffix(src.suffix + ".compressed-tmp")
    else:
        dst = (
            args.output
            if args.output is not None
            else src.with_suffix(".compressed.tif")
        )

    if dst.exists() and not args.replace:
        sys.exit(
            f"error: {dst} already exists — delete it or pick another -o path."
        )

    src_size = src.stat().st_size

    # Read enough header info to report the encoding decision before
    # we kick off the (potentially minutes-long) re-encode.
    with rasterio.open(src) as ds:
        dtype = ds.dtypes[0] if ds.dtypes else "float32"
        pred = args.predictor if args.predictor is not None else auto_predictor(dtype)
        crs_str = ds.crs.to_string() if ds.crs else "none"
        overviews_in = ds.overviews(1) if ds.count >= 1 else []
        print(f"Source : {src}  ({human_mb(src_size)})")
        print(
            f"         {ds.width}x{ds.height}, {ds.count} band(s), {dtype}, "
            f"crs={crs_str}, overviews={overviews_in or 'none'}"
        )

    print(
        f"Encode : codec={args.codec.upper()}, predictor={pred}, "
        f"blocksize={args.blocksize}, sparse=on, "
        f"overviews={'kept' if not args.no_overviews else 'dropped'}",
        flush=True,
    )

    t0 = time.perf_counter()
    try:
        compress_raster(
            src=src,
            dst=dst,
            codec=args.codec,
            predictor=pred,
            blocksize=args.blocksize,
            zstd_level=args.zstd_level,
            keep_overviews=not args.no_overviews,
        )
    except Exception as exc:
        # A failed re-encode shouldn't leave a half-written .tmp file
        # lying around to confuse the next run.
        try:
            dst.unlink()
        except FileNotFoundError:
            pass
        sys.exit(f"error: compression failed: {type(exc).__name__}: {exc}")
    elapsed = time.perf_counter() - t0

    dst_size = dst.stat().st_size
    ratio = src_size / max(dst_size, 1)
    saved = src_size - dst_size
    print(
        f"Wrote  : {dst}  ({human_mb(dst_size)}, "
        f"{ratio:.1f}x smaller, saved {human_mb(saved)}, {elapsed:.1f}s)"
    )

    if args.replace:
        bak = src.with_suffix(src.suffix + ".bak")
        # If a previous --replace already left a .bak, don't overwrite
        # it — push it aside to .bak.prev so the user keeps both copies.
        if bak.exists():
            prev = bak.with_suffix(bak.suffix + ".prev")
            print(f"note   : {bak} already existed — moved to {prev}")
            try:
                prev.unlink()
            except FileNotFoundError:
                pass
            bak.rename(prev)
        src.rename(bak)
        dst.rename(src)
        print(f"Replaced {src}  (original preserved at {bak})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
