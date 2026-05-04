# National GLOF Watch

Glacial Lake Outburst Flood monitoring dashboard for the National Disaster Management Authority of Pakistan.

## Overview

National GLOF Watch is an interactive web dashboard for monitoring glacial lake outburst flood (GLOF) hazards across northern Pakistan, covering the Hindu Kush, Karakoram, and Himalaya ranges. It surfaces a satellite basemap of the region with toggleable layers for individual glacial lakes (Badswat, Hinarchi, Reshun, Brep, Darkot, Gulmit, Thalu, Pindoru, Hunza/Ultar, and others), risk-zonation polygons (avalanche, debris flow, bank erosion, flood, landslide, rockfall, urban flood), and partner infrastructure overlays from AKAH, GMRC/WAPDA, and the UNDP-supported GLOF II early-warning station network.

Real-time PMD (Pakistan Meteorological Department) sensor readings are fetched on a 10-minute schedule, persisted in a local PostgreSQL database, and rendered on the map as colored stations with a per-parameter legend, an attribute table with sortable columns, and a per-station trend chart (daily / weekly / past-N-days windows).

The dashboard is intended for NDMA staff, provincial disaster management authorities, partner agencies, and decision-makers who need a single operational view of lake conditions, station readings, and historical incidents.

This repository hosts the React rewrite of the original static HTML/JS dashboard. The legacy implementation is preserved under `legacy/` for reference.

## Tech stack

**Frontend**
- React 18, Vite 5
- Tailwind CSS 3 (dark-mode via class strategy, custom `brand` / `day` / `night` palettes)
- Mapbox GL JS 3.9 (basemap, station circle layers, animated highlight ripples, custom geocoder)
- Chart.js 4 via react-chartjs-2 (PMD trend line chart with legend-binned vertical gradient)
- Framer Motion (panel transitions, animated tab underlines, segmented pill toggles)
- Headless UI (Listbox dropdown, Switch, Disclosure, Dialog, Transition)
- Lucide icons, Inter font

**Backend**
- Node.js + Express
- PostgreSQL (`pg` Pool, two-table schema: `stations` + `station_readings`)
- undici (scoped self-signed-cert tolerant fetch for the PMD upstream)
- `node --watch` for hot reload during development
- `setInterval`-based cron (default 10-minute cadence)

## Project structure

```
national_glof_watch/
├── server/                       Backend (Node + Express + Postgres)
│   ├── index.js                  HTTP bootstrap, cron loop
│   ├── routes/parameters.js      /api/parameters/* endpoints
│   ├── lib/pmd.js                PMD upstream fetch + GeoJSON adapter
│   ├── lib/store.js              Fetch + persist (transactional, dedup-safe)
│   ├── lib/db.js                 pg Pool, ensureSchema()
│   └── sql/schema.sql            stations + station_readings + indexes
├── src/
│   ├── assets/                   Images, videos, GeoJSON, CSV/XLSX
│   ├── components/
│   │   ├── layout/               TitleBar, AppShell, LeftSidebar, RightSidebar, MobileMenu
│   │   ├── ui/                   Button, Input, Select, Tooltip, Accordion, etc.
│   │   └── dashboard/            Dashboard, MapPanel, MapControls, MapLegend,
│   │                             MapGeocoder, BasemapSwitcher, ParametersPanel,
│   │                             LayerMenu, StationsTable, ChartsRow,
│   │                             QuickToggles, AlertsPanel, VideoPanels
│   ├── contexts/                 ThemeContext, ParameterContext
│   ├── config/                   env, mapbox, parameterColors, parameterLegends,
│   │                             glacierLayer, theme
│   ├── hooks/                    useTheme, useMediaQuery, useFullscreen
│   ├── utils/                    cn, timeAgo, formatters
│   ├── styles/index.css          Tailwind directives + universal classes
│   ├── App.jsx                   ThemeProvider → ParameterProvider → AppShell → Dashboard
│   └── main.jsx                  Vite entry
├── docs/APP_LAUNCH.md            Setup, deployment, troubleshooting
├── legacy/                       Original HTML/JS dashboard (reference only)
├── data/, Alerts/, Maps/         Legacy asset folders (pending cleanup)
├── index.html                    Vite HTML entry
├── package.json                  Dependencies and npm scripts
├── tailwind.config.js            Tailwind theme + dark mode
├── vite.config.js                Vite config (proxy /api → :3001)
├── .env.example                  Template for required environment variables
├── README.md                     This file
├── ASSET_MANIFEST.md             Legacy → src/assets path map
└── CLAUDE.md                     Architectural notes for AI-assisted development
```

