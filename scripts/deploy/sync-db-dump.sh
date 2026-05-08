#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Take a fresh DB dump locally and push it to the VM.
#
# Intended use:
#   • One-time seeding of a fresh prod DB from dev data.
#   • Disaster-recovery refresh — overwrite an empty / corrupted prod DB.
#
# This script DOES NOT auto-restore on the VM. It only puts the file
# in place under /opt/glof/db-imports/. To actually load it, SSH in
# and run vm-seed-db.sh, which prompts for confirmation before
# clobbering the existing DB.
#
# Why two-step (push + manual restore) instead of one-shot:
#   • A typo in the local dump path shouldn't be able to wipe prod.
#   • The first deploy needs the dump but every subsequent deploy
#     should leave prod data alone — a one-step script invites
#     accidental clobbers on routine syncs.
#
# Usage:
#   ./scripts/deploy/sync-db-dump.sh                    # newest local dump
#   ./scripts/deploy/sync-db-dump.sh path/to/dump.sql   # specific file
#   ./scripts/deploy/sync-db-dump.sh --fresh            # take a new dump first
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"
load_deploy_env

FRESH=0
DUMP_FILE=""
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    -*)      echo "Unknown flag: $arg" >&2; exit 1 ;;
    *)       DUMP_FILE="$arg" ;;
  esac
done

if [[ "$FRESH" -eq 1 ]]; then
  echo "[sync-db] Taking a fresh local dump..."
  bash "$ROOT_DIR/scripts/db/backup.sh"
fi

# Pick newest dump if not specified.
if [[ -z "$DUMP_FILE" ]]; then
  DUMP_FILE="$(ls -t "$ROOT_DIR/backups"/*.sql 2>/dev/null | head -n 1 || true)"
  if [[ -z "$DUMP_FILE" ]]; then
    echo "[sync-db] No dump found in $ROOT_DIR/backups/. Run with --fresh or specify a file."
    exit 1
  fi
  echo "[sync-db] Using newest local dump: $DUMP_FILE"
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "[sync-db] Dump file not found: $DUMP_FILE"
  exit 1
fi

REMOTE_BASENAME="$(basename "$DUMP_FILE")"
REMOTE_DIR="/opt/glof/db-imports"
REMOTE_PATH="${REMOTE_DIR}/${REMOTE_BASENAME}"

# Ensure the remote import directory exists. Owned by the VM_USER so
# scp can write there without sudo.
remote "mkdir -p $REMOTE_DIR"

SCP_ARGS=()
while IFS= read -r a; do SCP_ARGS+=("$a"); done < <(scp_args)

echo "[sync-db] Uploading $DUMP_FILE → ${VM_USER}@${VM_HOST}:${REMOTE_PATH}"
scp "${SCP_ARGS[@]}" "$DUMP_FILE" "${VM_USER}@${VM_HOST}:${REMOTE_PATH}"

echo "[sync-db] OK — dump now lives at ${REMOTE_PATH} on the VM."
echo "[sync-db] To restore into the running container, SSH in and run:"
echo "    cd ${VM_PATH} && ./scripts/deploy/vm-seed-db.sh ${REMOTE_PATH}"
