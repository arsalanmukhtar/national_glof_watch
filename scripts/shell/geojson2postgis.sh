#!/usr/bin/env bash
# geojson2postgis.sh
#
# Load region GeoJSON files from data/geojsons/<region>/ into PostGIS using
# ogr2ogr. Produces nine target schemas:
#
#   rivers       — linear hydro features (river / run-off / nullah centerlines)
#   lakes        — glacial-lake polygons
#   risk_zones   — high / medium / low GLOF risk-zonation polygons
#   faultlines   — geological fault traces
#   glaciers     — glacier extent polygons
#   buildings    — building footprints (OSM-derived)
#   schools      — school points / polygons
#   roads        — road centerlines
#   secondary    — supporting / reference layers shared across regions
#                  (admin boundaries, all stations, glacial-lake inventory,
#                  AKAH partner data, populated places / settlements)
#
# Table naming convention:
#   rivers.<region>_river
#   lakes.<region>_lakes
#   risk_zones.<region>_high_risk_zone | _medium_risk_zone | _low_risk_zone
#   faultlines.<region>_faultline
#   glaciers.<region>_glacier
#   buildings.<region>_buildings
#   schools.<region>_schools
#   roads.<region>_roads
#   secondary.<descriptive_name>
#
# Usage (Git Bash / WSL / *nix shell — repo root):
#   bash scripts/shell/geojson2postgis.sh
#
# Override DB connection via env (defaults align with server/.env):
#   PGHOST=localhost PGPORT=5432 PGDATABASE=glof PGUSER=postgres \
#   PGPASSWORD=postgres bash scripts/shell/geojson2postgis.sh
#
# Requirements: GDAL ogr2ogr >= 3.0 and psql on PATH.
#
# Notes:
#   * The legacy regions badswat / darkot / gulmit / hinarchi / reshun /
#     sardar_gol / thalu still ship as .js global-declaration files under
#     data/geojsons/. They are skipped here — convert them to .geojson and
#     add load lines once that lands.
#   * brep ships a single brep_zonation.geojson with no high/med/low split,
#     so it is intentionally commented out below.
#   * Chatiboi has no published low-risk layer; only high + medium are loaded.

set -uo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-glof}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="$REPO_ROOT/data/geojsons"

PG_CONN="PG:host=$PGHOST port=$PGPORT dbname=$PGDATABASE user=$PGUSER password=$PGPASSWORD"

echo "[info] target db : $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
echo "[info] data dir  : $DATA_DIR"
echo

# ---- locate a full GDAL install (with the PostgreSQL output driver) --------
# PostgreSQL/PostGIS on Windows ships a stripped GDAL whose ogr2ogr lacks the
# PG driver — we need OSGeo4W or QGIS. Prepend its bin so its ogr2ogr/libpq
# win over anything else already on PATH.
GDAL_BIN_DIR=""
gdal_candidates=(
  "/c/OSGeo4W/bin"
  "/c/OSGeo4W64/bin"
)
# Pick up any QGIS install (any version, 32 or 64 bit, ltr or current).
for d in "/c/Program Files/QGIS"*"/bin" "/c/Program Files (x86)/QGIS"*"/bin"; do
  [[ -d "$d" ]] && gdal_candidates+=("$d")
done
for cand in "${gdal_candidates[@]}"; do
  if [[ -x "$cand/ogr2ogr.exe" ]]; then
    PATH="$cand:$PATH"
    GDAL_BIN_DIR="$cand"
    break
  fi
done

if ! command -v ogr2ogr >/dev/null 2>&1; then
  echo "[fatal] ogr2ogr not found. Install OSGeo4W (https://trac.osgeo.org/osgeo4w/)"
  echo "        or QGIS, then re-run."
  exit 1
fi

# Verify this ogr2ogr actually has the PostgreSQL output driver.
OGR_BIN=$(command -v ogr2ogr)
if ! "$OGR_BIN" --formats 2>&1 | grep -qi 'PostgreSQL'; then
  echo "[fatal] $OGR_BIN does not include the PostgreSQL driver."
  echo "        Install OSGeo4W's gdal-dev package or use QGIS's ogr2ogr."
  exit 1
fi

