#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Promote the `main` branch to `prod` and push.
#
# Workflow:
#   1. Verify the working tree is clean — refuse to promote with
#      uncommitted changes (would create a confusing prod state).
#   2. Switch to main and fast-forward from the remote.
#   3. If `prod` doesn't exist yet (first promote), create it from
#      the current main; otherwise fast-forward prod to main. Refuse
#      to do a non-FF merge — divergence between branches means
#      someone committed to prod directly, which is a workflow break.
#   4. Tag the commit as `release-YYYYMMDD-HHMMSS`.
#   5. Push prod + the tag to the configured remote.
#
# Usage:
#   ./scripts/deploy/promote.sh                # interactive
#   ./scripts/deploy/promote.sh --yes          # skip the confirm prompt
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"
load_deploy_env

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

cd "$ROOT_DIR"

# Refuse to promote with uncommitted changes — too easy to ship a
# half-finished commit by accident otherwise.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "[promote] Working tree is not clean. Commit or stash first."
  git status --short
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "[promote] Fetching $GIT_REMOTE..."
git fetch "$GIT_REMOTE"

echo "[promote] Updating main from $GIT_REMOTE/main..."
git checkout main
git pull --ff-only "$GIT_REMOTE" main

# Detect prod branch state. Three cases:
#   • doesn't exist locally and not on remote → create from main
#   • exists locally but not on remote        → push it
#   • exists on remote                        → fast-forward locally + push
PROD_EXISTS_LOCAL=0
PROD_EXISTS_REMOTE=0
git show-ref --verify --quiet refs/heads/prod && PROD_EXISTS_LOCAL=1
git show-ref --verify --quiet refs/remotes/"$GIT_REMOTE"/prod && PROD_EXISTS_REMOTE=1

if [[ "$PROD_EXISTS_LOCAL" -eq 0 && "$PROD_EXISTS_REMOTE" -eq 1 ]]; then
  echo "[promote] Tracking remote prod branch locally..."
  git checkout -b prod "$GIT_REMOTE/prod"
elif [[ "$PROD_EXISTS_LOCAL" -eq 0 && "$PROD_EXISTS_REMOTE" -eq 0 ]]; then
  echo "[promote] Creating prod branch from main..."
  git checkout -b prod
else
  git checkout prod
  if [[ "$PROD_EXISTS_REMOTE" -eq 1 ]]; then
    git pull --ff-only "$GIT_REMOTE" prod
  fi
fi

# Show what's about to be promoted. The first-time case is special:
# prod was just created from main so there's nothing "ahead", but
# the new branch still needs to be pushed to the remote and tagged.
COMMITS_AHEAD="$(git rev-list --count prod..main || echo 0)"
FIRST_PUSH=0
if [[ "$PROD_EXISTS_REMOTE" -eq 0 ]]; then
  FIRST_PUSH=1
  echo "[promote] First-time push of prod branch to $GIT_REMOTE."
fi

if [[ "$COMMITS_AHEAD" -eq 0 && "$FIRST_PUSH" -eq 0 ]]; then
  echo "[promote] prod is already up to date with main — nothing to promote."
  git checkout "$CURRENT_BRANCH"
  exit 0
fi

if [[ "$COMMITS_AHEAD" -gt 0 ]]; then
  echo "[promote] $COMMITS_AHEAD commit(s) on main not in prod:"
  git log --oneline prod..main
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Promote main → prod and push to $GIT_REMOTE? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; git checkout "$CURRENT_BRANCH"; exit 1 ;;
  esac
fi

# Fast-forward only — divergence means someone committed to prod
# directly, which we want to surface rather than silently merge over.
# Skipped on first-push when prod and main are already at the same
# commit (`git merge --ff-only main` would no-op anyway, but git
# prints "Already up to date" which is misleading in that path).
if [[ "$COMMITS_AHEAD" -gt 0 ]]; then
  git merge --ff-only main
fi

TAG="release-$(date +%Y%m%d-%H%M%S)"
git tag -a "$TAG" -m "Promote main → prod ($COMMITS_AHEAD commits)"

git push "$GIT_REMOTE" prod
git push "$GIT_REMOTE" "$TAG"

echo "[promote] OK — prod is now at $(git rev-parse --short prod), tag $TAG"

# Return the user to whatever they were on before.
git checkout "$CURRENT_BRANCH"
