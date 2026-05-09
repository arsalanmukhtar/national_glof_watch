# App launch guide

This document walks through everything required to run National GLOF Monitoring locally, build it for production, deploy the static frontend, run the backend service, and resolve common issues. For an at-a-glance summary, see the [README](../README.md). For the operator's manual covering the dashboard's panels, layers, and workflows, the app ships an in-built **/docs** route (Docs button in the title bar).

The application has two processes:

- **Frontend** — Vite-built React SPA on `http://localhost:5174` (dev) or any static host (production).
- **Backend** — Express + Postgres on `http://localhost:3001`. Owns the PMD fetch cron, the database schema, and the `/api/parameters/*` endpoints.

The frontend talks to the backend over `/api`, which Vite proxies to `:3001` in development. In production, the same path needs to hit the running Node process (typically via a reverse proxy).

## Prerequisites

| Tool | Minimum | Notes |
| --- | --- | --- |
| Node.js | 18 LTS | 20 LTS recommended. Vite 5, Mapbox GL 3.9, and `node --watch` all want a modern release. |
| npm | 9+ | pnpm 8+ or yarn 1.22+ work as drop-in equivalents. |
| PostgreSQL | 14+ | Local install is fine; the schema is two tables and a few indexes. |
| Git | Any recent | Required to clone the repository. |
| Modern browser | Chrome, Edge, Firefox, or Safari (latest two) | The dev server prints the URL on start. |

Network access:

- The PMD upstream sits at `https://115.186.56.181/ews/classes/stations.php` and uses a self-signed / private-CA certificate. The backend uses an `undici` Agent with `rejectUnauthorized: false` scoped to PMD requests only — not a global TLS bypass. From a restricted network this host may be unreachable; the cron will log errors but the rest of the app still works.
- For the GeoServer layers: `http://172.18.1.85:8080` (federal) and `http://172.18.1.4:8080` (provincial). Off the NDMA LAN, those WFS calls fail silently and the affected layers stay empty.

## Initial setup

```powershell
git clone <repo-url> national_glof_watch
cd national_glof_watch
copy .env.example .env       # macOS / Linux: cp .env.example .env
```

