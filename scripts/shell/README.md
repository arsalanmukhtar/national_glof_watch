# scripts/shell/

Developer-to-developer clone scripts for the National GLOF Monitoring
app. Use these when a different person needs a working copy on their
own machine, not for VM deploy (that's `scripts/deploy/`).

## The flow

```
┌─ MACHINE A (you) ─────────────────────┐    ┌─ MACHINE B (them) ────────────────────┐
│                                        │    │                                        │
│  ./scripts/shell/backup.sh            │    │  git clone <repo>                      │
│    → backups/glof-<ts>.tar.gz          │    │  cd national_glof_watch                │
│                                        │    │  git checkout <their branch>          │
│  scp backups/glof-<ts>.tar.gz  ──────────────▶  (into backups/)                      │
│                                        │    │                                        │
│                                        │    │  ./scripts/shell/deploy.sh            │
│                                        │    │    → scaffolds .env on first run      │
│                                        │    │    → (edit .env; re-run)              │
│                                        │    │    → docker compose up -d --build     │
│                                        │    │    → restores db + rasters            │
│                                        │    │    → http://localhost:8090            │
└────────────────────────────────────────┘    └────────────────────────────────────────┘
```

## backup.sh

Produces **one tarball** under `backups/` containing everything the
other machine can't regenerate from source:

- `db.sql` — plain-SQL `pg_dump --clean --create` of the Postgres DB.
  Taken from the running Docker container when it's up, else from the
  host `pg_dump`.
- `rasters/` — the whole `data/rasters/` tree, minus
  `data/rasters/analysis/` (which is a per-request Sentinel-2 cache —
  regenerable on demand from `/api/analysis/sentinel`).
- `MANIFEST.txt` — git sha + branch at backup time, host info, sizes.

**Not included** (regenerate on the receiver): the code (git handles
that), `node_modules/`, `.venv/`, `dist/`, and `.env` (secrets).

```bash
./scripts/shell/backup.sh
# → backups/glof-20261029-143022.tar.gz (<size>)
```

Transfer that single file to the other machine's `backups/` folder
(scp, rsync, cloud bucket, USB — whatever works).

## deploy.sh

Idempotent. Safe to re-run.

**First run** (no `.env` yet):
- Copies `.env.example` → `.env`.
- Tells you which values to fill in (`VITE_MAPBOX_TOKEN`,
  `PG_PASSWORD`, `DATASCAPE_PASSWORD`).
- Exits so you can edit the file.

**Second run onward** (`.env` present):
- Verifies `docker` + `docker compose`.
- Creates `backups/` and `data/rasters/` if missing.
- `docker compose up -d --build`.
- Waits for Postgres to be healthy.
- If `backups/glof-*.tar.gz` exists **and** the DB is empty, restores
  the newest bundle (DB + rasters). If the DB already has data,
  **skips** the restore. Use `--force-restore` to override.

```bash
./scripts/shell/deploy.sh                 # typical first + subsequent runs
./scripts/shell/deploy.sh --force-restore # clobber an existing DB with the latest backup
```

## What this script does NOT do

- **Git**. You `git clone` and `git checkout <branch>` manually before
  running `deploy.sh` — branch management stays in your hands.
- **Deploy to the production VM**. Use `scripts/deploy/release.sh` for
  that.
- **Install OS prereqs**. Docker Desktop (Windows/macOS) or docker-ce
  (Linux) must already be present. The script fails loudly if not.
