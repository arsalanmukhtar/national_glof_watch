#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy.sh — stand up a working copy of this app on a fresh machine,
# restoring from a backup bundle produced by scripts/shell/backup.sh if
# one is present.
#
# Flow:
#   1. First run (no .env):
#        - Scaffold .env from .env.example (or empty if no example).
#        - Print what the user must fill in (VITE_MAPBOX_TOKEN,
#          PG_PASSWORD, DATASCAPE_PASSWORD).
#        - Exit 0 so the user can edit the file, then re-run.
#   2. Second run onward:
#        - Verify docker + docker compose exist.
#        - mkdir backups/ and data/rasters/ if missing (empty dirs are
#          fine; a fresh install just has nothing to restore).
#        - docker compose up -d --build (brings up db + backend +
#          frontend, builds the frontend bundle inside its container).
#        - Wait for Postgres to be healthy.
#        - If backups/glof-*.tar.gz is present AND the database has no
#          user tables, restore the newest bundle (db + rasters).
#          If the DB already has tables, SKIP (we never clobber existing
#          data — the user can re-run with --force-restore if they
#          really want to overwrite).
#        - Print the local URLs.
#
# Idempotent: safe to re-run. Only triggers an auto-restore on a
# genuinely empty database.
#
# Branches: this script does NOT touch git. The user is expected to
# `git clone` the repo and `git checkout <branch>` manually before
# running this.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

FORCE_RESTORE=0
for arg in "$@"; do
  case "$arg" in
    --force-restore) FORCE_RESTORE=1 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. .env scaffold (first-run guard)
# ---------------------------------------------------------------------------
if [[ ! -f "$ROOT_DIR/.env" ]]; then
  if [[ -f "$ROOT_DIR/.env.example" ]]; then
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
    echo "[deploy] Created .env from .env.example."
  else
    : > "$ROOT_DIR/.env"
    echo "[deploy] Created empty .env (no .env.example found)."
  fi
  cat <<'EOF'

