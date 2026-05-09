# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"National GLOF Monitoring" — a Glacial Lake Outburst Flood monitoring dashboard. Two-process app:

- **Frontend**: React 18 + Vite 5 + Tailwind CSS 3 SPA at the project root. Two routes via React Router 7: `/` (dashboard) and `/docs` (in-app operator's manual).
- **Backend**: Node + Express + PostgreSQL/PostGIS under `server/`. Owns the PMD weather-station fetch cron, the database schema, and the `/api/parameters/*`, `/api/region/*`, `/api/secondary/*`, `/api/gis/*`, `/api/rasters/*`, `/api/upload/*`, `/api/csv/*`, `/api/db/*` endpoints.

The original HTML/JS implementation is preserved under [legacy/](legacy/) for reference; the React app is the deliverable.

Current feature state:
- PMD parameter integration (live data + map layer + legend + attribute table + trend chart): **wired**.
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
│   ├── index.js                  # HTTP bootstrap, cron loop (10-min default)
│   ├── routes/parameters.js      # /api/parameters/* endpoints
│   ├── lib/pmd.js                # PMD upstream fetch + GeoJSON adapter (undici, scoped self-signed cert)
│   ├── lib/store.js              # Fetch + persist (transactional, ON CONFLICT dedup)
│   ├── lib/db.js                 # pg Pool, ensureSchema()
│   └── sql/schema.sql            # stations + station_readings + indexes
├── index.html                    # Vite entry — Inter font preconnect, snowflake favicon, mounts /src/main.jsx
├── package.json                  # type: module
├── vite.config.js                # @ alias → /src; proxies /api → :3001
├── tailwind.config.js            # darkMode: 'class', brand/day/night/accent palettes, Inter font
├── postcss.config.js
├── eslint.config.js              # flat config
├── jsconfig.json                 # @/* alias for editor IntelliSense
├── .env / .env.example           # frontend VITE_* + backend PORT/PG_*/STORE_INTERVAL_MIN
├── README.md                     # public-facing project overview
├── ASSET_MANIFEST.md             # legacy → src/assets path map (every renamed file)
├── docs/
│   └── APP_LAUNCH.md             # detailed deploy / troubleshooting guide
├── src/
│   ├── main.jsx                  # ReactDOM.createRoot + App
│   ├── App.jsx                   # BrowserRouter + ThemeProvider; routes / (dashboard) and /docs
│   ├── styles/index.css          # Tailwind directives + universal component classes
│   ├── config/                   # env.js, mapbox.js, theme.js, glacierLayer.js,
│   │                             # parameterColors.js (chip/dot palette),
│   │                             # parameterLegends.js (bins + gradient stops + helpers)
│   ├── contexts/
│   │   ├── ThemeContext.jsx
│   │   └── ParameterContext.jsx  # selected element, selectedStation, statuses,
│   │                             # stations features, refresh / refreshAll, busy
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

- `selected` / `select(id)` / `setSelected` — the active PMD element (one of the five canonical names).
- `statuses` — `{ [element]: { lastFetchedAt, stationCount } }` for the "Last updated…" labels. Loaded once on mount via `GET /api/parameters/status`.
- `stations` — the `features` array from the latest DB-backed FeatureCollection. Re-fetched whenever `selected` changes via `loadStations()`.
- `selectedStation` / `setSelectedStation` — the station highlighted on the map / scrolled-to in the table. Two-way synced between map clicks (in `MapPanel`) and row clicks (in `StationsTable`). Both directions are toggles: clicking the same target twice clears the selection.
- `refresh(element)` / `refreshAll()` — manual fetch + persist. Updates `statuses` and reloads `stations`. `busy` reflects the in-flight call (element id, or `'ALL'`).

`MapPanel` and `StationsTable` both consume from the same context, so there's a single network call per parameter switch.

### Map (`src/components/dashboard/MapPanel.jsx` + sibling overlays)

Five custom React overlays sit on top of the Mapbox canvas:

- **Top-left** `BasemapSwitcher` — collapsible, default state is just a Layers icon button; click expands a row of 5 chips.
- **Top-right inboard** `MapGeocoder` — custom themed search using the Mapbox geocoding REST API (no `@mapbox/mapbox-gl-geocoder` dependency). Drops an amber `mapboxgl.Marker` on result selection.
- **Top-right** `MapControls` — vertical stack of minimal lucide-icon buttons: zoom in/out, reset bearing (Navigation2 with bearing-based rotation), locate, projection toggle (Mercator ↔ Globe via `map.setProjection`), fullscreen. The fullscreen target is the wrapping `relative` div in `MapPanel` so all overlays travel with the map.
- **Bottom-left** `MapLegend` — color bins for the active parameter plus the "No update (>10h)" gray.
- **Bottom-right** `StationsTable` — Headless UI Listbox dropdown for the parameter, sortable Station / Value / Updated columns (`ArrowUp/Down/UpDown` indicators), color dot per row, click a row → fly the map to the station.

Native Mapbox controls (`NavigationControl`, `GeolocateControl`, `FullscreenControl`, `ScaleControl`) and the `mapboxgl-ctrl-bottom-*` corners are hidden — every interaction is owned by the custom React layer for a unified minimal design.

Station rendering uses three `circle` layers backed by one `parameter-stations` GeoJSON source:

- `parameter-stations-halo` — soft outer disc, opacity 0.18, color from `colorForReading(...)`.
- `parameter-stations-circle` — crisp filled dot with a `#0f172a` hairline (so even the "0 mm" white reads on light basemaps).
- `parameter-stations-ripple-1` / `parameter-stations-ripple-2` — two phase-shifted amber rings, filtered to the selected `stationId`, animated by a `requestAnimationFrame` loop while a station is selected (radar pulse). The filter defaults to `['==', ['get', 'stationId'], -1]` so it matches nothing when nothing is selected.

`circle-radius` for the dot and halo is zoom-interpolated, anchored at the default zoom (z7) and scaling up at higher zoom. Color is computed per-feature in JS via `colorForReading(element, value, lastUpdate)` and read by Mapbox via `['get', 'color']`. Stale (>10h since `lastUpdate`) or null readings are gray.

### Charts (`src/components/dashboard/ChartsRow.jsx`)

Tabbed card with two views: **PMD Data Trend** (default) and **Lakes Trend**. The wrapping `<div>` has a fixed responsive `min-h` so the card doesn't reflow when the tab changes.

The PMD tab shows a per-station, per-parameter line chart fetched from `GET /api/parameters/:el/stations/:id/trend?bucket=hour|day&days=N`. Three modes:

- **Daily** — `bucket=hour`, last 24 hours.
- **Weekly** — `bucket=day`, last 7 days.
- **Custom** — `bucket=day`, last N days (1–365). When active, a `Past [ N ] days` number input appears to the right of the segmented toggle, height-matched to the toggle.

The line and fill use Chart.js scriptable colors that build a vertical CanvasGradient from `parameterLegends.PARAMETER_GRADIENTS` mapped onto the chart's live `scales.y` and `chartArea`. So the line literally crosses through the legend bin colors as values change (e.g. a temperature swing from `-2 °C → 22 °C` visibly transitions blue → light blue → yellow → orange).

### Theming

- Tailwind `darkMode: 'class'`. `ThemeContext` toggles `dark` on `document.documentElement`, persists to `localStorage` under `theme`, and seeds from `prefers-color-scheme`.
- Two surface palettes: `day.{bg,surface,border,text,muted}` and `night.{...}`. Almost every component uses both: `bg-day-bg dark:bg-night-bg`, `text-day-text dark:text-night-text`, etc.
- The titlebar is intentionally constant in **both** themes (deep emerald) — it's the brand bar. Do not add a `dark:` override on it that changes its identity.
- The accent color used across both themes for active buttons / focus rings / tab underlines / toggle pills is **`#16a085`** (hover `#138b72`, active `#0f7560`). This is unified day+night for consistency. The titlebar theme toggle uses a `text-yellow-300` filled `Sun` icon and a `text-white` filled `Moon` icon.

### Universal component classes ([src/styles/index.css](src/styles/index.css))

The project's design system. **Do not write per-component button/input styles** — extend the class set in `index.css` instead.

- Buttons: `.btn-base`, sizes `.btn-sm/md/lg`, variants `.btn-primary` (now `bg-[#16a085]`), `.btn-secondary`, `.btn-light`, `.btn-dark`, `.btn-ghost`, `.btn-danger`, `.btn-icon`. `Button.jsx` wraps these with a `variant` prop.
- Inputs: `.input-base`, `.input-search` (with leading-icon padding).
- Select: `.select-base`.
- Surfaces: `.card-base`, `.panel-base`, `.panel-header`.
- Misc: `.label-base`, `.chip`.
- Layout: `.titlebar`, `.titlebar-content-offset` — the contract that keeps content from overlapping the fixed titlebar.

### Brand color

`brand-900 = #002060` was the original brand navy and is preserved in the palette for legacy uses. The active titlebar palette is the deep-emerald `bg-emerald-950` / `bg-emerald-900` pair (see `.titlebar` in `src/styles/index.css`). For active-state UI accents (buttons, focus rings, active tabs, toggle pills), use the literal `#16a085` family directly via arbitrary Tailwind values — not `brand-700`. `brand-700 dark:text-brand-200` is only used for decorative panel-header icons.

### Assets

All assets live under [src/assets/](src/assets/), renamed to lowercase + underscores. The barrel at [src/assets/index.js](src/assets/index.js) exports common assets as Vite-resolved URLs (`logos`, `icons`, `misc`, `alerts`, `maps`, `videos`) plus a `paths` object for non-Vite contexts. `AlertsPanel` uses `import.meta.glob('../../assets/images/alerts/*', { eager: true, query: '?url' })` so it auto-discovers files dropped into the folder. `VideoPanels` uses `new URL('../../assets/videos/<file>.mp4', import.meta.url).href`. Both patterns survive `vite build`.

The legacy → new path map is in [ASSET_MANIFEST.md](ASSET_MANIFEST.md) at root. Larger binaries (videos, hi-res images, .xlsx) are tracked via Git LFS — `git lfs install` is required before cloning.

### Environment

- Frontend config goes through `import.meta.env.VITE_*` and is centralized in [src/config/env.js](src/config/env.js). The Mapbox token previously hard-coded in `legacy/template/map_init.js` is now `VITE_MAPBOX_TOKEN`. Two GeoServer base URLs are split (federal `172.18.1.85:8080`, provincial `172.18.1.4:8080`) — most layers will silently return empty data off the LAN.
- Backend config is read via `dotenv/config` in `server/index.js`: `PORT`, `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`, `STORE_INTERVAL_MIN` (default 10).

### Path alias

`@/*` resolves to `src/*` (Vite + jsconfig). Use it for imports — `import { useTheme } from '@/hooks/useTheme'`.

### Backend

- `ensureSchema()` runs `server/sql/schema.sql` against the configured Postgres connection on boot. Failure is fatal (exit code 1). Schema is two tables: `stations` (PK `station_id`) + `station_readings` (FK to `stations`, `UNIQUE (station_id, element, last_update)` for natural dedup). Three indexes support the read paths.
- Cron is a plain `setInterval` started 2 s after `app.listen`, invoking `runStoreCycle('scheduled')` every `STORE_INTERVAL_MIN` minutes. Initial cycle fires once at boot via `runStoreCycle('initial')`.
- `storeElement(element)` (in `server/lib/store.js`) is shared between the route and the cron. It transactionally upserts stations and inserts readings. **Always uses the canonical element name** for the row's `element` column, not `s.element` from the upstream — the PMD response sometimes labels per-station readings inconsistently (e.g. requesting "Compact GAS State (WPs)" returns stations tagged "Battery Voltage").
- The PMD upstream uses a self-signed / private-CA certificate. `server/lib/pmd.js` uses an `undici` Agent with `rejectUnauthorized: false` **scoped to PMD requests only** — not a global TLS bypass. Don't extend that scope without explicit reason.
- Endpoints under `/api/parameters`:
  - `GET /` — list elements.
  - `GET /status` — per-element `{ lastFetchedAt, stationCount }`.
  - `GET /:element/latest` — DB-backed FeatureCollection (latest row per station via `DISTINCT ON`).
  - `GET /:element/geojson` — live FeatureCollection (proxy to PMD upstream).
  - `GET /:element/stations/:stationId/trend?bucket=hour|day&days=N` — aggregated time-series.
  - `POST /:element/store` — manual fetch + persist for one element.
  - `POST /refresh-all` — manual cron-equivalent for all five.

## Conventions when editing

- Universal classes first. New buttons should use `<Button variant="...">`. New inputs should use `<Input>`/`<Select>`/`<SearchBox>`. If a needed variant doesn't exist, add it to `index.css` and the `VARIANTS` map in the wrapper component — don't bypass with raw Tailwind.
- Day + night together. Every color utility should have its `dark:` counterpart unless the element is explicitly brand-bound (e.g. the titlebar) or uses the unified `#16a085` accent.
- Use `#16a085` directly via `bg-[#16a085]` / `text-[#16a085]` / `ring-[#16a085]` for active-state UI — both day and night. Don't reintroduce `bg-brand-700 dark:bg-[#16a085]` pairings.
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
- The PMD upstream `lastUpdate` for a station may not advance every 10 min (some sensors only report hourly). The unique constraint dedupes those quietly — `+0 new / N dedup` in the cron log is normal, not a bug.
