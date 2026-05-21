# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"National GLOF Monitoring" — a Glacial Lake Outburst Flood monitoring dashboard. Two-process app:

- **Frontend**: React 18 + Vite 5 + Tailwind CSS 3 SPA at the project root. Two routes via React Router 7: `/` (dashboard) and `/docs` (in-app operator's manual).
- **Backend**: Node + Express + PostgreSQL/PostGIS under `server/`. Owns the PMD weather-station fetch cron, the database schema, and the `/api/parameters/*`, `/api/region/*`, `/api/secondary/*`, `/api/gis/*`, `/api/rasters/*`, `/api/upload/*`, `/api/csv/*`, `/api/db/*` endpoints.

The original HTML/JS implementation is preserved under [legacy/](legacy/) for reference; the React app is the deliverable.

Current feature state:
- PMD parameter integration (Datascape v3 API — full element catalog, live readings, per-station alert thresholds): **wired**. The map colors stations by their real-time **alert state** (Normal / Warning / Pre-alarm / Alarm / Error) against each station's own thresholds; the element selector, legend, attribute table and Feature Details threshold table are all driven off this. The PMD Data Trend chart stays value-based.
- Region + secondary GIS layers served from PostGIS (region.js + secondary.js): **wired**. Layer Menu accordion + Secondary panel toggle live data. Frontend layerSources.js drops the old `import.meta.glob` approach in favour of API URLs.
- Raster pipeline (upload, decode, continuous + classified rendering, pixel-value sampling for Feature Details): **wired**.
- Feature Details tab (4th tab in ChartsRow) — clicked features + raster pixels render in a card layout with unit-aware values (m / km / m² / km² / m³ / °C / mm / …). Server attaches derived `area_m2` / `area_km2` / `perimeter_m` / `perimeter_km` (polygons) and `length_m` / `length_km` (lines) per feature.
- CSV import + chart, GeoJSON / shapefile uploads: **wired**.
- Deploy stack: Docker compose (db + backend + frontend) with prod overlay; Vercel config rewriting `/api/*` to the VM. `scripts/deploy/release.sh` orchestrates a full ship.
- Lakes Trend chart from upstream lake data: still a placeholder until that feed lands.

## Common commands

```powershell
npm install            # first run only
createdb -U postgres glof   # one-time, before npm run server
npm run dev            # frontend Vite dev server at http://localhost:5174 (long-running)
npm run server         # backend Express + cron at http://localhost:3001 (long-running, node --watch)
npm run build          # static frontend production build to dist/
npm run preview        # serve dist/ locally
npm run lint           # eslint flat config
```

There is no test runner configured.

The frontend's Vite proxy forwards `/api/*` to `http://localhost:3001`, so both processes need to be running for the parameter views to work. Most other parts of the dashboard work with just the frontend.

## Repo layout

```
national_glof_watch/
├── server/                       # Backend (Node + Express + Postgres)
│   ├── index.js                  # HTTP bootstrap, value cron (10-min) + threshold cron (~30-day)
│   ├── routes/parameters.js      # /api/parameters/* endpoints
│   ├── lib/datascape.js          # Datascape v3 API client (token auth, v1/v3 fetch, entryCfgs decoder)
│   ├── lib/store.js              # 10-min value cron — per-station v3 fetch + persist
│   ├── lib/thresholds.js         # monthly threshold sweep (entryCfgs → element_thresholds)
│   ├── lib/pmd.js                # legacy EWS — retained only for the station-status badge
│   ├── lib/db.js                 # pg Pool, ensureSchema()
│   └── sql/schema.sql            # stations + station_readings + station_elements + element_thresholds
├── index.html                    # Vite entry — Inter font preconnect, snowflake favicon, mounts /src/main.jsx
├── package.json                  # type: module
├── vite.config.js                # @ alias → /src; proxies /api → :3001
├── tailwind.config.js            # darkMode: 'class', brand/day/night/accent palettes, Inter font
├── postcss.config.js
├── eslint.config.js              # flat config
├── jsconfig.json                 # @/* alias for editor IntelliSense
├── .env / .env.example           # frontend VITE_* + backend PORT/PG_*/STORE_INTERVAL_MIN/DATASCAPE_*
├── README.md                     # public-facing project overview
├── ASSET_MANIFEST.md             # legacy → src/assets path map (every renamed file)
├── docs/
│   └── APP_LAUNCH.md             # detailed deploy / troubleshooting guide
├── src/
│   ├── main.jsx                  # ReactDOM.createRoot + App
│   ├── App.jsx                   # BrowserRouter + ThemeProvider; routes / (dashboard) and /docs
│   ├── styles/index.css          # Tailwind directives + universal component classes
│   ├── config/                   # env.js, mapbox.js, theme.js, glacierLayer.js,
│   │                             # parameterColors.js (chart accent palette),
│   │                             # alertStates.js (alert-state palette + classifyState),
│   │                             # parameterLegends.js (chart gradient stops + helpers)
│   ├── contexts/
│   │   ├── ThemeContext.jsx
│   │   └── ParameterContext.jsx  # selected element, element catalog, selectedStation,
│   │                             # statuses, stations features, disabledStates,
│   │                             # fetchThresholds, refresh / refreshAll, busy
│   ├── hooks/                    # useTheme, useMediaQuery, useFullscreen
│   ├── utils/                    # cn (clsx wrapper), timeAgo, formatters
│   ├── components/
│   │   ├── layout/               # TitleBar, AppShell, LeftSidebar, RightSidebar, MobileMenu, MediaSwitcher
│   │   ├── ui/                   # Button, Input, Select, SearchBox, Toggle, Card, Panel, Modal, Accordion, Badge, Spinner, Tooltip
│   │   └── dashboard/            # Dashboard, MapPanel, MapControls, MapLegend,
│   │                             # MapGeocoder, BasemapSwitcher, StationsTable,
│   │                             # ParametersPanel, LayerMenu, ChartsRow,
│   │                             # QuickToggles, AlertsPanel, VideoPanels
│   └── assets/
│       ├── index.js              # barrel: { logos, icons, misc, alerts, maps, videos, paths }
│       ├── images/{logos,icons,alerts,maps,misc}/
│       ├── videos/
│       └── data/{csv,excel,geojson}/
├── legacy/                       # original HTML/JS app (index.html + template/) — reference only
├── data/, Alerts/, Maps/         # original asset folders, kept until migration is verified
└── dist/                         # vite build output (gitignored)
```

## Architecture

### Composition

`App` wraps everything in `BrowserRouter` + `ThemeProvider`, then `Routes` splits `/` (the dashboard tree of providers + AppShell + Dashboard) from `/docs` (DocsPage — its own minimal layout that reuses TitleBar). `AppShell` renders the fixed `TitleBar` and a `<main>` with class `titlebar-content-offset` (= `pt-16`) so content never overlaps the titlebar. The dashboard-specific providers (ParameterContext, MapContext, RasterContext, …) are mounted on the dashboard route only — DocsPage doesn't need them and keeping them on `/` avoids the Parameter cron firing while the user is just reading the manual. `Dashboard` lays out:

- `LeftSidebar` (icon strip with stackable `ParametersPanel` + `LayerMenu` content panels)
- middle column: `QuickToggles` → `MapPanel` → `ChartsRow`
- `RightSidebar` (icon strip with `VideoPanels` + `AlertsPanel`)

Mobile breakpoint replaces the sidebars with `MobileMenu` (off-canvas drawer) opened from the titlebar hamburger.

### ParameterContext

Lives at [src/contexts/ParameterContext.jsx](src/contexts/ParameterContext.jsx). One provider mounted high in the tree owns:

- `elements` — the full element catalog `[{ name, unit, stationCount }]`, fetched on mount via `GET /api/parameters/elements`. The element list is **dynamic** (40+ elements network-wide), not hardcoded.
- `selected` / `select(id)` / `setSelected` — the active element name. Cleared if it vanishes from the catalog after a reload.
- `statuses` — `{ [element]: { lastFetchedAt, stationCount } }` for the "Last updated…" labels. Loaded on mount via `GET /api/parameters/status`.
- `stations` — the `features` array from the latest FeatureCollection. Re-fetched whenever `selected` changes via `loadStations()`. Each feature carries `stateId` + `elementId`.
- `selectedStation` / `setSelectedStation` — the station highlighted on the map / scrolled-to in the table. Two-way synced between map clicks (in `MapPanel`) and row clicks (in `StationsTable`). Both directions are toggles: clicking the same target twice clears the selection.
- `disabledStates` / `toggleState(stateId)` — the set of alert-state keys hidden via the legend; the map circles and the attribute table both filter against it.
- `fetchThresholds(elementId)` — fetches a station-element's decoded alert bands for the Feature Details threshold table.
- `refresh(element)` / `refreshAll()` — manual `POST /refresh-all` (one full v3 value cycle). Updates `statuses` and reloads `stations`. `busy` reflects the in-flight call (element id, or `'ALL'`).

`MapPanel` and `StationsTable` both consume from the same context, so there's a single network call per parameter switch.

### Map (`src/components/dashboard/MapPanel.jsx` + sibling overlays)

Five custom React overlays sit on top of the Mapbox canvas:

- **Top-left** `BasemapSwitcher` — collapsible, default state is just a Layers icon button; click expands a row of 5 chips.
- **Top-right inboard** `MapGeocoder` — custom themed search using the Mapbox geocoding REST API (no `@mapbox/mapbox-gl-geocoder` dependency). Drops an amber `mapboxgl.Marker` on result selection.
- **Top-right** `MapControls` — vertical stack of minimal lucide-icon buttons: zoom in/out, reset bearing (Navigation2 with bearing-based rotation), locate, projection toggle (Mercator ↔ Globe via `map.setProjection`), fullscreen. The fullscreen target is the wrapping `relative` div in `MapPanel` so all overlays travel with the map.
- **Bottom-left** `MapLegend` — the categorical 6-row alert-state legend (Normal / Warning / Pre-alarm / Alarm / Error / No data). Rows are clickable to hide/show that state on the map.
- **Bottom-right** `StationsTable` — sortable Station / State / Value / Updated columns (`ArrowUp/Down/UpDown` indicators), a state-colored dot + label per row, click a row → fly the map to the station + populate Feature Details.

Native Mapbox controls (`NavigationControl`, `GeolocateControl`, `FullscreenControl`, `ScaleControl`) and the `mapboxgl-ctrl-bottom-*` corners are hidden — every interaction is owned by the custom React layer for a unified minimal design.

Station rendering uses three `circle` layers backed by one `parameter-stations` GeoJSON source:

- `parameter-stations-halo` — soft outer disc, opacity 0.18, color from the alert state.
- `parameter-stations-circle` — crisp filled dot with a `#0f172a` hairline.
- `parameter-stations-ripple-1` / `parameter-stations-ripple-2` — two phase-shifted amber rings, filtered to the selected `stationId`, animated by a `requestAnimationFrame` loop while a station is selected (radar pulse). The filter defaults to `['==', ['get', 'stationId'], -1]` so it matches nothing when nothing is selected.

`circle-radius` for the dot and halo is zoom-interpolated, anchored at the default zoom (z7) and scaling up at higher zoom. Each feature gets a `color` + `state` property computed in JS via `classifyState(stateId)` from [src/config/alertStates.js](src/config/alertStates.js); Mapbox reads `color` via `['get', 'color']` and filters on `state`. `stateId` is PMD's own alert classification. A station is colored by its real alert state **regardless of reading age** — an old-but-valid reading keeps its true state and its age shows in the table's "Updated" column. Only a station with no classified reading at all (null `stateId`) falls back to the gray "No data" state.

### Charts (`src/components/dashboard/ChartsRow.jsx`)

Tabbed card with two views: **PMD Data Trend** (default) and **Lakes Trend**. The wrapping `<div>` has a fixed responsive `min-h` so the card doesn't reflow when the tab changes.

The PMD tab shows a per-station, per-element line chart of the **raw** readings (no aggregation) fetched from `GET /api/parameters/:el/stations/:id/trend?days=N`. Three modes: **Daily** (1 day), **Weekly** (7 days), **Custom** (N days, with a `Past [ N ] days` number input). The chart is value-based and entirely independent of the map's alert-state symbology.

The line and fill use Chart.js scriptable colors that build a vertical CanvasGradient from `parameterLegends.PARAMETER_GRADIENTS` mapped onto the chart's live `scales.y` and `chartArea`. Only a few elements have a curated gradient; every other element falls back to a themed two-stop brand gradient (`brandGradient` in `ChartsRow`), so the chart works for the full v3 element catalog.

### Theming

- Tailwind `darkMode: 'class'`. `ThemeContext` toggles `dark` on `document.documentElement`, persists to `localStorage` under `theme`, and seeds from `prefers-color-scheme`.
- Two surface palettes: `day.{bg,surface,border,text,muted}` and `night.{...}`. Almost every component uses both: `bg-day-bg dark:bg-night-bg`, `text-day-text dark:text-night-text`, etc.
- The titlebar is intentionally constant in **both** themes (deep emerald) — it's the brand bar. Do not add a `dark:` override on it that changes its identity.
- The accent color used across both themes for active buttons / focus rings / tab underlines / toggle pills is the Tailwind **lime** family — primary **`#84cc16`** (hover `#65a30d`, active `#4d7c0f`). This is unified day+night for consistency. Because lime-500 is bright, text/icons placed *on* a lime fill use the dark lime `#1a2e05`, **not white** (white fails contrast). The titlebar theme toggle uses a `text-yellow-300` filled `Sun` icon and a `text-white` filled `Moon` icon.

### Universal component classes ([src/styles/index.css](src/styles/index.css))

The project's design system. **Do not write per-component button/input styles** — extend the class set in `index.css` instead.

- Buttons: `.btn-base`, sizes `.btn-sm/md/lg`, variants `.btn-primary` (`bg-[#84cc16] text-[#1a2e05]`), `.btn-secondary`, `.btn-light`, `.btn-dark`, `.btn-ghost`, `.btn-danger`, `.btn-icon`. `Button.jsx` wraps these with a `variant` prop.
- Inputs: `.input-base`, `.input-search` (with leading-icon padding).
- Select: `.select-base`.
- Surfaces: `.card-base`, `.panel-base`, `.panel-header`.
- Misc: `.label-base`, `.chip`.
- Layout: `.titlebar`, `.titlebar-content-offset` — the contract that keeps content from overlapping the fixed titlebar.

### Brand color

`brand-900 = #002060` was the original brand navy and is preserved in the palette for legacy uses. The active titlebar palette is the deep-emerald `bg-emerald-950` / `bg-emerald-900` pair (see `.titlebar` in `src/styles/index.css`) — the titlebar stays emerald and is **not** lime. For active-state UI accents (buttons, focus rings, active tabs, toggle pills), use the literal lime `#84cc16` family directly via arbitrary Tailwind values — not `brand-700`. `brand-700 dark:text-brand-200` is only used for decorative panel-header icons.

### Assets

All assets live under [src/assets/](src/assets/), renamed to lowercase + underscores. The barrel at [src/assets/index.js](src/assets/index.js) exports common assets as Vite-resolved URLs (`logos`, `icons`, `misc`, `alerts`, `maps`, `videos`) plus a `paths` object for non-Vite contexts. `AlertsPanel` uses `import.meta.glob('../../assets/images/alerts/*', { eager: true, query: '?url' })` so it auto-discovers files dropped into the folder. `VideoPanels` uses `new URL('../../assets/videos/<file>.mp4', import.meta.url).href`. Both patterns survive `vite build`.

The legacy → new path map is in [ASSET_MANIFEST.md](ASSET_MANIFEST.md) at root. Larger binaries (videos, hi-res images, .xlsx) are tracked via Git LFS — `git lfs install` is required before cloning.

### Environment

- Frontend config goes through `import.meta.env.VITE_*` and is centralized in [src/config/env.js](src/config/env.js). The Mapbox token previously hard-coded in `legacy/template/map_init.js` is now `VITE_MAPBOX_TOKEN`. Two GeoServer base URLs are split (federal `172.18.1.85:8080`, provincial `172.18.1.4:8080`) — most layers will silently return empty data off the LAN.
- Backend config is read via `dotenv/config` in `server/index.js`: `PORT`, `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`, `STORE_INTERVAL_MIN` (default 10), `THRESHOLD_INTERVAL_DAYS` (default 30), and `DATASCAPE_*` (base URL + credentials for the v3 API — `server/lib/datascape.js` also carries working defaults).

### Path alias

`@/*` resolves to `src/*` (Vite + jsconfig). Use it for imports — `import { useTheme } from '@/hooks/useTheme'`.

### Backend

The PMD pipeline runs on the **Datascape v3 API** (`http://115.186.56.181/datascapea`, plain HTTP, token-authenticated). The legacy EWS PHP API is retired except for the station-status badge.

- **`server/lib/datascape.js`** — the v3 client: `getToken()` (cached, refreshes on 401), `fetchStationList()` (`/v1/elements`), `fetchStationElements(id)` (`/v3/elements?station_id=`), `fetchElementDetail(id)` (`/v3/elements/{id}`), and `parseEntryCfgs()` — the `entryCfgs` → labelled-bands decoder. `stateLabel(stateId)` maps the 0-100 alert score to a name.
- `ensureSchema()` runs `server/sql/schema.sql` on boot (fatal on failure). Four tables: `stations` (PK `station_id`, holds lat/lon), `station_readings` (FK to `stations`, `UNIQUE (station_id, element, last_update)`, plus `element_id` + `state_id`), `station_elements` (the element catalog, PK `element_id`), `element_thresholds` (decoded alert bands as JSONB `alarms`, PK `element_id`).
- **Two crons**, both plain `setInterval` started 2 s after `app.listen`, each guarded against re-entry:
  - **Value cron** — `runStoreCycle` → `storeAllStations()` (`server/lib/store.js`) every `STORE_INTERVAL_MIN` (10). Loops every station, `/v3/elements?station_id=`, upserts the catalog + inserts readings with `value`, `state_id`, `element_id`.
  - **Threshold cron** — `runThresholdCycle` → `refreshAllThresholds()` (`server/lib/thresholds.js`) every `THRESHOLD_INTERVAL_DAYS` (30). Heavy sweep: per element, `/v3/elements/{id}` → `parseEntryCfgs` → upsert `element_thresholds`; also refreshes `stations.lat/lon`. Runs at boot only if `element_thresholds` is empty. Also runnable via `npm run db:seed-elements` and `POST /api/parameters/thresholds/refresh`.
- `element_id` is the per-station-per-element instance id (globally unique); the element NAME is shared across stations and keys the selector + `/latest`.
- Endpoints under `/api/parameters`:
  - `GET /elements` — the element catalog `{ elements: [{ name, unit, stationCount }] }` (`GET /` is a legacy alias).
  - `GET /status` — per-element `{ lastFetchedAt, stationCount }`.
  - `GET /:element/latest` — catalog-driven FeatureCollection: one feature per station that *has* the element, `LEFT JOIN`ed to its latest reading (a non-reporting station comes back with null `value`/`stateId` → renders as the gray "No data" state, never drops off the map).
  - `GET /:element/stations/:stationId/trend?days=N` — raw time-series for the chart (keyed on element name + station, so legacy EWS rows and v3 rows merge).
  - `GET /element/:elementId/thresholds` — decoded alert bands for the Feature Details threshold table.
  - `GET /thresholds/status` · `POST /thresholds/refresh` — threshold-job status + manual trigger.
  - `POST /refresh-all` — one full v3 value cycle now.
  - `GET /stations/:id/photos` · `GET /station-photo` — station photo catalog + binary proxy.

## Conventions when editing

- Universal classes first. New buttons should use `<Button variant="...">`. New inputs should use `<Input>`/`<Select>`/`<SearchBox>`. If a needed variant doesn't exist, add it to `index.css` and the `VARIANTS` map in the wrapper component — don't bypass with raw Tailwind.
- Day + night together. Every color utility should have its `dark:` counterpart unless the element is explicitly brand-bound (e.g. the titlebar) or uses the unified `#84cc16` lime accent.
- Use the lime accent directly via `bg-[#84cc16]` / `text-[#84cc16]` / `ring-[#84cc16]` for active-state UI — both day and night. Text/icons placed *on* a lime fill use `text-[#1a2e05]` (lime is too bright for white). Don't reintroduce the old teal `#16a085`.
- Animations via Framer Motion (already a dep). Standard pattern: `initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}`. Use `whileHover`/`whileTap` for micro-interactions on interactive elements. `motion.layoutId` works well for sliding underlines and pill toggles.
- Mapbox configuration belongs in `src/config/mapbox.js`. Don't re-read `import.meta.env` from inside components.
- New map sources/layers go inside the `style.load` handler in `MapPanel` (or via the `applyStationLayers` pattern) so they survive basemap swaps. Don't replicate the legacy "everything in one giant style.load handler" — split per-region.
- Don't reintroduce inline `onclick=` handlers, global mutable variables, or jQuery/Bootstrap-style imperative DOM mutation. The legacy code did this heavily; the React port should not.
- Don't fall back to `legacy/` at runtime. It exists for reference only — copy patterns out of it, don't import from it.
- For new fetches that both `MapPanel` and `StationsTable` (or any other consumer) would need, lift them into `ParameterContext` rather than fetching independently.

## Things to be aware of

- The build emits one chunk over Vite's 500 kB warning threshold (Mapbox GL + Chart.js dominate). Code-splitting (lazy-loading `MapPanel`/`ChartsRow`) is the natural fix when the app is fleshed out.
- `data/`, `Alerts/`, `Maps/` at the project root still exist as the source of the asset migration. They can be deleted once `src/assets/` is verified, but only after user confirmation — they are the source of truth for the manifest.
- The legacy GeoJSON files in [src/assets/data/geojson/](src/assets/data/geojson/) are still `.js` files declaring globals (e.g. `const badswatGlacierSource = {...}`) — they need to be converted to ESM exports or proper `.json` when those layers get wired into `MapPanel`.
- The Mapbox wordmark and bottom-right attribution are CSS-hidden in [src/styles/index.css](src/styles/index.css). Mapbox ToS may require visible attribution in production — confirm with stakeholders before going public.
- `npm install` reports a few audit advisories; not addressed during scaffolding to avoid forced major-version upgrades.
- `node --watch` reloads on `server/**` changes but **not** on `.env` changes — restart `npm run server` manually after editing the env file.
- The Datascape `lastUpdate` for a station may not advance every 10 min (some sensors only report hourly). The `UNIQUE (station_id, element, last_update)` constraint dedupes the repeats quietly — a low `+readings` count in the cron log is normal, not a bug.
- The v3 `/v3/elements?station_id=` list **omits elements that aren't currently reporting**, so a station's element set fluctuates per fetch. `station_elements` (the catalog, rebuilt monthly) is the stable source of truth for which stations have which element; `/:element/latest` is catalog-driven so a silent station shows as gray "No data" rather than vanishing.