# ---- export PROJ_LIB / GDAL_DATA from that same GDAL install ----------------
# Override any pre-existing values — a stale GDAL_DATA pointing at the PG17
# stripped data dir will silently break this ogr2ogr.
GDAL_ROOT=""
[[ -n "$GDAL_BIN_DIR" ]] && GDAL_ROOT=$(dirname "$GDAL_BIN_DIR")
if [[ -n "$GDAL_ROOT" && -f "$GDAL_ROOT/share/proj/proj.db" ]]; then
  export PROJ_LIB="$GDAL_ROOT/share/proj"
fi
if [[ -n "$GDAL_ROOT" && -d "$GDAL_ROOT/share/gdal" ]]; then
  export GDAL_DATA="$GDAL_ROOT/share/gdal"
fi

# ---- locate Postgres client tools (psql, createdb) --------------------------
# Prefer the full PostgreSQL install (newer client) over whatever bundled psql
# happens to be on PATH. Use absolute paths so PATH order doesn't matter.
PSQL_BIN=""
CREATEDB_BIN=""
for ver in 17 16 15 14 13 12; do
  cand="/c/Program Files/PostgreSQL/$ver/bin"
  if [[ -x "$cand/psql.exe" ]]; then
    PSQL_BIN="$cand/psql.exe"
    CREATEDB_BIN="$cand/createdb.exe"
    break
  fi
done
if [[ -z "$PSQL_BIN" ]] && command -v psql >/dev/null 2>&1; then
  PSQL_BIN=$(command -v psql)
  CREATEDB_BIN=$(command -v createdb 2>/dev/null || true)
fi
if [[ -z "$PSQL_BIN" ]]; then
  echo "[fatal] psql not found. Install PostgreSQL client tools."
  exit 1
fi

echo "[info] ogr2ogr   : $OGR_BIN"
echo "[info] PROJ_LIB  : ${PROJ_LIB:-(unset)}"
echo "[info] GDAL_DATA : ${GDAL_DATA:-(unset)}"
echo "[info] psql      : $PSQL_BIN"
echo

# ---- ensure target database exists ------------------------------------------
# Probe the target db first. If reachable, skip the create dance entirely.
# connect_timeout=5 prevents an indefinite hang on auth/network issues.
TARGET_CONN="host=$PGHOST port=$PGPORT dbname=$PGDATABASE user=$PGUSER connect_timeout=5"
ADMIN_CONN="host=$PGHOST port=$PGPORT dbname=postgres user=$PGUSER connect_timeout=5"

echo "[info] probing target db..."
if "$PSQL_BIN" "$TARGET_CONN" -tAc 'SELECT 1' >/dev/null 2>/tmp/psql_probe.err; then
  echo "[info] database '$PGDATABASE' is reachable"
else
  echo "[info] target probe failed:"
  sed 's/^/        /' /tmp/psql_probe.err || true
  if ! "$PSQL_BIN" "$ADMIN_CONN" -tAc 'SELECT 1' >/dev/null 2>/tmp/psql_admin.err; then
    echo "[fatal] cannot connect to PG at $PGHOST:$PGPORT as $PGUSER."
    sed 's/^/        /' /tmp/psql_admin.err || true
    echo "        Check that Postgres is running, the port is right, and PGPASSWORD is set."
    exit 1
  fi
  db_exists=$("$PSQL_BIN" "$ADMIN_CONN" -tAc "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'")
  if [[ "$db_exists" != "1" ]]; then
    echo "[info] database '$PGDATABASE' missing — creating"
    if [[ -z "$CREATEDB_BIN" || ! -x "$CREATEDB_BIN" ]]; then
      "$PSQL_BIN" "$ADMIN_CONN" -c "CREATE DATABASE \"$PGDATABASE\""
    elif ! "$CREATEDB_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"; then
      echo "[fatal] could not create database '$PGDATABASE'."
      exit 1
    fi
  else
    echo "[fatal] database '$PGDATABASE' exists but the connection probe failed."
    echo "        Likely an auth issue — set PGPASSWORD and retry."
    exit 1
  fi
fi

