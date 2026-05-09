# National GLOF Monitoring

NDMA Pakistan's web dashboard for tracking glacial-lake outburst flood (GLOF)
risk across the country's northern glaciated belt — Hindu Kush, Karakoram,
Himalaya. Live readings from the Pakistan Meteorological Department (PMD)
station network are layered over regional GIS context (lakes, glaciers,
rivers, faultlines, risk zones, infrastructure) so analysts have a single
operational view of station conditions, regional features, and historical
context.

The deliverable is a React 18 + Vite SPA served from any static host, plus
a Node + Express backend that owns the PMD cron, the PostGIS endpoints, and
the raster + upload routes. The dashboard ships an in-app **Documentation**
page (`/docs`) — open the **Docs** button in the title bar for the operator's
manual.

## Quick start

The app is two processes — Vite dev server (frontend) and Express + cron
(backend). Both must be running for parameter views to work; everything
else works with just the frontend.

```powershell
# 1. One-time setup
cp .env.example .env                     # then fill in VITE_MAPBOX_TOKEN and PG_*
createdb -U postgres glof                # one-time, before the first npm run server
psql -U postgres -d glof -c "CREATE EXTENSION IF NOT EXISTS postgis;"
npm install

# 2. Day-to-day (use two terminals)
npm run server                           # terminal A: Express + cron, http://localhost:3001
npm run dev                              # terminal B: Vite, http://localhost:5174
```

Open `http://localhost:5174`. Vite proxies `/api/*` to the backend so the
frontend talks to a single origin.

## What's in the dashboard

- **Live PMD parameters** — Air Temperature, Rainfall, Stage Level,
  Discharge, Battery Voltage. Coloured station dots on the map; per-bin
  legend; per-station trend chart with daily / weekly / custom windows.
- **Region layers** — 16 monitored regions with per-region polygons + lines
  (Lake / River / Glacier / Faultline / Buildings / Schools / Roads) plus
  three-level Risk Zones (Low / Medium / High) per region.
- **Secondary layers** — 8 country-wide reference layers from PostGIS
  (national / provincial boundary, AKAH infrastructure & hazard exposure,
  all stations, glacial lakes, settlements, cell towers) and 4 live PMD GIS
  layers (districts, basins, lakes, valleys) cached server-side.
- **Raster overlays** — upload single-band GeoTIFFs and render them as
  continuous (colormap) or classified (per-value swatch + label) on the map.
  Auto-min/max stretching, interactive nodata paint, opacity slider.
- **Uploads** — drag-drop GeoJSON / shapefile (.zip) into the Secondary
  panel and they appear as styled overlays alongside the built-in layers.
- **Feature Details** — click any vector feature, station, or raster pixel
  to see its full attribute set in a card layout, with units (m, m², km²,
  km³, °C, mm, …) detected automatically from the column names + computed
  geometry stats.
- **CSV import** — drop a CSV in, pick X / Y, get a chart in the CSV Trend
  tab.

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on `http://localhost:5174` |
| `npm run server` | Express backend + cron on `http://localhost:3001` |
| `npm run build` | Production frontend bundle to `dist/` |
| `npm run preview` | Serve `dist/` locally for sanity check |
| `npm run lint` | ESLint (flat config) |
| `npm run db:backup` | Plain-SQL `pg_dump` of the local database into `backups/` |
| `npm run db:restore` | Restore a `backups/*.sql` dump back into a fresh local database |

## Tech stack

**Frontend**
- React 18, Vite 5, React Router 7
- Tailwind 3 (class-based dark mode, custom `brand` / `day` / `night` palettes)
- Mapbox GL JS 3.9 (basemap, station / overlay layers, animated highlight ripples)
- Chart.js 4 + react-chartjs-2 (trend chart with legend-binned vertical gradient)
- Framer Motion, Headless UI, lucide-react, Inter font

**Backend**
- Node 20, Express, `pg` Pool
- undici (PMD-scoped insecure-TLS dispatcher)
- `geotiff` + canvas raster decode/render pipeline
- `setInterval`-based cron (default 10-minute cadence)

