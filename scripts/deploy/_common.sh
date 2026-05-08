# ---------------------------------------------------------------------------
# Shared helpers sourced by every script in scripts/deploy/. Not
# executed directly — `source "$(dirname "$0")/_common.sh"` from a
# wrapper. Centralised here so VM connection logic and SSH command
# construction stay in one place.
# ---------------------------------------------------------------------------

# Resolve the repo root from any caller in scripts/deploy/.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"

load_deploy_env() {
  local file="$ROOT_DIR/.env.deploy"
  if [[ ! -f "$file" ]]; then
    echo "[deploy] Missing $file — copy .env.deploy.example and fill in." >&2
    exit 1
  fi
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(echo "$key" | tr -d '[:space:]')"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$file"

  : "${VM_HOST:?VM_HOST not set in .env.deploy}"
  : "${VM_USER:?VM_USER not set in .env.deploy}"
  : "${VM_PATH:?VM_PATH not set in .env.deploy}"
  VM_PORT="${VM_PORT:-22}"
  GIT_REMOTE="${GIT_REMOTE:-origin}"

  # Path-format gotcha: the .env.deploy template uses Windows-style
  # paths (C:/Users/...) so the same file works whether the user
  # invokes scripts from Git Bash or PowerShell. Under WSL though,
  # those paths resolve to /mnt/c/... and the raw form fails with
  # "Identity file ... not accessible". When wslpath is available
  # we translate VM_SSH_KEY transparently. Git Bash already handles
  # the C:/... form natively, so we leave it alone there.
  if [[ -n "${VM_SSH_KEY:-}" ]] && command -v wslpath >/dev/null 2>&1; then
    if [[ "$VM_SSH_KEY" =~ ^[A-Za-z]:[/\\] ]]; then
      VM_SSH_KEY="$(wslpath -u "$VM_SSH_KEY")"
      export VM_SSH_KEY
    fi
  fi
}

# Build the ssh / scp / rsync command-line fragments once so every
# script uses the same key + port combo. Echoed without `eval` to
# avoid quoting headaches on Git Bash for Windows.
ssh_args() {
  local args=(-p "$VM_PORT")
  if [[ -n "${VM_SSH_KEY:-}" ]]; then
    args+=(-i "$VM_SSH_KEY")
  fi
  printf '%s\n' "${args[@]}"
}

scp_args() {
  local args=(-P "$VM_PORT")
  if [[ -n "${VM_SSH_KEY:-}" ]]; then
    args+=(-i "$VM_SSH_KEY")
  fi
  printf '%s\n' "${args[@]}"
}

# Run a remote command. Quotes the command so embedded `$VARS` are
# expanded on the VM, not on the dev box.
remote() {
  # Read ssh_args output into an array, then call ssh with proper expansion.
  local args=()
  while IFS= read -r a; do args+=("$a"); done < <(ssh_args)
  ssh "${args[@]}" "${VM_USER}@${VM_HOST}" "$@"
}