# ---- ensure PostGIS + target schemas exist ----------------------------------
echo "[info] ensuring PostGIS + schemas..."
if ! "$PSQL_BIN" "$TARGET_CONN" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS rivers;
CREATE SCHEMA IF NOT EXISTS lakes;
CREATE SCHEMA IF NOT EXISTS risk_zones;
CREATE SCHEMA IF NOT EXISTS faultlines;
CREATE SCHEMA IF NOT EXISTS glaciers;
CREATE SCHEMA IF NOT EXISTS buildings;
CREATE SCHEMA IF NOT EXISTS schools;
CREATE SCHEMA IF NOT EXISTS roads;
CREATE SCHEMA IF NOT EXISTS secondary;
SQL
then
  echo "[fatal] schema bootstrap failed — aborting before ogr2ogr loads"
  exit 1
fi

OK_COUNT=0
FAIL_LIST=()

# ---- helper -----------------------------------------------------------------
load() {
  local src="$1"
  local table="$2"   # e.g. rivers.chatiboi_river

  if [[ ! -f "$src" ]]; then
    echo "  -> $table  SKIP (missing: ${src#$REPO_ROOT/})"
    FAIL_LIST+=("$table (missing source)")
    return
  fi

  echo "  -> $table  <-  ${src#$REPO_ROOT/}"
  if ogr2ogr \
      -f PostgreSQL "$PG_CONN" \
      "$src" \
      -nln "$table" \
      -nlt PROMOTE_TO_MULTI \
      -lco GEOMETRY_NAME=geom \
      -lco PRECISION=NO \
      -t_srs EPSG:4326 \
      -overwrite; then
    OK_COUNT=$((OK_COUNT + 1))
  else
    FAIL_LIST+=("$table")
  fi
}

# ---- rivers -----------------------------------------------------------------
echo "[rivers]"
load "$DATA_DIR/chatiboi/glof_chatiboi_run_off.geojson"         "rivers.chatiboi_river"
load "$DATA_DIR/chitral/chitral_river.geojson"                  "rivers.chitral_river"
load "$DATA_DIR/darkot/darkot_river.geojson"                    "rivers.darkot_river"
load "$DATA_DIR/gulmit/gulmit_rivers.geojson"                   "rivers.gulmit_river"
load "$DATA_DIR/ishokoman/ishkoman_river.geojson"               "rivers.ishokoman_river"
load "$DATA_DIR/reshun/nullah_reshun.geojson"                   "rivers.reshun_river"
load "$DATA_DIR/terset_hundur/glof_river_terset_hundur.geojson" "rivers.terset_hundur_river"

# ---- lakes ------------------------------------------------------------------
echo
echo "[lakes]"
load "$DATA_DIR/badswat/badswat_lake.geojson"                   "lakes.badswat_lakes"
load "$DATA_DIR/chatiboi/glof_chatiboi_lake.geojson"            "lakes.chatiboi_lakes"
load "$DATA_DIR/hinarchi/hinarchi_lake.geojson"                 "lakes.hinarchi_lakes"
load "$DATA_DIR/karambar/karambar_lake.geojson"                 "lakes.karambar_lakes"
load "$DATA_DIR/pindoru_chaat/glof_pindoru_chaat_lake.geojson"  "lakes.pindoru_chaat_lakes"
load "$DATA_DIR/shisper/glof_shisper_lake.geojson"              "lakes.shisper_lakes"
load "$DATA_DIR/terset_hundur/glof_lakes_terset_hundur.geojson" "lakes.terset_hundur_lakes"

# ---- risk zones -------------------------------------------------------------
echo
echo "[risk_zones]"

# Regions whose risk zones were extracted from a single combined source via
# scripts/python/split_zonation.py — see each *_riskzones.geojson / *_zonation.geojson.
load "$DATA_DIR/badswat/glof_badswat_high.geojson"   "risk_zones.badswat_high_risk_zone"
load "$DATA_DIR/badswat/glof_badswat_medium.geojson" "risk_zones.badswat_medium_risk_zone"
load "$DATA_DIR/badswat/glof_badswat_low.geojson"    "risk_zones.badswat_low_risk_zone"