**Database**
- PostgreSQL 17 + PostGIS 3.5
- Schema-per-layer-type (`lakes`, `rivers`, `glaciers`, `risk_zones`, …) plus
  a `secondary` schema for cross-region reference layers and a `public`
  schema for the PMD `stations` + `station_readings` tables.

## Repository layout

```
national_glof_watch/
├── server/                       Backend (Node + Express + Postgres + PostGIS)
│   ├── index.js                  HTTP bootstrap, cron loop, route mounting
│   ├── routes/
│   │   ├── parameters.js         /api/parameters/* — PMD elements + trends
│   │   ├── region.js             /api/region/:region/:layerKey — per-region GIS layers
│   │   ├── secondary.js          /api/secondary/:layer — country-wide reference layers
│   │   ├── gis.js                /api/gis/:layer — live PMD GIS proxy (4 layers)
│   │   ├── rasters.js            /api/rasters — upload, list, fetch
│   │   ├── upload.js             /api/upload/import — generic geojson/shapefile import
│   │   ├── csv.js                /api/csv/* — server-side CSV catalog
│   │   └── db.js                 /api/db/tables — DB introspection
│   ├── lib/                      pmd.js, store.js, db.js
│   └── sql/schema.sql            stations + station_readings + indexes
├── src/
│   ├── components/dashboard/     MapPanel, LayerMenu, ChartsRow, FeatureDetailsPanel,
│   │                             LayerStyleConfigPanel, RasterMapRenderer, …
│   ├── components/layout/        TitleBar, AppShell, MobileMenu, MediaSwitcher
│   ├── components/ui/            Button, Input, Tooltip, Accordion, …
│   ├── pages/DocsPage.jsx        /docs route — operator's manual rendered in-app
│   ├── pages/docs/               parts.jsx (building blocks) + content.jsx (sections)
│   ├── contexts/                 Theme, Parameter, Secondary, RegionLayers, Map,
│   │                             AttributeTables, CsvDatasets, Raster
│   ├── config/                   env, mapbox, layerSources, parameterLegends, …
│   ├── utils/                    units, layerStyle, bbox, rasterRender, …
│   └── styles/index.css          Tailwind directives + universal classes
├── docker/nginx.conf             Frontend container nginx config (SPA + /api proxy)
├── docker-compose.yml            Dev/prod compose stack (db + backend + frontend)
├── docker-compose.prod.yml       Prod overlay (bind-mounts, restart policy, logging)
├── Dockerfile.backend            node:20-bookworm-slim + Python + rasterio
├── Dockerfile.frontend           Two-stage: Vite build → nginx:1.27-alpine
├── vercel.json                   Vercel config — Vite framework + /api → VM rewrite
├── scripts/db/                   Cross-platform pg_dump / restore (.ps1 + .sh)
├── scripts/deploy/               Promote / sync / VM-deploy / rollback (.sh)
├── scripts/python/               Raster overview + zonation utilities
├── docs/APP_LAUNCH.md            Local + production setup + troubleshooting
├── CLAUDE.md                     Architecture notes for AI-assisted edits
└── README.md                     This file
```

## Environment variables

Frontend variables are prefixed `VITE_`. Backend variables are loaded by
`dotenv/config`. Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Used by | Description |
| --- | --- | --- | --- |
| `VITE_MAPBOX_TOKEN` | Yes | frontend | Mapbox public access token (`pk.*`). The basemap and the geocoder both rely on it. |
| `VITE_GEOSERVER_BASE_URL` | No | frontend | Federal NDMA GeoServer base URL. LAN-only; off-LAN this returns empty. |
| `VITE_GEOSERVER_PROVINCIAL_URL` | No | frontend | Provincial GeoServer base URL. LAN-only. |
| `VITE_DEFAULT_MAP_CENTER_LNG` | No | frontend | Initial map center longitude. |
| `VITE_DEFAULT_MAP_CENTER_LAT` | No | frontend | Initial map center latitude. |
| `VITE_DEFAULT_MAP_ZOOM` | No | frontend | Initial zoom level (default 7). |
| `VITE_DEFAULT_MAP_PITCH` | No | frontend | Initial camera pitch in degrees. |
| `PORT` | No | backend | Express port (default `3001`). |
| `PG_HOST` | Yes | backend | Postgres hostname (typically `localhost`). |
| `PG_PORT` | Yes | backend | Postgres port (typically `5432`). |
| `PG_DATABASE` | Yes | backend | Database name (default `glof`). |
| `PG_USER` | Yes | backend | Postgres user. |
| `PG_PASSWORD` | Yes | backend | Postgres password. |
| `STORE_INTERVAL_MIN` | No | backend | Cron cadence in minutes (default 10). |

