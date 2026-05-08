#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Runs ON THE VM. Pulls the latest prod branch, rebuilds images, and
# brings the stack up. Idempotent — safe to re-run.
#
# Workflow:
#   1. Ensure /opt/glof/{db,rasters,db-imports} exist with sane perms.
#   2. git fetch + checkout prod (creates the branch on first run).
#   3. docker compose build (uses cache where it can).
#   4. docker compose up -d (recreates only the containers whose
#      image hashes changed — Postgres usually stays put).
#   5. Print the running state.
#
# This script does NOT touch the database — schema migrations come
# from the backend's `ensureSchema()` on boot, and data restoration
# is a separate one-shot via vm-seed-db.sh.
#
# Usage:
#   ./scripts/deploy/vm-deploy.sh                # full flow
#   ./scripts/deploy/vm-deploy.sh --no-build     # skip rebuild (config-only update)
#   ./scripts/deploy/vm-deploy.sh --no-pull      # use the currently checked-out tree
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

NO_BUILD=0
NO_PULL=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --no-pull)  NO_PULL=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# Bind-mount targets used by docker-compose.prod.yml. Created up
# front so the very first `docker compose up` doesn't trip on a
# missing path. The directories live under /opt/glof so a single
# rsync target covers all of prod's persistent state.
echo "[vm-deploy] Ensuring /opt/glof tree exists..."
sudo mkdir -p /opt/glof/db /opt/glof/rasters /opt/glof/db-imports
# Postgres-in-container expects its data dir owned by uid 999
# (the postgres user inside postgres:17-alpine). The other dirs are
# rw-only for the deploy user.
sudo chown -R 999:999 /opt/glof/db
sudo chown -R "$(id -u):$(id -g)" /opt/glof/rasters /opt/glof/db-imports

# Refuse to run if .env is missing — without it the build args are
# blank and the frontend ships without the Mapbox token.
if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "[vm-deploy] $ROOT_DIR/.env is missing."
  echo "[vm-deploy] Copy .env.example to .env and fill in production values"
  echo "[vm-deploy] (especially VITE_MAPBOX_TOKEN, PG_PASSWORD)."
  exit 1
fi

if [[ "$NO_PULL" -ne 1 ]]; then
  echo "[vm-deploy] Fetching latest prod branch..."
  git fetch origin

  if git show-ref --verify --quiet refs/heads/prod; then
    git checkout prod
    git pull --ff-only origin prod
  else
    git checkout -b prod origin/prod
  fi
fi

CURRENT_REV="$(git rev-parse --short HEAD)"
echo "[vm-deploy] At commit $CURRENT_REV ($(git log -1 --pretty=%s))"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

if [[ "$NO_BUILD" -ne 1 ]]; then
  echo "[vm-deploy] Building images..."
  "${COMPOSE[@]}" build
fi

echo "[vm-deploy] Bringing the stack up..."
"${COMPOSE[@]}" up -d

echo "[vm-deploy] Current state:"
"${COMPOSE[@]}" ps

echo "[vm-deploy] OK — deployed $CURRENT_REV"