## Quick start

The app is two processes: the Vite dev server (frontend) and the Express server (backend). Both must be running for the PMD parameter views to work; the rest of the dashboard works with just the frontend.

```powershell
# 1. One-time setup
cp .env.example .env                     # then fill in VITE_MAPBOX_TOKEN and PG_*
createdb -U postgres glof                # create the local database
npm install

# 2. Day-to-day (use two terminals)
npm run server                           # terminal A: Express + cron, http://localhost:3001
npm run dev                              # terminal B: Vite, http://localhost:5174
```

Open `http://localhost:5174`. Vite proxies `/api/*` to `http://localhost:3001` so the frontend talks to the backend on the same origin.

For a production frontend bundle, run `npm run build`. The output is a fully static `dist/` directory. The backend stays a long-running Node process (e.g. PM2 / systemd / a container) that the static frontend talks to over `/api`.

### npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on `http://localhost:5174` |
| `npm run server` | Express backend + cron on `http://localhost:3001` (uses `node --watch`) |
| `npm run build` | Production frontend bundle in `dist/` |
| `npm run preview` | Serve `dist/` locally for sanity check |
| `npm run lint` | ESLint |

## Backend overview

### Schema

Two tables live in the `glof` database:

- `stations` — stable identity per sensor: `station_id` (BIGINT PK), `station_name`, `lat`, `lon`, `first_seen`, `last_seen`. Upserted on every fetch.
- `station_readings` — measurement facts: `id` BIGSERIAL, `station_id` FK, `element`, `value`, `unit`, `last_update`, `fetched_at`. Constrained by `UNIQUE (station_id, element, last_update)` so replaying a fetch with no new upstream timestamps is a no-op.

`ensureSchema()` runs `server/sql/schema.sql` on backend boot — safe to re-run.

### Cron

Every `STORE_INTERVAL_MIN` minutes (default 10) the backend fetches all five PMD elements, upserts stations, and inserts new readings. The upstream returns the same `lastUpdate` for stations that haven't reported since the previous cycle, so the unique constraint quietly dedupes them.

### Endpoints

All endpoints live under `/api/parameters`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/` | List supported PMD elements |
| `GET`  | `/status` | `{ [element]: { lastFetchedAt, stationCount } }` for the "Last updated…" labels |
| `GET`  | `/:element/latest` | DB-backed FeatureCollection — latest reading per station, used by the map |
| `GET`  | `/:element/geojson` | Live FeatureCollection (proxies the PMD upstream) |
| `GET`  | `/:element/stations/:stationId/trend?bucket=hour\|day&days=N` | Aggregated trend (24 h hourly / N-day daily averages) for the chart |
| `POST` | `/:element/store` | Manual fetch + persist for one element |
| `POST` | `/refresh-all` | Manual fetch + persist for all five elements (mirrors the cron cycle) |

The five canonical PMD elements are `Air Temperature`, `Total Rain`, `Water Level`, `Compact GAS State (WPs)`, and `Istantaneous Flow` (the typo is preserved upstream). All readings are stored under the canonical element name regardless of how the upstream labels them per-station.

## Environment variables

Frontend variables must be prefixed with `VITE_`. Backend variables don't have a prefix and are loaded by the server via `dotenv/config`. Copy `.env.example` to `.env` and fill in the values below.

| Variable | Required | Used by | Description |
| --- | --- | --- | --- |
| `VITE_MAPBOX_TOKEN` | Yes | frontend | Mapbox public access token (`pk.*`). The basemap and the geocoder both rely on this. |
| `VITE_GEOSERVER_BASE_URL` | Yes | frontend | Federal NDMA GeoServer (typically `http://172.18.1.85:8080/geoserver`) for WFS layers. |
| `VITE_GEOSERVER_PROVINCIAL_URL` | Yes | frontend | Provincial GeoServer (`http://172.18.1.4:8080/geoserver`) for boundary layers. |
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
| `STORE_INTERVAL_MIN` | No | backend | Cron cadence in minutes (default 10, capped at sane range by `Math.max(1, …)`). |

See [docs/APP_LAUNCH.md](docs/APP_LAUNCH.md) for guidance on sourcing each value.

## UI

### Layout

The `AppShell` mounts a fixed brand-navy `TitleBar` and an `<main>` offset by `pt-16`. `Dashboard` puts a `LeftSidebar` (Parameters + Layers icon strip with stackable expand panels) on the left, a vertical column of `QuickToggles` → `MapPanel` → `ChartsRow` in the middle, and a `RightSidebar` (Videos + Alerts icon strip) on the right. The mobile breakpoint replaces both sidebars with off-canvas drawers.