Open `.env` and fill in the values described in [Environment variables](#environment-variables) below.

Create the local database:

```powershell
createdb -U postgres glof
```

(Or run `CREATE DATABASE glof;` from `psql`.) The backend's `ensureSchema()` runs `server/sql/schema.sql` on boot, so the tables and indexes appear automatically the first time you start the server. Re-running is idempotent.

Install dependencies:

```powershell
npm install
```

## Local development

You'll want two terminals — one for the backend, one for the frontend. Both auto-reload on file changes.

```powershell
# Terminal A
npm run server
# → [server] listening on http://localhost:3001
# → [server] auto-store every 10 min
# → [cron] initial cycle @ ...
```

```powershell
# Terminal B
npm run dev
# → http://localhost:5174/
```

Open `http://localhost:5174`. The frontend's Vite proxy forwards anything under `/api` to `:3001`.

### npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on `http://localhost:5174`. |
| `npm run server` | Express + cron via `node --watch server/index.js`. Auto-restarts when any `server/**` file changes. |
| `npm run build` | Produce a production frontend bundle in `dist/`. |
| `npm run preview` | Serve `dist/` locally for a sanity check. |
| `npm run lint` | ESLint over the project (`eslint.config.js`). |

### Backend boot sequence

1. `dotenv/config` loads `.env`.
2. `ensureSchema()` runs `server/sql/schema.sql` against the configured Postgres connection. Failure here is fatal (process exits with code 1).
3. Express starts on `PORT` (default 3001).
4. After a 2 s delay the initial cron cycle fires, then `setInterval` schedules the next at `STORE_INTERVAL_MIN` (default 10) minutes.

You'll see one log line per element per cycle:

```
[cron] scheduled cycle @ 2026-05-04T...
  [Air Temperature]          +12 new / 82 dedup, stations=94
  [Total Rain]               +8 new / 86 dedup, stations=94
  [Water Level]              +0 new / 31 dedup, stations=31
  [Compact GAS State (WPs)]  +0 new / 47 dedup, stations=47
  [Istantaneous Flow]        +0 new / 31 dedup, stations=31
```

`+N new` is rows freshly inserted (the upstream `lastUpdate` advanced); `M dedup` is rows the `UNIQUE (station_id, element, last_update)` constraint quietly rejected.

## Production build and deploy

The repository ships two production paths out of the box:

1. **Docker stack** — `docker-compose.yml` (+ `docker-compose.prod.yml` overlay) brings up `db` (Postgres + PostGIS), `backend` (Node + Express + cron), and `frontend` (nginx serving the Vite build) on a single bridge network. The frontend container reverse-proxies `/api/*` to the backend over the Compose network. `scripts/deploy/release.sh` is the end-to-end "ship it" routine; see the README's *Deployment* section for the script index.

2. **Vercel** — `vercel.json` declares the Vite framework and rewrites `/api/:path*` to the backend's public URL. The frontend deploys as a static SPA; the backend continues to run wherever it lives (typically the same Docker stack). `VITE_*` env vars must be set in the Vercel project's Environment Variables panel and the build re-run without cache so the values get baked in.

If neither fits — e.g. you want a bare-metal deploy with PM2 + system Nginx — the manual recipe below still works.

### Manual (bare-metal) deploy

The frontend is a fully static SPA. Build it with:

```powershell
npm run build
```

The output in `dist/` can be served by any static host. The backend is a long-running Node process — keep it alive with PM2, systemd, Docker, or your platform's process manager. Configure your reverse proxy (Nginx, IIS, Caddy, etc.) so that everything under `/api/*` reaches `http://localhost:3001` and everything else falls through to `dist/`.

### Sample Nginx server block

```nginx
server {
    listen 80;
    server_name glof-watch.example.gov.pk;

    root /var/www/national_glof_watch/dist;
    index index.html;

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA fallback: serve index.html for any unknown path
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Long-cache hashed assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

The `try_files ... /index.html;` fallback is important: without it, refreshing a deep link or navigating directly to a non-root URL will return a 404.

### Example PM2 config for the backend

```json
{
  "apps": [{
    "name": "glof-backend",
    "script": "server/index.js",
    "node_args": "--enable-source-maps",
    "env": {
      "NODE_ENV": "production",
      "PORT": "3001"
    }
  }]
}
```

PM2 picks up the project's `.env` file the same way the dev script does because the entrypoint imports `dotenv/config`.

## Environment variables

Frontend (`VITE_*`) variables are read at build time by Vite and inlined into the bundle — a change requires restarting the dev server or rebuilding. Backend variables are read at runtime via `dotenv/config`; a change requires restarting `npm run server` (which `node --watch` will do for you when `server/**` files change, but not when `.env` itself does — see [Troubleshooting](#troubleshooting)).

### Frontend (built into the bundle)

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_MAPBOX_TOKEN` | Yes | Mapbox public access token (`pk.*`). Create in `https://account.mapbox.com/access-tokens/`. Restrict to the production hostname before deploying. Powers both the basemap and the geocoder search. Without it the basemap renders as a blank grey canvas and the geocoder returns 401s. |
| `VITE_GEOSERVER_BASE_URL` | Yes | Federal NDMA GeoServer (typically `http://172.18.1.85:8080/geoserver`). Hosts the glacial lakes inventory, AKAH infrastructure, populated places, GMRC/WAPDA stations, and GLOF II early-warning stations. |
| `VITE_GEOSERVER_PROVINCIAL_URL` | Yes | Provincial GeoServer (typically `http://172.18.1.4:8080/geoserver`). Hosts a separate set of boundary layers. |
| `VITE_DEFAULT_MAP_CENTER_LNG` | No | Initial longitude. Use a value over northern Pakistan (~72–75 °E). |
| `VITE_DEFAULT_MAP_CENTER_LAT` | No | Initial latitude (~35–37 °N for the GLOF region). |
| `VITE_DEFAULT_MAP_ZOOM` | No | Default `7`. The legacy app opens around 6–7 to show the full Hindu Kush / Karakoram / Himalaya extent. |
| `VITE_DEFAULT_MAP_PITCH` | No | Camera pitch in degrees. `0` = top-down; `60` = max tilt. |

### Backend (read by the Node process)

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | No | Express port. Default `3001`. The Vite proxy assumes 3001, so override with care. |
| `PG_HOST` | Yes | Postgres host (typically `localhost`). |
| `PG_PORT` | Yes | Postgres port (typically `5432`). |
| `PG_DATABASE` | Yes | Database name. The setup steps create one called `glof`. |
| `PG_USER` | Yes | Postgres user. |
| `PG_PASSWORD` | Yes | Postgres password. |
| `STORE_INTERVAL_MIN` | No | Cron cadence in minutes. Default `10`. The interval is clamped to `Math.max(1, …)` so you cannot disable it by setting `0`. |

## Day / night theme

The theme is controlled by a toggle button in the navy titlebar and is implemented via Tailwind's `dark` class strategy.

- The current theme is persisted in `localStorage` under the key `theme`, with values `light` (day) or `dark` (night).
- On first load (no value stored), the app reads `window.matchMedia('(prefers-color-scheme: dark)')` and adopts the system preference.
- The navy titlebar (`#002060`) is intentionally constant in both themes — it is part of the NDMA brand and is excluded from the dark-mode palette.
- The accent color used across both themes for active buttons / focus rings / tab underlines / toggle pills is `#16a085` (hover `#138b72`, active `#0f7560`).

To force a specific theme during development, run the following in the browser devtools console and reload:

```js
localStorage.setItem('theme', 'dark');   // or 'light'
```

## Asset organisation

New assets live under `src/assets/`:

- `src/assets/images/` — JPEG / PNG / SVG (alerts gallery, lake static maps, partner logos)
- `src/assets/videos/` — MP4 / GIF field footage used in side panels and lake popups
- `src/assets/data/` — CSV, XLSX, and GeoJSON consumed at runtime

Naming convention: lowercase with underscores, no spaces (e.g. `badswat_lake_2024.geojson`, not `Badswat Lake 2024.geojson`). The legacy → new path mapping is documented in [`ASSET_MANIFEST.md`](../ASSET_MANIFEST.md) at the project root.

Several of the larger binary assets (videos, hi-res images, .xlsx) are stored via Git LFS. Make sure `git lfs install` has been run on your local machine before cloning, otherwise the working tree contains pointer files instead of the real binaries.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Map area is a blank grey rectangle | `VITE_MAPBOX_TOKEN` missing, malformed, or restricted to a different domain | Verify the token in `.env`, restart Vite, check the browser console for a 401 from `api.mapbox.com`. |
| Geocoder search returns nothing | Same as above — geocoder uses the same Mapbox token | See above. |
| Parameters panel shows "Last updated Never" forever | Backend isn't running, or `/api` proxy isn't reaching it | Confirm `npm run server` is up and check `http://localhost:3001/health` returns `{"ok":true,"db":"up"}`. |
| Map shows zero stations even though the parameter is selected | DB has no rows yet for that element, or the cron hasn't run | Click "Refresh data" in the Parameters panel to fire `POST /api/parameters/refresh-all`, or wait for the next cron cycle. The terminal log shows what's been inserted. |
| Backend exits on boot with `schema setup failed` | Wrong `PG_*` credentials, or the `glof` database doesn't exist | Verify `psql -U $PG_USER -d $PG_DATABASE` works, then re-run `createdb -U postgres glof` if needed. |
| Cron logs `PMD upstream 502` for every element | Network can't reach `https://115.186.56.181`, or the upstream is itself down | Test from the host: `curl -k https://115.186.56.181/ews/classes/stations.php?element=Air+Temperature`. Off-net this is expected; on-net contact the PMD admin. |
| New env values don't take effect after editing `.env` | `node --watch` only reloads on `server/**` changes, not `.env` | Stop `npm run server` (Ctrl-C) and start it again. |
| Charts tab "PMD Data Trend" stays empty after picking a parameter | No station selected | Click any colored dot on the map (or any row in the Stations table). The chart needs both a parameter *and* a station. |
| Chart "No readings recorded for the last X" | Database has the station registered but no historical readings yet inside the chosen window | Switch to a longer window via Custom (`Past N days`), or wait for more cron cycles to accumulate. |
| `npm run build` fails with a `mapbox-gl` or native-module error | Node.js too old | Upgrade to Node 18 LTS or newer; delete `node_modules` and `package-lock.json`, reinstall. |
| Theme stuck in dark (or light) regardless of the toggle | Stale `localStorage` entry | Run `localStorage.removeItem('theme')` in devtools and reload. |
| Layer toggle in the Layers menu has no effect | Not yet wired — the regional layer toggles are scaffold-only | Tracked under "Status" in the README; live WFS bindings come later. |
| Working tree shows .mp4 / .jpg files as text pointer files | Git LFS isn't smudging on checkout | `git lfs install`, then `git lfs checkout` to materialize the real binaries. |
| `[cron] scheduled cycle` repeats but rows-inserted is always 0 | Upstream sensor `lastUpdate` hasn't advanced; the unique constraint dedupes | Expected when sensors only report hourly but cron runs every 10 min — no action needed. |

## Browser support

Targeting modern evergreen browsers only:

- Google Chrome — latest two versions
- Microsoft Edge — latest two versions
- Mozilla Firefox — latest two versions
- Apple Safari — latest two versions

Internet Explorer 11 is not supported. Older Chromium-derived in-app browsers (e.g. embedded WebViews on legacy Android) may render but are not on the support matrix.

## Migration notes

The legacy static HTML/JS dashboard is preserved in `legacy/` so that behaviour, copy, and visual detail can be cross-checked while the React port is being completed. The original top-level data folders — `data/`, `Alerts/`, and `Maps/` — remain in place alongside the new `src/assets/` tree until parity has been verified end-to-end. Once the React app is confirmed to cover every layer, chart, video, and alert from the legacy implementation, those folders can be removed and `legacy/` can be archived.

When in doubt about expected behaviour, the legacy app is the source of truth.
