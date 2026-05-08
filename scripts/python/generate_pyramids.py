#!/usr/bin/env python3
"""Generate internal overview pyramids for every GeoTIFF under data/rasters/.

The frontend raster decoder caps in-browser pixel reads at 64 M source pixels
and prefers the file's smallest reduced-resolution overview that's still big
enough for the rendered output. A 30 K x 18 K raster with no overviews makes
the decoder either refuse the file (with a "run gdaladdo" message) or take a
long time to read full-res before resampling. Running this script after
dropping new rasters into ``data/rasters/`` writes those pyramids in-place so
the dashboard renders them quickly.

Usage::

    python scripts/python/generate_pyramids.py
    python scripts/python/generate_pyramids.py data/rasters
    python scripts/python/generate_pyramids.py --resampling mode --force
    python scripts/python/generate_pyramids.py --levels 2 4 8 16

Overviews are always written *into* the source ``.tif`` (embedded
IFDs) -- no sidecar ``.ovr`` files. The script uses ``rasterio``,
which ships GDAL bundled in its wheel -- no separate GDAL CLI install
required. Install into a project-local venv (one-time setup)::

    python -m venv .venv
    .venv\\Scripts\\activate           (PowerShell / cmd)
    source .venv/bin/activate         (bash / zsh)
    pip install -r scripts/python/requirements.txt

Activate the venv every shell session before running the script. The
venv directory is gitignored so it stays out of the repo.

Resampling defaults are picked per-file from the band data type when the
user doesn't pass ``--resampling`` explicitly:

* ``Byte`` -> ``mode`` (categorical / classified rasters; preserves class IDs)
* anything else -> ``average`` (continuous rasters; smooth downsampling)

Override with ``--resampling`` if you need a single method for everything
(e.g. ``nearest`` for raw indexed colour, ``cubic`` for elevation).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import rasterio
    from rasterio.enums import Resampling
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

DEFAULT_DIR = Path("data/rasters")
# Pyramid stops when the next overview would shrink the larger
# dimension below this. Matches the frontend renderer's MAX_PIXELS
# (= 2048^2): the smallest overview the browser will actually use is
# the one >= 2048 px, so anything finer than that is wasted bytes.
DEFAULT_MIN_SIZE = 2048

# Map gdaladdo-style resampling names to rasterio's Resampling enum so
# the CLI surface stays GDAL-flavoured (familiar to anyone who has
# typed `gdaladdo -r ...` before) without leaking the rasterio enum.
RESAMPLING_MAP: dict[str, Resampling] = {
    "nearest":     Resampling.nearest,
    "average":     Resampling.average,
    "rms":         getattr(Resampling, "rms", Resampling.average),
    "gauss":       Resampling.gauss,
    "cubic":       Resampling.cubic,
    "cubicspline": Resampling.cubic_spline,
    "lanczos":     Resampling.lanczos,
    "mode":        Resampling.mode,
    "bilinear":    Resampling.bilinear,
}


def find_rasters(target: Path) -> list[Path]:
    """Resolve the CLI target to one or more .tif files. Accepts either
    a directory (walks it once, filters by lowercased suffix) or a
    single .tif/.tiff file (returns just that). The single-file path
    is what the upload route invokes per fresh upload so the browser
    only waits on the one raster it just dropped, not the whole
    catalog."""
    if not target.exists():
        sys.exit(f"error: {target} does not exist")
    if target.is_file():
        if target.suffix.lower() not in (".tif", ".tiff"):
            sys.exit(f"error: {target} is not a .tif/.tiff file")
        return [target]
    if not target.is_dir():
        sys.exit(f"error: {target} is neither a directory nor a .tif file")
    # Walk the directory once and filter by lowercased suffix so each
    # file appears exactly once. Globbing with separate `*.tif` and
    # `*.TIF` patterns double-counts on Windows (case-insensitive
    # matching) and undercounts on Linux (case-sensitive but with
    # potential mixed-case filenames).
    files = [
        f for f in target.iterdir()
        if f.is_file() and f.suffix.lower() in (".tif", ".tiff")
    ]
    return sorted(files)


def detect_resampling(dtype: str) -> str:
    """Pick a resampling method from the band's data type. Byte rasters
    are usually classified -- use ``mode`` so class IDs survive.
    Everything else gets ``average``."""
    return "mode" if dtype == "uint8" else "average"


def auto_levels(width: int, height: int, min_size: int) -> tuple[int, ...]:
    """Return the decimation factors needed to reach an overview where
    ``max(width, height)`` is still >= ``min_size``. The pyramid stops
    one level above that -- never producing an overview smaller than
    ``min_size`` along its larger axis. For a 30076 x 17980 source and
    the default 2048 floor, this returns (2, 4, 8) -- /16 would drop
    the wider axis to 1880 (below 2048) so it's omitted."""
    largest = max(width, height)
    if largest <= min_size:
        return ()
    levels: list[int] = []
    factor = 2
    while largest // factor >= min_size:
        levels.append(factor)
        factor *= 2
    return tuple(levels)


