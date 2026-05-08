#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Runs ON THE VM. Restores a plain-SQL dump (typically pushed by
# sync-db-dump.sh) into the running Postgres container.
#
# This is the ONLY script that drops + recreates the production DB.
# Confirms before doing anything destructive.
#
# Workflow:
#   1. Locate the dump (argument, or newest in /opt/glof/db-imports/).
#   2. Verify the db service is running.
#   3. Confirm with the operator (skip with --yes).
#   4. Stream the dump into psql inside the db container, connecting
#      to the maintenance DB so DROP/CREATE DATABASE in the dump can
#      run without "cannot drop currently open database" errors.
#   5. Print row counts so the operator can sanity-check the load.
#
# Usage:
#   ./scripts/deploy/vm-seed-db.sh                              # newest dump
#   ./scripts/deploy/vm-seed-db.sh /opt/glof/db-imports/x.sql   # explicit
#   ./scripts/deploy/vm-seed-db.sh --yes                        # no prompt
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

ASSUME_YES=0
DUMP_FILE=""
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -*)       echo "Unknown flag: $arg" >&2; exit 1 ;;
    *)        DUMP_FILE="$arg" ;;
  esac
done

if [[ -z "$DUMP_FILE" ]]; then
  DUMP_FILE="$(ls -t /opt/glof/db-imports/*.sql 2>/dev/null | head -n 1 || true)"
  if [[ -z "$DUMP_FILE" ]]; then
    echo "[vm-seed-db] No dump found in /opt/glof/db-imports/"
    echo "[vm-seed-db] Push one from dev with scripts/deploy/sync-db-dump.sh"
    exit 1
  fi
  echo "[vm-seed-db] Using newest dump: $DUMP_FILE"
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "[vm-seed-db] Dump file not found: $DUMP_FILE"
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

# Sanity-check that db is up before we start streaming.
if ! "${COMPOSE[@]}" ps --status running --services | grep -qx db; then
  echo "[vm-seed-db] db service is not running. Start the stack first:"
  echo "  ./scripts/deploy/vm-deploy.sh"
  exit 1
fi

PG_USER="${PG_USER:-postgres}"
PG_DATABASE="${PG_DATABASE:-glof}"
# Pull from .env if present so the prompt shows what the user
# actually configured, not the fallback default.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  . .env
  set +a
fi

echo "[vm-seed-db] About to restore into the prod database:"
echo "  user:     ${PG_USER}"
echo "  database: ${PG_DATABASE}"
echo "  dump:     ${DUMP_FILE}"
echo "[vm-seed-db] This DROPS the existing schema and reloads from the dump."

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Continue? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

# The backend container holds an open session against the target DB
# via its connection pool, which makes the dump's DROP DATABASE fail
# with "is being accessed by other users". Stop backend before the
# restore and bring it back up after — `trap` ensures we restart it
# even if psql aborts mid-stream.
BACKEND_WAS_RUNNING=0
if "${COMPOSE[@]}" ps --status running --services | grep -qx backend; then
  BACKEND_WAS_RUNNING=1
  echo "[vm-seed-db] Stopping backend so DROP DATABASE can run..."
  "${COMPOSE[@]}" stop backend
fi

restart_backend() {
  if [[ "$BACKEND_WAS_RUNNING" -eq 1 ]]; then
    echo "[vm-seed-db] Restarting backend..."
    "${COMPOSE[@]}" start backend
  fi
}
trap restart_backend EXIT

# Stream the dump into the db container. Connecting to the
# maintenance `postgres` DB lets DROP DATABASE in the dump succeed —
# you can't drop a DB you're connected to.
"${COMPOSE[@]}" exec -T db psql \
  --username="$PG_USER" \
  --dbname=postgres \
  --set ON_ERROR_STOP=1 \
  --quiet < "$DUMP_FILE"

echo "[vm-seed-db] Restore complete. Row counts:"
"${COMPOSE[@]}" exec -T db psql \
  --username="$PG_USER" \
  --dbname="$PG_DATABASE" \
  --tuples-only \
  --command="SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

echo "[vm-seed-db] OK"
