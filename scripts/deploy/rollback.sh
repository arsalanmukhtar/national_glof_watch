#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Roll prod back to the previous release tag.
#
# Two halves:
#   • Local: pick the second-newest `release-*` tag, fast-forward
#     prod to it, force-push (because a rollback is a non-FF for
#     anyone tracking prod). Tags themselves are immutable — the
#     branch pointer is what moves.
#   • Remote: SSHes to the VM, runs `git fetch && git reset --hard
#     prod && vm-deploy.sh --no-pull` so the VM picks up the moved
#     branch tip.
#
# Usage:
#   ./scripts/deploy/rollback.sh                  # second-newest tag
#   ./scripts/deploy/rollback.sh release-XYZ      # explicit target
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"
load_deploy_env

cd "$ROOT_DIR"

TARGET_TAG="${1:-}"

git fetch "$GIT_REMOTE" --tags

if [[ -z "$TARGET_TAG" ]]; then
  # Pick the previous release. List tags chronologically (newest
  # first), drop the head, take the next one.
  TARGET_TAG="$(git tag --list 'release-*' --sort=-creatordate | sed -n '2p')"
  if [[ -z "$TARGET_TAG" ]]; then
    echo "[rollback] No previous release tag to roll back to."
    exit 1
  fi
  echo "[rollback] Targeting previous release: $TARGET_TAG"
fi

if ! git rev-parse "$TARGET_TAG" >/dev/null 2>&1; then
  echo "[rollback] Tag not found: $TARGET_TAG"
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git checkout prod
git reset --hard "$TARGET_TAG"

echo "[rollback] prod is now at $TARGET_TAG ($(git rev-parse --short HEAD))"
echo "[rollback] Force-pushing prod (rollbacks are non-fast-forward)..."
git push --force-with-lease "$GIT_REMOTE" prod

echo "[rollback] Telling the VM to re-deploy..."
remote "set -e
cd '$VM_PATH'
git fetch origin
git reset --hard origin/prod
./scripts/deploy/vm-deploy.sh --no-pull"

git checkout "$CURRENT_BRANCH"
echo "[rollback] OK — prod rolled back to $TARGET_TAG"