def build_pyramids(
    path: Path,
    levels: tuple[int, ...],
    resampling: str,
    clean: bool,
) -> tuple[bool, str]:
    """Open ``path`` in read/write mode and write embedded overview IFDs.
    ``clean=True`` first strips any existing overviews by issuing a
    zero-level build, mirroring `gdaladdo -clean`."""
    method = RESAMPLING_MAP[resampling]
    try:
        with rasterio.open(path, "r+") as ds:
            if clean:
                ds.build_overviews([], method)
            ds.build_overviews(list(levels), method)
            # Stamp the chosen method into the file's tags so it's
            # discoverable later (mirrors what `gdaladdo -r` does).
            ds.update_tags(ns="rio_overview", resampling=resampling)
        return True, ""
    except Exception as exc:  # rasterio surfaces I/O + GDAL errors here
        return False, f"{type(exc).__name__}: {exc}"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate overview pyramids for rasters in data/rasters/.",
    )
    p.add_argument(
        "target",
        nargs="?",
        type=Path,
        default=DEFAULT_DIR,
        help=f"Directory of .tif/.tiff files OR a single .tif file "
             f"(default: {DEFAULT_DIR}). The server's upload handler "
             f"calls the script with the just-uploaded file's path so "
             f"only the new raster gets pyramidized.",
    )
    p.add_argument(
        "--levels",
        nargs="+",
        type=int,
        default=None,
        help="Decimation factors to build. Default: auto-computed per file "
             "to stop at --min-size (so the smallest overview stays >= that).",
    )
    p.add_argument(
        "--min-size",
        type=int,
        default=DEFAULT_MIN_SIZE,
        help=f"Smallest acceptable overview dimension when auto-computing "
             f"levels (default: {DEFAULT_MIN_SIZE} -- matches the frontend "
             f"renderer's pixel cap).",
    )
    p.add_argument(
        "--resampling",
        choices=tuple(RESAMPLING_MAP.keys()),
        default=None,
        help="Resampling method. Auto-picks 'mode' for Byte rasters, "
             "'average' otherwise when not specified.",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Regenerate overviews even if the file already has them.",
    )
    p.add_argument(
        "--clean",
        action="store_true",
        help="Remove existing overviews before generating new ones "
             "(implies --force).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    rasters = find_rasters(args.target)
    if not rasters:
        print(f"No .tif / .tiff files in {args.target}.")
        return 0

    print(f"Found {len(rasters)} raster(s) in {args.target}")
    if args.levels:
        print(f"Levels: {' '.join(map(str, args.levels))} (forced)")
    else:
        print(f"Levels: auto (stop at min-size {args.min_size} px)")
    if args.resampling:
        print(f"Resampling: {args.resampling} (forced)")
    else:
        print("Resampling: auto (mode for Byte, average otherwise)")
    print()

    built = skipped = failed = 0
    for path in rasters:
        try:
            with rasterio.open(path) as ds:
                width, height = ds.width, ds.height
                dtype = ds.dtypes[0] if ds.dtypes else "float32"
                # rasterio.overviews(band_idx) returns the decimation
                # factors already embedded for that band -- empty list
                # means the file has none.
                existing = ds.overviews(1) if ds.count >= 1 else []
        except Exception as exc:
            print(f"  ERROR  {path.name} (couldn't open: {exc})")
            failed += 1
            continue

        already = bool(existing)
        force = args.force or args.clean

        if already and not force:
            print(
                f"  skip   {path.name} "
                f"(already has overviews: {existing})"
            )
            skipped += 1
            continue

        # Per-file level computation: a 30K x 18K raster gets (2, 4, 8);
        # a 4K x 4K raster gets (2,) -- and a raster already smaller
        # than min-size is skipped entirely.
        if args.levels:
            levels = tuple(args.levels)
        else:
            levels = auto_levels(width, height, args.min_size)
            if not levels:
                print(
                    f"  skip   {path.name} (already <= min-size "
                    f"{args.min_size} px, no overviews needed)"
                )
                skipped += 1
                continue

        resampling = args.resampling or detect_resampling(dtype)
        action = "rebuild" if already else "build  "
        levels_str = " ".join(map(str, levels))
        print(
            f"  {action} {path.name}  "
            f"({width}x{height}, dtype={dtype}, -r {resampling}, "
            f"levels {levels_str})",
            flush=True,
        )

        ok, err = build_pyramids(path, levels, resampling, args.clean)
        if ok:
            built += 1
        else:
            failed += 1
            print(f"    FAILED: {err}")

    print()
    print(f"Built: {built}   Skipped: {skipped}   Failed: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