## Deployment

The same React build runs on two production targets that share a single
backend:

- **VM (Docker stack)** — `db` + `backend` + `frontend` services on a
  Compose network. Postgres data lives in a named volume; uploaded
  rasters bind-mount to a host directory so they survive container churn.
  `frontend` (nginx) serves the built SPA on port 8090 and reverse-proxies
  `/api/*` to the backend container.
- **Vercel** — `vercel.json` declares the Vite framework and a single
  rewrite that forwards `/api/*` to the public VM URL. The `VITE_*` env
  vars must be set in the Vercel project's Environment Variables panel
  (Production + Preview), then the build picks them up at compile time.

### Deploy scripts (`scripts/deploy/`)

All run locally; some SSH into the VM. Configure `.env.deploy` with
`VM_HOST`, `VM_USER`, `VM_PATH`, and `VM_SSH_KEY` (gitignored).

| Script | Where | What it does |
| --- | --- | --- |
| `release.sh` | local | End-to-end ship — promote, sync rasters, SSH + vm-deploy |
| `promote.sh` | local | Fast-forward `prod` from `main`, tag the commit, push to GitHub |
| `vm-deploy.sh` | VM | `git fetch` + checkout prod + `docker compose build` + `up -d` |
| `vm-seed-db.sh` | VM | Restore a plain-SQL dump from `/opt/glof/db-imports/` (drops + recreates) |
| `sync-db-dump.sh` | local | Push a fresh `pg_dump` from dev → VM |
| `sync-rasters.sh` | local | Rsync `data/rasters/` → VM raster dir |
| `rollback.sh` | local | Reset the VM to a previous release tag |

### DB backup / restore (`scripts/db/`)

Cross-platform plain-SQL `pg_dump` + restore for the local database.

| Script | Equivalent npm command |
| --- | --- |
| `scripts/db/backup.ps1` / `backup.sh` | `npm run db:backup` |
| `scripts/db/restore.ps1` / `restore.sh` | `npm run db:restore` |

Outputs to `backups/glof-YYYYMMDD-HHMMSS.sql`. Restore takes the path of
a dump as a positional argument.

## Documentation

- **In-app `/docs` page** — operator's manual rendered as a routed page
  with TOC + sections covering layers, components, how-to guides, API
  reference, and deployment notes. Open via the **Docs** icon in the title
  bar.
- [docs/APP_LAUNCH.md](docs/APP_LAUNCH.md) — prerequisites, environment
  setup, local development, production build, troubleshooting.
- [CLAUDE.md](CLAUDE.md) — architectural notes and conventions, primarily
  aimed at AI-assisted development sessions but useful to any contributor.
- [ASSET_MANIFEST.md](ASSET_MANIFEST.md) — legacy → `src/assets/` path map.

## Status

- Frontend scaffold, theming, layout, asset reorganisation, deployment: **complete**.
- PMD parameter integration (backend, cron, map layer, legend, attribute table, trend chart): **complete**.
- Region + secondary GIS layers from PostGIS (per-region accordion + secondary panel + uploaded layers): **complete**.
- Raster pipeline (upload, decode, continuous + classified rendering, pixel-value Feature Details): **complete**.
- CSV ingest + chart: **complete**.
- Feature Details with unit-aware attribute rendering: **complete**.
- Lakes Trend chart from upstream lake data: placeholder until upstream feed lands.

The original implementation under `legacy/` is kept for reference only.
