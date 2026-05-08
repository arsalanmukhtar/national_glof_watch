#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# End-to-end "ship a new version to prod" routine.
#
# Steps:
#   1. promote.sh     — fast-forward prod from main, tag, push.
#   2. sync-rasters   — push any new uploads from data/rasters/.
#   3. remote deploy  — SSH to the VM and run vm-deploy.sh.
#
# DB seeding is intentionally NOT part of this — it's a one-shot
# operation invoked manually with sync-db-dump.sh + vm-seed-db.sh.
# Daily releases shouldn't touch prod data.
#
# Usage:
#   ./scripts/deploy/release.sh           # interactive (prompts on promote)
#   ./scripts/deploy/release.sh --yes     # non-interactive
#   ./scripts/deploy/release.sh --skip-rasters   # code-only deploy
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"
load_deploy_env

ASSUME_YES=0
SKIP_RASTERS=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --skip-rasters) SKIP_RASTERS=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

PROMOTE_FLAGS=()
[[ "$ASSUME_YES" -eq 1 ]] && PROMOTE_FLAGS+=(--yes)

echo "[release] === 1/3: promote main → prod ==="
bash "$SCRIPT_DIR/promote.sh" "${PROMOTE_FLAGS[@]}"

if [[ "$SKIP_RASTERS" -ne 1 ]]; then
  echo "[release] === 2/3: sync rasters → VM ==="
  bash "$SCRIPT_DIR/sync-rasters.sh"
else
  echo "[release] === 2/3: skipped (--skip-rasters) ==="
fi

echo "[release] === 3/3: deploy on VM ==="
remote "set -e
cd '$VM_PATH'
./scripts/deploy/vm-deploy.sh"

echo "[release] OK — ${VM_HOST} is on the latest prod tip."