load "$DATA_DIR/brep/glof_brep_high.geojson"   "risk_zones.brep_high_risk_zone"
load "$DATA_DIR/brep/glof_brep_medium.geojson" "risk_zones.brep_medium_risk_zone"
load "$DATA_DIR/brep/glof_brep_low.geojson"    "risk_zones.brep_low_risk_zone"

load "$DATA_DIR/darkot/glof_darkot_high.geojson"   "risk_zones.darkot_high_risk_zone"
load "$DATA_DIR/darkot/glof_darkot_medium.geojson" "risk_zones.darkot_medium_risk_zone"
load "$DATA_DIR/darkot/glof_darkot_low.geojson"    "risk_zones.darkot_low_risk_zone"

load "$DATA_DIR/gulmit/glof_gulmit_high.geojson"   "risk_zones.gulmit_high_risk_zone"
load "$DATA_DIR/gulmit/glof_gulmit_medium.geojson" "risk_zones.gulmit_medium_risk_zone"
load "$DATA_DIR/gulmit/glof_gulmit_low.geojson"    "risk_zones.gulmit_low_risk_zone"

load "$DATA_DIR/hinarchi/glof_hinarchi_high.geojson"   "risk_zones.hinarchi_high_risk_zone"
load "$DATA_DIR/hinarchi/glof_hinarchi_medium.geojson" "risk_zones.hinarchi_medium_risk_zone"
load "$DATA_DIR/hinarchi/glof_hinarchi_low.geojson"    "risk_zones.hinarchi_low_risk_zone"

load "$DATA_DIR/reshun/glof_reshun_high.geojson"   "risk_zones.reshun_high_risk_zone"
load "$DATA_DIR/reshun/glof_reshun_medium.geojson" "risk_zones.reshun_medium_risk_zone"
load "$DATA_DIR/reshun/glof_reshun_low.geojson"    "risk_zones.reshun_low_risk_zone"

# Chatiboi — no published low-risk layer.
load "$DATA_DIR/chatiboi/glof_high_risk_chatiboi.geojson"   "risk_zones.chatiboi_high_risk_zone"
load "$DATA_DIR/chatiboi/glof_medium_risk_chatiboi.geojson" "risk_zones.chatiboi_medium_risk_zone"

# Ishokoman
load "$DATA_DIR/ishokoman/glof_ishokoman_high.geojson"   "risk_zones.ishokoman_high_risk_zone"
load "$DATA_DIR/ishokoman/glof_ishokoman_medium.geojson" "risk_zones.ishokoman_medium_risk_zone"
load "$DATA_DIR/ishokoman/glof_ishokoman_low.geojson"    "risk_zones.ishokoman_low_risk_zone"

# Lusht
load "$DATA_DIR/lusht/glof_lusht_high.geojson"   "risk_zones.lusht_high_risk_zone"
load "$DATA_DIR/lusht/glof_lusht_medium.geojson" "risk_zones.lusht_medium_risk_zone"
load "$DATA_DIR/lusht/glof_lusht_low.geojson"    "risk_zones.lusht_low_risk_zone"

# Pindoru Chaat
load "$DATA_DIR/pindoru_chaat/glof_pindoru_chaat_high_risk.geojson"   "risk_zones.pindoru_chaat_high_risk_zone"
load "$DATA_DIR/pindoru_chaat/glof_pindoru_chaat_medium_risk.geojson" "risk_zones.pindoru_chaat_medium_risk_zone"
load "$DATA_DIR/pindoru_chaat/glof_pindoru_chaat_low_risk.geojson"    "risk_zones.pindoru_chaat_low_risk_zone"

# Shisper
load "$DATA_DIR/shisper/glof_shisper_high.geojson"   "risk_zones.shisper_high_risk_zone"
load "$DATA_DIR/shisper/glof_shisper_medium.geojson" "risk_zones.shisper_medium_risk_zone"
load "$DATA_DIR/shisper/glof_shisper_low.geojson"    "risk_zones.shisper_low_risk_zone"

# Terset Hundur
load "$DATA_DIR/terset_hundur/glof_high_terset_hundur.geojson"   "risk_zones.terset_hundur_high_risk_zone"
load "$DATA_DIR/terset_hundur/glof_medium_terset_hundur.geojson" "risk_zones.terset_hundur_medium_risk_zone"
load "$DATA_DIR/terset_hundur/glof_low_terset_hundur.geojson"    "risk_zones.terset_hundur_low_risk_zone"

