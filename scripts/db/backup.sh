#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Plain-SQL backup of the GLOF Postgres database.
#
# Why plain SQL (and not custom / directory format):
#   • inspectable in any text editor — schema + data live in one file.
#   • restorable with `psql` alone, no `pg_restore` round-trip needed.
#   • fits the dev-to-prod migration story: the same dump can seed a
#     fresh container on the VM, be diffed against schema.sql, or be
#     committed as a one-off snapshot for review.
#
# Reads connection details from `.env` at the repo root, falling back
# to the same defaults the backend uses (server/lib/db.js). Override
# any variable inline:
#   PG_DATABASE=glof_prod ./scripts/db/backup.sh
# ---------------------------------------------------------------------------
set -euo pipefail

# Resolve repo root so the script can be invoked from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env if present. We use a small awk filter so blank lines and
# comments don't pollute the environment, and quoted values stay
# intact. Inline overrides (PG_HOST=… ./backup.sh) take precedence
# because we only set variables that aren't already defined.
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
# PG_PASSWORD stays optional — pg_dump picks it up via PGPASSWORD env var.

OUT_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$OUT_DIR/${PG_DATABASE}_${STAMP}.sql"

echo "[backup] Dumping ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}"
echo "[backup]   -> $OUT_FILE"

# Flags chosen for portability + idempotent restore:
#   --format=plain      : human-readable .sql (the entire point of this script)
#   --no-owner          : drop OWNER TO statements so the dump restores
#                         cleanly into a DB owned by a different role
#   --no-acl            : strip GRANT / REVOKE for the same reason
#   --clean --if-exists : prepend DROP IF EXISTS for a clean re-import
#   --create            : include CREATE DATABASE so a fresh server can
#                         be seeded from this file alone
#   --quote-all-identifiers : safer round-trip across pg versions
PGPASSWORD="${PG_PASSWORD:-}" pg_dump \
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
  --file="$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "[backup] OK - $SIZE"
echo "[backup] Restore with: ./scripts/db/restore.sh \"$OUT_FILE\""
