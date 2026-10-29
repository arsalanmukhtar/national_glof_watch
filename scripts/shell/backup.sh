#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# backup.sh — capture everything another developer needs to bring up an
# identical working copy of this app on a different machine.
#
# What a backup contains:
#   • db.sql       — plain-SQL pg_dump of the Postgres database
#                    (--clean --create so it restores into a fresh server
#                    without any prep). Taken from the running Docker
#                    container when it's up, else from the host pg_dump.
#   • rasters/     — the whole data/rasters/ tree, minus the
#                    data/rasters/analysis/ subdirectory which is a
#                    regenerable Sentinel-2 cache (keyed by request
#                    hash — the other machine recomputes on demand).
#   • MANIFEST.txt — git commit + branch at backup time, host info,
#                    sizes. Lets the receiver confirm what they got.
#
# What a backup DOES NOT contain:
#   • The code itself (that's git — the receiver `git clone`s separately
#     and switches to the right branch before running deploy.sh).
#   • .env (secrets — the receiver creates their own, deploy.sh scaffolds).
#   • node_modules / .venv / dist (regenerable from package manifests on
#     the receiver side).
#
# The output is a single `.tar.gz` under `backups/` so transferring it
# is one `scp` / drag-drop / usb-stick action.
#
# Usage:
#   ./scripts/shell/backup.sh
#
# Env overrides (otherwise read from .env, else from built-in defaults):
#   PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# ---------------------------------------------------------------------------
# Load .env (same lightweight parser pattern as scripts/db/backup.sh —
# honours inline overrides, ignores blank lines + comments, doesn't
# require `source` which chokes on values containing special chars).
# ---------------------------------------------------------------------------
if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="$(echo "$key" | tr -d '[:space:]')"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$ROOT_DIR/.env"
fi

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_DATABASE="${PG_DATABASE:-glof}"
PG_USER="${PG_USER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
BUNDLE_NAME="glof-$STAMP"
BUNDLE_DIR="$ROOT_DIR/backups/$BUNDLE_NAME"
BUNDLE_TAR="$ROOT_DIR/backups/$BUNDLE_NAME.tar.gz"

mkdir -p "$ROOT_DIR/backups"
mkdir -p "$BUNDLE_DIR/rasters"

# Cleanup intermediate dir even if we fail halfway through — the tarball
# is the deliverable, the staging dir is not.
cleanup() {
  rm -rf "$BUNDLE_DIR"
}
trap cleanup EXIT

echo "[backup] staging in $BUNDLE_DIR"

# ---------------------------------------------------------------------------
# 1. DB dump
#
# Prefer the Dockerised Postgres because that's what runs in Docker
# Compose (compose's db service, image postgis/postgis:17-3.5-alpine).
# `docker compose ps -q db` resolves to the container id regardless of
# the compose project name, so renaming the clone directory on the
# receiver doesn't matter. Falls back to host `pg_dump` if the
# container isn't up (dev machine without compose running).
# ---------------------------------------------------------------------------
DB_CONTAINER=""
if command -v docker >/dev/null 2>&1; then
  DB_CONTAINER="$(docker compose ps -q db 2>/dev/null || true)"
fi

if [[ -n "$DB_CONTAINER" ]] && docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "[backup] dumping db via docker container $DB_CONTAINER"
  docker exec \
    -e PGPASSWORD="$PG_PASSWORD" \
    "$DB_CONTAINER" \
    pg_dump \
      --username="$PG_USER" \
      --dbname="$PG_DATABASE" \
      --format=plain \
      --no-owner \
      --no-acl \
      --clean \
      --if-exists \
      --create \
      --quote-all-identifiers \
    > "$BUNDLE_DIR/db.sql"
elif command -v pg_dump >/dev/null 2>&1; then
  echo "[backup] docker container not running — dumping via host pg_dump"
  PGPASSWORD="$PG_PASSWORD" pg_dump \
    --host="$PG_HOST" \
    --port="$PG_PORT" \
    --username="$PG_USER" \
    --dbname="$PG_DATABASE" \
    --format=plain \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --create \
    --quote-all-identifiers \
    --file="$BUNDLE_DIR/db.sql"
