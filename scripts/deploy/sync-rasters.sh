#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Push uploaded rasters from dev → VM.
#
# Why this isn't part of `git push`: the rasters under data/rasters/
# are user-uploaded GeoTIFFs (and their pyramids), not source files.
# They can be hundreds of MB each, change frequently, and don't belong
# in version control. rsync over SSH is the right transport — only the
# delta moves on subsequent runs.
#
# Direction is one-way (dev → VM). Reverse direction handled by a
# separate script if you ever need to copy production uploads back to
# the dev box for testing.
#
# Usage:
#   ./scripts/deploy/sync-rasters.sh            # rsync data/rasters/ → VM
#   ./scripts/deploy/sync-rasters.sh --dry      # show what would change
#   ./scripts/deploy/sync-rasters.sh --delete   # mirror (deletes remote
#                                                 files that no longer
#                                                 exist locally — careful)
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"
load_deploy_env

DRY=0
DELETE=0
for arg in "$@"; do
  case "$arg" in
    --dry|-n) DRY=1 ;;
    --delete) DELETE=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if ! command -v rsync >/dev/null 2>&1; then
  echo "[sync-rasters] rsync not found on PATH."
  echo "[sync-rasters] On Windows, run this from Git Bash (MINGW) or WSL."
  exit 1
fi

LOCAL_DIR="$ROOT_DIR/data/rasters/"
REMOTE_DIR="/opt/glof/rasters/"

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "[sync-rasters] $LOCAL_DIR doesn't exist — nothing to sync."
  exit 0
fi

# Build the rsync flag set:
#   -a       : archive mode (preserve perms / times / symlinks)
#   -v       : verbose so the user sees what's transferring
#   -h       : human-readable sizes
#   --info=progress2 : single-line progress meter across the whole batch
#   --partial : keep half-transferred files for resume
SSH_ARGS=()
while IFS= read -r a; do SSH_ARGS+=("$a"); done < <(ssh_args)

RSYNC_FLAGS=(-avh --info=progress2 --partial)
[[ "$DRY" -eq 1 ]] && RSYNC_FLAGS+=(--dry-run)
[[ "$DELETE" -eq 1 ]] && RSYNC_FLAGS+=(--delete)

# Trailing slash on LOCAL_DIR + REMOTE_DIR is intentional — it copies
# the *contents* of data/rasters/ into /opt/glof/rasters/ rather than
# nesting an extra rasters/ directory inside the remote.
echo "[sync-rasters] $LOCAL_DIR → ${VM_USER}@${VM_HOST}:${REMOTE_DIR}"
[[ "$DRY" -eq 1 ]] && echo "[sync-rasters] DRY RUN — no files will be transferred."
[[ "$DELETE" -eq 1 ]] && echo "[sync-rasters] DELETE — remote files missing locally will be removed."

rsync "${RSYNC_FLAGS[@]}" \
  -e "ssh ${SSH_ARGS[*]}" \
  "$LOCAL_DIR" \
  "${VM_USER}@${VM_HOST}:${REMOTE_DIR}"

echo "[sync-rasters] OK"
