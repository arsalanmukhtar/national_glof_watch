#!/usr/bin/env python3
"""Fetch GeoServer WFS layers and persist them as GeoJSON files.

Output goes to ``data/geoserver/<workspace>_<typename>.geojson``. Existing
files are overwritten in place.

The GeoServer host (``172.18.1.85:8080``) lives on a private internal LAN —
running this script off-network will fail with a connection error for every
layer.

Usage (from repo root):
    python scripts/fetch_geoserver_layers.py
    python scripts/fetch_geoserver_layers.py --only Ultar,Shisper
    python scripts/fetch_geoserver_layers.py --base-url http://other-host:8080/geoserver
    python scripts/fetch_geoserver_layers.py --out tmp/geo --insecure

Stdlib only — no extra ``pip install`` needed.
"""
from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = "http://172.18.1.85:8080/geoserver"

# (workspace, typeName, human label) — order is preserved in the run log.
# Note: the upstream layer name "Medium_Risk_Zonation" appears to be the
# Chatiboi medium-risk polygon; there is no published Chatiboi low-risk
# layer at the time of writing, so the set is intentionally incomplete.
LAYERS: list[tuple[str, str, str]] = [
    # National & administrative boundaries
    ("Pak_Boundaries", "National_Boundary", "National Boundary"),
    ("Pak_Boundaries", "Provincial_Boundary", "Provincial Boundary"),
    ("Pak_Boundaries", "District_Boundary_Updated", "District Boundary (Updated)"),

    # GLOF inventory + partner data
    ("GLOF", "HKH_PK", "Glacial Lakes Inventory (HKH_PK)"),
    ("GLOF", "AKAHP_Infrastructure_Data_Final", "AKAH Infrastructure"),
    ("GLOF", "Populated-Points-North", "Populated Places (North)"),
    ("GLOF", "GMRC_Points", "GMRC WAPDA Points"),
    ("GLOF", "stations", "GLOF II Stations"),
    ("GLOF", "Damage_Stations", "GLOF II Damaged Stations"),
    ("GLOF", "AKAHP_HazardExposure_Final", "AKAH Hazard Exposure"),

    # Terset Hundur — lake / river / risk zonation
    ("GLOF", "lakes_THundur", "Terset Hundur — Lakes"),
    ("GLOF", "River_THundur", "Terset Hundur — River"),
    ("GLOF", "High_THundur", "Terset Hundur — High Risk"),
    ("GLOF", "Medium_THundur", "Terset Hundur — Medium Risk"),
    ("GLOF", "Low_THundur", "Terset Hundur — Low Risk"),

    # Ishokoman risk zonation
    ("GLOF", "Ishokoman_High", "Ishokoman — High Risk"),
    ("GLOF", "Ishokoman_Medium", "Ishokoman — Medium Risk"),
    ("GLOF", "Ishokoman_Low", "Ishokoman — Low Risk"),

    # Lusht risk zonation
    ("GLOF", "Lusht_High", "Lusht — High Risk"),
    ("GLOF", "Lusht_Medium", "Lusht — Medium Risk"),
    ("GLOF", "Lusht_Low", "Lusht — Low Risk"),

    # Ultar Lake risk zonation
    ("GLOF", "High_Risk_Ultar_Lake", "Ultar Lake — High Risk"),
    ("GLOF", "Medium_Risk_Ultar_Lake", "Ultar Lake — Medium Risk"),
    ("GLOF", "Low_Risk_Ultar_Lake", "Ultar Lake — Low Risk"),

    # Shisper area (lake + risk zonation)
    ("GLOF", "Shisper_Lake", "Shisper — Lake"),
    ("GLOF", "Shisper_High", "Shisper — High Risk"),
    ("GLOF", "Shisper_Medium", "Shisper — Medium Risk"),
    ("GLOF", "Shisper_Low", "Shisper — Low Risk"),

    # Chatiboi area (lake + run-off + partial risk zonation)
    ("GLOF", "Chatiboi_Lake", "Chatiboi — Lake"),
    ("GLOF", "Chatiboi_Run_Off", "Chatiboi — Run-off"),
    ("GLOF", "High_Risk_Chatiboi", "Chatiboi — High Risk"),
    ("GLOF", "Medium_Risk_Zonation", "Chatiboi — Medium Risk"),

    # Pindoru Chaat area (lake + risk zonation)
    ("GLOF", "Pindoru_Chaat_Lake", "Pindoru Chaat — Lake"),
    ("GLOF", "Pindoru_Chaat_High_Risk", "Pindoru Chaat — High Risk"),
    ("GLOF", "Pindoru_Chaat_Medium_Risk", "Pindoru Chaat — Medium Risk"),
    ("GLOF", "Pindoru_Chaat_Low_Risk", "Pindoru Chaat — Low Risk"),
]