[deploy] FIRST RUN — fill in .env before re-running this script.
         At minimum:
           VITE_MAPBOX_TOKEN      — your Mapbox public access token (pk.*)
           PG_PASSWORD            — password for the Dockerised Postgres
                                    (any value — it becomes the postgres
                                    container's password on first boot)
           DATASCAPE_PASSWORD     — PMD Datascape v3 password (ask the
                                    original author; without it the PMD
                                    cron logs auth errors but the rest
                                    of the app still runs)

         Then re-run:  ./scripts/shell/deploy.sh
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Prerequisites
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || {
  echo "[deploy] ERROR: docker is not installed." >&2
  echo "[deploy]        Install Docker Desktop (Windows/macOS) or docker-ce (Linux)." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "[deploy] ERROR: 'docker compose' (v2 plugin) is not available." >&2
  echo "[deploy]        Install the compose plugin: docker compose version" >&2
  exit 1
}

# Load .env for passwords needed to talk to the DB during restore.
if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="$(echo "$key" | tr -d '[:space:]')"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$ROOT_DIR/.env"
fi
PG_USER="${PG_USER:-postgres}"
PG_DATABASE="${PG_DATABASE:-glof}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"

# ---------------------------------------------------------------------------
# 3. Required directories
#
# backups/ is where this script looks for a bundle to restore. It's
# gitignored (contents never go into the repo) — we just make sure it
# exists so the user has an obvious drop target for a backup tarball
# they're transferring over.
# data/rasters/ is host-mounted into the backend container; without
# it, docker compose would create it as root-owned.
# ---------------------------------------------------------------------------
mkdir -p "$ROOT_DIR/backups" "$ROOT_DIR/data/rasters"

# ---------------------------------------------------------------------------
# 4. Bring up the Docker stack
# ---------------------------------------------------------------------------
echo "[deploy] building + starting Docker stack (db + backend + frontend)"
docker compose up -d --build

DB_CONTAINER="$(docker compose ps -q db)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "[deploy] ERROR: db container didn't start. Check 'docker compose ps' + 'docker compose logs db'." >&2
  exit 1
fi

echo "[deploy] waiting for Postgres to become healthy..."
for i in {1..60}; do
  if docker exec "$DB_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DATABASE" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! docker exec "$DB_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DATABASE" >/dev/null 2>&1; then
  echo "[deploy] ERROR: Postgres never became ready after 120s." >&2
  echo "[deploy]        Inspect: docker compose logs db" >&2
  exit 1
fi
echo "[deploy] Postgres is up"

# ---------------------------------------------------------------------------
# 5. Optional auto-restore
#
# Finds the newest backups/glof-*.tar.gz. If the DB is empty (no user
# tables yet), extracts it to a temp dir, restores db.sql + copies
# rasters/ into data/rasters/. If the DB already has data, skips to
# avoid clobbering — pass --force-restore to override.
# ---------------------------------------------------------------------------
LATEST_BUNDLE=""
if ls "$ROOT_DIR"/backups/glof-*.tar.gz >/dev/null 2>&1; then
  LATEST_BUNDLE="$(ls -t "$ROOT_DIR"/backups/glof-*.tar.gz | head -1)"
fi

if [[ -n "$LATEST_BUNDLE" ]]; then
  USER_TABLE_COUNT="$(docker exec \
    -e PGPASSWORD="$PG_PASSWORD" "$DB_CONTAINER" \
    psql -U "$PG_USER" -d "$PG_DATABASE" -tAc \
    "SELECT COUNT(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" \
    2>/dev/null | tr -d '[:space:]' || echo 0)"
  USER_TABLE_COUNT="${USER_TABLE_COUNT:-0}"

  if [[ "$USER_TABLE_COUNT" -gt 0 && "$FORCE_RESTORE" -ne 1 ]]; then
    echo "[deploy] backup present but DB already has $USER_TABLE_COUNT table(s) — SKIPPING restore."
    echo "[deploy]   Pass --force-restore to overwrite anyway (destructive)."
  else
    echo "[deploy] restoring from $(basename "$LATEST_BUNDLE")"
    STAGE="$(mktemp -d)"
    # The bundle extracts to <STAGE>/glof-STAMP/ — that's what backup.sh writes.
    tar -xzf "$LATEST_BUNDLE" -C "$STAGE"
    EXTRACTED_DIR="$(find "$STAGE" -maxdepth 1 -mindepth 1 -type d -name 'glof-*' | head -1)"

    if [[ -z "$EXTRACTED_DIR" ]]; then
      echo "[deploy] ERROR: bundle did not contain a glof-* directory" >&2
      rm -rf "$STAGE"
      exit 1
    fi

    if [[ -f "$EXTRACTED_DIR/MANIFEST.txt" ]]; then
      echo "[deploy]   MANIFEST:"
      sed 's/^/[deploy]     /' "$EXTRACTED_DIR/MANIFEST.txt" | head -8
    fi

    if [[ -f "$EXTRACTED_DIR/db.sql" ]]; then
      echo "[deploy]   restoring db.sql (dump includes --clean --create)"
      # Pipe into psql -d postgres because the dump starts with
      # DROP DATABASE + CREATE DATABASE — can't be running inside the
      # target DB at the time.
      docker exec -i \
        -e PGPASSWORD="$PG_PASSWORD" "$DB_CONTAINER" \
        psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=0 \
        < "$EXTRACTED_DIR/db.sql" \
        > /tmp/glof-restore.log 2>&1 || true
      # Count failures (NOTICE lines from DROP IF EXISTS are expected
      # on a fresh DB — only ERROR lines matter).
      ERRS="$(grep -cE '^ERROR:' /tmp/glof-restore.log || true)"
      if [[ "$ERRS" -gt 0 ]]; then
        echo "[deploy]   restore completed with $ERRS error line(s) — tail of log:"
        tail -20 /tmp/glof-restore.log | sed 's/^/[deploy]     /'
      else
        echo "[deploy]   db restore ok"
      fi
    fi

    if [[ -d "$EXTRACTED_DIR/rasters" ]]; then
      RASTER_COUNT="$(find "$EXTRACTED_DIR/rasters" -type f | wc -l | tr -d ' ')"
      echo "[deploy]   copying $RASTER_COUNT raster file(s) into data/rasters/"
      # cp -R <src>/. <dst>/ merges contents without re-creating a
      # nested rasters/rasters/ subdir — portable across bsd + gnu cp.
      cp -R "$EXTRACTED_DIR/rasters/." "$ROOT_DIR/data/rasters/"
    fi

    rm -rf "$STAGE"
    echo "[deploy]   restore DONE"
  fi
else
  echo "[deploy] no backup bundle in backups/ — fresh database kept."
  echo "[deploy]   (If you expected one, drop glof-*.tar.gz into backups/ and re-run.)"
fi

# ---------------------------------------------------------------------------
# 6. Status
# ---------------------------------------------------------------------------
cat <<EOF

[deploy] DONE
[deploy]   frontend : http://localhost:8090
[deploy]   backend  : http://localhost:3001/health  (inside the compose network as http://backend:3001)
[deploy]   db       : postgres://${PG_USER}@localhost (not published; reach via 'docker compose exec db psql')
[deploy]
[deploy]   Useful follow-ups:
[deploy]     docker compose logs -f backend
[deploy]     docker compose logs -f frontend
[deploy]     ./scripts/shell/backup.sh       # take a fresh snapshot here
EOF