# Ultar
load "$DATA_DIR/ultar/glof_high_risk_ultar_lake.geojson"   "risk_zones.ultar_high_risk_zone"
load "$DATA_DIR/ultar/glof_medium_risk_ultar_lake.geojson" "risk_zones.ultar_medium_risk_zone"
load "$DATA_DIR/ultar/glof_low_risk_ultar_lake.geojson"    "risk_zones.ultar_low_risk_zone"

# Sardar Gol — source uses Sardar_Gol1/2/3 (high/medium/low). Split via
# scripts/python/split_zonation.py with --map "Sardar_Gol1=high,...".
load "$DATA_DIR/sardar_gol/glof_sardar_gol_high.geojson"   "risk_zones.sardar_gol_high_risk_zone"
load "$DATA_DIR/sardar_gol/glof_sardar_gol_medium.geojson" "risk_zones.sardar_gol_medium_risk_zone"
load "$DATA_DIR/sardar_gol/glof_sardar_gol_low.geojson"    "risk_zones.sardar_gol_low_risk_zone"

# ---- faultlines -------------------------------------------------------------
echo
echo "[faultlines]"
load "$DATA_DIR/badswat/badswat_faultline.geojson"  "faultlines.badswat_faultline"
load "$DATA_DIR/reshun/faultline_reshun.geojson"    "faultlines.reshun_faultline"

# ---- glaciers ---------------------------------------------------------------
echo
echo "[glaciers]"
load "$DATA_DIR/badswat/badswat_glaciers.geojson" "glaciers.badswat_glacier"
load "$DATA_DIR/darkot/darkot_glaciers.geojson"   "glaciers.darkot_glacier"
load "$DATA_DIR/reshun/glacier_reshun.geojson"    "glaciers.reshun_glacier"

# ---- buildings (OSM-derived footprints) -------------------------------------
echo
echo "[buildings]"
load "$DATA_DIR/darkot/darkot_buildings.geojson" "buildings.darkot_buildings"
load "$DATA_DIR/gulmit/gulmit_buildings.geojson" "buildings.gulmit_buildings"

# ---- schools ----------------------------------------------------------------
echo
echo "[schools]"
load "$DATA_DIR/darkot/darkot_schools.geojson" "schools.darkot_schools"
load "$DATA_DIR/gulmit/gulmit_schools.geojson" "schools.gulmit_schools"

# ---- roads ------------------------------------------------------------------
echo
echo "[roads]"
load "$DATA_DIR/gulmit/gulmit_roads.geojson" "roads.gulmit_roads"

# ---- secondary (shared reference layers) ------------------------------------
echo
echo "[secondary]"

# Administrative boundaries
load "$DATA_DIR/administrative_boundaries/pak_boundaries_national_boundary.geojson"     "secondary.national_boundary"
load "$DATA_DIR/administrative_boundaries/pak_boundaries_provincial_boundary.geojson"   "secondary.provincial_boundary"
load "$DATA_DIR/administrative_boundaries/pak_boundaries_district_boundary_updated.geojson" "secondary.district_boundary"

# AKAH (Aga Khan Agency for Habitat) partner data
load "$DATA_DIR/akah/glof_akahp_infrastructure_data_final.geojson" "secondary.akah_infrastructure"
load "$DATA_DIR/akah/glof_akahp_hazardexposure_final.geojson"      "secondary.akah_hazard_exposure"

# All EWS stations (point inventory)
load "$DATA_DIR/all_stations/glof_stations.geojson" "secondary.all_stations"

# National glacial-lake inventory
load "$DATA_DIR/glaciel_lakes/glaciel_lakes.geojson" "secondary.glacial_lakes"

# Populated places / settlements
load "$DATA_DIR/settlements/settlements.geojson" "secondary.settlements"

echo
echo "[done] $OK_COUNT ok / ${#FAIL_LIST[@]} failed"
if (( ${#FAIL_LIST[@]} > 0 )); then
  echo "[failures]"
  for t in "${FAIL_LIST[@]}"; do
    echo "  - $t"
  done
  exit 1
fi