def build_url(base_url: str, workspace: str, type_name: str) -> str:
    qs = urllib.parse.urlencode({
        "service": "WFS",
        "version": "1.0.0",
        "request": "GetFeature",
        "typeName": f"{workspace}:{type_name}",
        "outputFormat": "application/json",
    })
    return f"{base_url.rstrip('/')}/{workspace}/ows?{qs}"


def file_safe(workspace: str, type_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", f"{workspace}_{type_name}".lower()).strip("_")


def fetch(url: str, timeout: float, ctx: ssl.SSLContext) -> bytes:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return resp.read()


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Fetch GeoServer WFS layers and write them as GeoJSON files.",
    )
    ap.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"GeoServer base URL (default: {DEFAULT_BASE_URL})",
    )
    ap.add_argument(
        "--out",
        default=None,
        help="Output directory (default: <repo>/data/geoserver)",
    )
    ap.add_argument("--timeout", type=float, default=60.0, help="Per-request timeout in seconds")
    ap.add_argument(
        "--only",
        default=None,
        help="Comma-separated substrings; keep only typeNames matching one of them",
    )
    ap.add_argument(
        "--insecure",
        action="store_true",
        help="Skip TLS cert verification (only relevant for https base URLs)",
    )
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    out_dir = Path(args.out) if args.out else repo_root / "data" / "geoserver"
    out_dir.mkdir(parents=True, exist_ok=True)

    ctx = ssl._create_unverified_context() if args.insecure else ssl.create_default_context()

    only_filters: list[str] | None = None
    if args.only:
        only_filters = [s.strip().lower() for s in args.only.split(",") if s.strip()]

    seen: set[tuple[str, str]] = set()
    queue: list[tuple[str, str, str]] = []
    for ws, tn, label in LAYERS:
        key = (ws, tn)
        if key in seen:
            continue
        seen.add(key)
        if only_filters and not any(s in tn.lower() for s in only_filters):
            continue
        queue.append((ws, tn, label))

    print(f"[info] base url   : {args.base_url}")
    print(f"[info] output dir : {out_dir}")
    print(f"[info] layers     : {len(queue)}")
    print()

    ok = 0
    failures: list[tuple[str, str]] = []

    for ws, tn, label in queue:
        url = build_url(args.base_url, ws, tn)
        out_path = out_dir / f"{file_safe(ws, tn)}.geojson"
        sys.stdout.write(f"  -> {ws}:{tn:<38s} ")
        sys.stdout.flush()
        start = time.perf_counter()
        try:
            body = fetch(url, args.timeout, ctx)
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"non-JSON response ({len(body)} bytes): {exc}") from exc

            features = parsed.get("features") if isinstance(parsed, dict) else None
            n_features = len(features) if isinstance(features, list) else 0

            out_path.write_text(
                json.dumps(parsed, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            ms = int((time.perf_counter() - start) * 1000)
            print(
                f"OK  {n_features:>5d} feat  {len(body):>9,d} B  {ms:>5d} ms  -> {out_path.name}"
            )
            ok += 1
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, TimeoutError, OSError) as exc:
            ms = int((time.perf_counter() - start) * 1000)
            print(f"FAIL {ms:>5d} ms  -> {exc}")
            failures.append((f"{ws}:{tn}", str(exc)))

    print()
    print(f"[done] {ok} ok / {len(failures)} failed (out of {len(queue)})")
    if failures:
        print("[failures]")
        for name, msg in failures:
            print(f"  - {name}: {msg}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