### Map

`MapPanel` overlays five custom widgets on a Mapbox canvas:

- **Top-left**: Collapsible `BasemapSwitcher` (icon button → slides out 5 chips: Satellite / Streets / Outdoors / Light / Dark).
- **Top-right (just inboard of MapControls)**: Custom themed `MapGeocoder` (Mapbox geocoding REST API direct, day/night styled, biased to the current map center, drops an amber marker on result selection).
- **Right**: `MapControls` — vertical stack of minimal lucide-icon buttons for zoom in/out, reset bearing, locate, projection toggle (Mercator ↔ Globe), and fullscreen. The fullscreen target is the wrapping div, so all overlays travel with the map into fullscreen.
- **Bottom-left**: `MapLegend` — color bins for the active parameter plus the universal "No update (>10h)" gray.
- **Bottom-right**: `StationsTable` — Headless UI dropdown for the parameter, sortable Station / Value / Updated columns, color dot per row, click a row → fly the map to the station and trigger an animated ripple highlight; click again to clear.

Native Mapbox controls (`NavigationControl`, `GeolocateControl`, `FullscreenControl`, `ScaleControl`) and the `mapboxgl-ctrl-bottom-*` corners are hidden — every interaction is owned by the custom React layer for a unified minimal design.

### Stations on map

`circle-radius` is zoom-interpolated so dots stay legible at every level (`6.25 px` at z7 → `17.5 px` at z16). Color is computed per-feature from `parameterLegends.js` so the dots literally show the legend bin (e.g. blue for sub-zero temperatures, red for >40 m³/s flow). Stale or null readings are gray. Selecting a station triggers two phase-shifted ripple layers (radar pulse) at `#fbbf24`.

### Charts

`ChartsRow` is tabbed: **PMD Data Trend** (default) and **Lakes Trend**. The PMD tab shows a per-station, per-parameter line chart with a segmented `Daily | Weekly | Custom` toggle; Custom reveals a `Past [N] days` number input to its right. The line and fill use a Chart.js scriptable color that builds a vertical CanvasGradient mapped onto the parameter's legend bins, so the line literally crosses through the bin colors as the values change. The Lakes tab keeps the original Lake Area / Lake Volume placeholders, ready to be wired once data lands. Both tabs share a fixed minimum body height so the card doesn't reflow on tab swap.

## Theming

The dashboard supports a day and a night theme via Tailwind's `dark` class on `<html>`. The toggle lives in the titlebar; the user's choice is persisted in `localStorage` under the `theme` key, and the system preference is read on first load. The navy titlebar (`#002060`) is intentionally constant in both themes — it is part of the NDMA brand. The accent color used for active buttons, focus rings, tab underlines, and toggle pills is `#16a085` (with `#138b72` hover, `#0f7560` active) and is unified across both themes.

## Universal component classes

To keep the UI visually consistent, prefer the shared utility classes defined in `src/styles/index.css` over per-component ad-hoc styling.

- Buttons: `.btn-primary`, `.btn-secondary`, `.btn-light`, `.btn-dark`, `.btn-ghost`, `.btn-danger`, `.btn-icon` (with size modifiers `.btn-sm/md/lg`)
- Inputs: `.input-base`, `.input-search`
- Selects: `.select-base`
- Surfaces: `.card-base`, `.panel-base`, `.panel-header`

When building a new component, reach for these first; only add bespoke Tailwind classes when none of the above fit.

## Status

- Frontend scaffold, theming, layout, and asset reorganisation: complete.
- PMD parameter integration (backend, cron, map layer, legend, attribute table, trend chart): complete.
- Lakes Trend chart: placeholder UI in place; awaiting upstream data wiring.
- Glacial-lake / risk-zonation / partner-infrastructure layers from GeoServer: scaffold-only; the per-region accordion in the Layers menu is search-filterable but the actual layer toggles are not yet bound to live WFS sources.

The original implementation under `legacy/` is the authoritative reference for behaviour and visual detail until the React port reaches feature parity.

## Documentation

- [docs/APP_LAUNCH.md](docs/APP_LAUNCH.md) — prerequisites, environment setup, local development, production build and deployment, troubleshooting.
- [ASSET_MANIFEST.md](ASSET_MANIFEST.md) — legacy → `src/assets/` path mapping for every renamed file.
- [CLAUDE.md](CLAUDE.md) — architectural notes and conventions, primarily aimed at AI-assisted development sessions but useful to any new contributor.