else
  echo "[backup] ERROR: neither a running compose db container nor a host pg_dump is available." >&2
  echo "[backup]        Start the stack (docker compose up -d db) or install postgresql-client." >&2
  exit 1
fi

DB_SIZE_BYTES="$(wc -c < "$BUNDLE_DIR/db.sql")"
echo "[backup] db.sql: $DB_SIZE_BYTES bytes"

# ---------------------------------------------------------------------------
# 2. Rasters
#
# data/rasters/ holds every uploaded GeoTIFF — these are user-owned
# and must survive the clone. data/rasters/analysis/ is excluded
# because it's a per-request cache for the on-demand Sentinel-2
# pipeline; the receiver can regenerate any entry by re-posting the
# same AOI + windows + index to /api/analysis/sentinel.
# ---------------------------------------------------------------------------
if [[ -d "$ROOT_DIR/data/rasters" ]]; then
  echo "[backup] copying rasters (excluding analysis/ cache)"
  # rsync is nicer but not guaranteed on Windows Git Bash. tar | tar
  # with --exclude works everywhere bash does.
  (
    cd "$ROOT_DIR/data"
    tar --exclude='rasters/analysis' -cf - rasters
  ) | ( cd "$BUNDLE_DIR" && tar -xf - )
  RASTER_COUNT="$(find "$BUNDLE_DIR/rasters" -type f | wc -l | tr -d ' ')"
  RASTER_BYTES="$(du -sb "$BUNDLE_DIR/rasters" 2>/dev/null | cut -f1 || echo 0)"
  echo "[backup] rasters: $RASTER_COUNT files, $RASTER_BYTES bytes"
else
  echo "[backup] no data/rasters/ on this machine — skipping"
  RASTER_COUNT=0
  RASTER_BYTES=0
fi

# ---------------------------------------------------------------------------
# 3. Manifest
# ---------------------------------------------------------------------------
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY="$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
HOST_INFO="$(uname -a 2>/dev/null || echo unknown)"

cat > "$BUNDLE_DIR/MANIFEST.txt" <<EOF
backup_time_utc:   $STAMP
git_sha:           $GIT_SHA
git_branch:        $GIT_BRANCH
git_uncommitted:   $GIT_DIRTY file(s)
host:              $HOST_INFO
pg_database:       $PG_DATABASE
pg_user:           $PG_USER
db_bytes:          $DB_SIZE_BYTES
raster_files:      $RASTER_COUNT
raster_bytes:      $RASTER_BYTES
bundle_name:       $BUNDLE_NAME.tar.gz

Contents of this bundle:
  db.sql            — plain-SQL pg_dump (--clean --create). Restore with:
                        psql -U postgres -d postgres -f db.sql
                      Or let scripts/shell/deploy.sh auto-restore it.
  rasters/          — uploaded GeoTIFFs. Copy into data/rasters/ on the
                      receiving machine.
  MANIFEST.txt      — this file.

NOT included (regenerate on receiver):
  code              — git clone + checkout the branch stated above
  node_modules/     — npm install
  .venv/            — python -m venv .venv && pip install -r scripts/python/requirements.txt
  dist/             — vite build (docker compose builds this inside the frontend image)
  .env              — scripts/shell/deploy.sh scaffolds an empty one on first run
  data/rasters/analysis/ — Sentinel-2 analysis cache, regenerable on demand
EOF

# ---------------------------------------------------------------------------
# 4. Package
#
# Single .tar.gz under backups/. Transfer it however (scp, rsync,
# cloud storage, USB) to the receiving machine's backups/ folder,
# then run scripts/shell/deploy.sh there.
# ---------------------------------------------------------------------------
echo "[backup] packaging $BUNDLE_TAR"
tar -czf "$BUNDLE_TAR" -C "$ROOT_DIR/backups" "$BUNDLE_NAME"

TAR_SIZE="$(du -h "$BUNDLE_TAR" | cut -f1)"
echo
echo "[backup] DONE"
echo "[backup]   bundle: $BUNDLE_TAR ($TAR_SIZE)"
echo "[backup]   transfer this file to the other machine's backups/ folder,"
echo "[backup]   then run: ./scripts/shell/deploy.sh"
