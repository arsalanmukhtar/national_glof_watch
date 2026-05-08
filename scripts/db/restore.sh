#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Restore a plain-SQL dump produced by `./scripts/db/backup.sh`.
#
# Usage:
#   ./scripts/db/restore.sh path/to/dump.sql
#   ./scripts/db/restore.sh                 # picks the newest file in backups/
#
# Reads connection details from `.env` (same as backup.sh). Because the
# dump uses --clean --if-exists --create, a fresh server can be seeded
# from this file alone — but be aware: it WILL drop the existing
# database tables before re-creating them. The script prompts before
# proceeding unless ASSUME_YES=1 is set.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
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

DUMP_FILE="${1:-}"
if [[ -z "$DUMP_FILE" ]]; then
  # Pick the newest .sql in backups/.
  DUMP_FILE="$(ls -t "$ROOT_DIR/backups"/*.sql 2>/dev/null | head -n 1 || true)"
  if [[ -z "$DUMP_FILE" ]]; then
    echo "[restore] No dump file passed and no .sql files in $ROOT_DIR/backups/"
    echo "[restore] Usage: $0 path/to/dump.sql"
    exit 1
  fi
  echo "[restore] No file argument - using newest dump: $DUMP_FILE"
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "[restore] Dump file not found: $DUMP_FILE"
  exit 1
fi

echo "[restore] Target: ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}"
echo "[restore] Source: $DUMP_FILE"
echo "[restore] This will DROP and recreate the existing schema."

if [[ "${ASSUME_YES:-0}" != "1" ]]; then
  read -r -p "Continue? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

# We connect to `postgres` (the maintenance DB) so the dump's
# DROP DATABASE / CREATE DATABASE statements can run — you can't drop
# a DB you're currently connected to.
PGPASSWORD="${PG_PASSWORD:-}" psql \
  --host="$PG_HOST" \
  --port="$PG_PORT" \
  --username="$PG_USER" \
  --dbname=postgres \
  --set ON_ERROR_STOP=1 \
  --file="$DUMP_FILE"

echo "[restore] OK"
