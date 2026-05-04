# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NDMA Pakistan "National GLOF Watch" — a Glacial Lake Outburst Flood monitoring dashboard. The active codebase is a React 18 + Vite 5 + Tailwind CSS 3 single-page app at the project root. The original HTML/JS implementation is preserved under [legacy/](legacy/) for reference; the React app is the deliverable.

The user explicitly intends to wire actual map layers, chart datasets, and station data later — current state is the visual + structural scaffold with placeholder panels referencing the real (renamed) assets.

## Common commands

```powershell
npm install            # first run only
npm run dev            # Vite dev server at http://localhost:5174 (long-running)
npm run build          # static production build to dist/
npm run preview        # serve dist/ locally
npm run lint           # eslint flat config
```

There is no test runner configured.

## Repo layout

```
national_glof_watch/
├── index.html                  # Vite entry — Inter font preconnect, NDMA favicon, mounts /src/main.jsx
├── package.json                # type: module
├── vite.config.js              # @ alias → /src
├── tailwind.config.js          # darkMode: 'class', brand/day/night/accent palettes, Inter font, custom keyframes
├── postcss.config.js
├── eslint.config.js            # flat config
├── jsconfig.json               # @/* alias for editor IntelliSense
├── .env / .env.example         # VITE_MAPBOX_TOKEN, VITE_GEOSERVER_*, VITE_DEFAULT_MAP_*
├── README.md                   # public-facing project overview
├── ASSET_MANIFEST.md           # legacy → src/assets path map (every renamed file)
├── docs/
│   └── APP_LAUNCH.md           # detailed deploy / troubleshooting guide
├── src/
│   ├── main.jsx                # ReactDOM.createRoot + App
│   ├── App.jsx                 # ThemeProvider → AppShell → Dashboard
│   ├── styles/index.css        # Tailwind directives + universal component classes
│   ├── config/                 # env.js, mapbox.js, theme.js
│   ├── contexts/ThemeContext.jsx
│   ├── hooks/                  # useTheme, useMediaQuery, useFullscreen
│   ├── utils/                  # cn (clsx wrapper), formatters
│   ├── components/
│   │   ├── layout/             # TitleBar, AppShell, Sidebar, MobileMenu
│   │   ├── ui/                 # Button, Input, Select, SearchBox, Toggle, Card, Panel, Modal, Accordion, Badge, Spinner, Tooltip
│   │   └── dashboard/          # Dashboard, MapPanel, LayerMenu, ChartsRow, VideoPanels, AlertsPanel, QuickToggles
│   └── assets/
│       ├── index.js            # barrel: { logos, icons, misc, alerts, maps, videos, paths }
│       ├── images/{logos,icons,alerts,maps,misc}/
│       ├── videos/
│       └── data/{csv,excel,geojson}/
├── legacy/                     # original HTML/JS app (index.html + template/) — reference only
├── data/, Alerts/, Maps/       # original asset folders, kept until migration is verified
└── dist/                       # vite build output (gitignored)
```

## Architecture

### Composition

`App` mounts `ThemeProvider` → `AppShell` → `Dashboard`. `AppShell` renders the fixed `TitleBar` and a `<main>` with class `titlebar-content-offset` (= `pt-16`) so content never overlaps the titlebar. `Dashboard` lays out `Sidebar` (collapsible, holds `LayerMenu`) + a stacked column of `QuickToggles`, `MapPanel`, `ChartsRow`, `VideoPanels`, `AlertsPanel`. The mobile breakpoint replaces the sidebar with `MobileMenu` (off-canvas drawer) opened from the titlebar hamburger.

### Theming

- Tailwind `darkMode: 'class'`. `ThemeContext` toggles the `dark` class on `document.documentElement`, persists to `localStorage`, and seeds from `prefers-color-scheme`.
- Two surface palettes: `day.{bg,surface,border,text,muted}` and `night.{...}`. Almost every component uses both: `bg-day-bg dark:bg-night-bg`, `text-day-text dark:text-night-text`, etc.
- The titlebar is intentionally `bg-brand-900` (`#002060`) in **both** themes — it's the NDMA brand bar; do not add a `dark:` override on it.

### Universal component classes ([src/styles/index.css](src/styles/index.css))

These are the project's design system. **Do not write per-component button/input styles** — extend the class set in `index.css` instead.

- Buttons: `.btn-base`, sizes `.btn-sm/md/lg`, variants `.btn-primary`, `.btn-secondary`, `.btn-light`, `.btn-dark`, `.btn-ghost`, `.btn-danger`, `.btn-icon`. `Button.jsx` wraps these with a `variant` prop.
- Inputs: `.input-base`, `.input-search` (with leading-icon padding).
- Select: `.select-base`.
- Surfaces: `.card-base`, `.panel-base`, `.panel-header`.
- Misc: `.label-base`, `.chip`.
- Layout: `.titlebar`, `.titlebar-content-offset` — the contract that keeps content from overlapping the fixed titlebar.

### Brand color

`brand-900 = #002060` is the canonical NDMA navy. The full `brand` ramp (50→950) is in [tailwind.config.js](tailwind.config.js); use `brand-700/800` for primary buttons, `brand-100` for soft fills.

### Assets

All assets live under [src/assets/](src/assets/), renamed to lowercase + underscores. The barrel at [src/assets/index.js](src/assets/index.js) exports common assets as Vite-resolved URLs (`logos`, `icons`, `misc`, `alerts`, `maps`, `videos`) plus a `paths` object for non-Vite contexts. `AlertsPanel` uses `import.meta.glob('../../assets/images/alerts/*', { eager: true, query: '?url' })` so it auto-discovers files dropped into the folder. `VideoPanels` uses `new URL('../../assets/videos/<file>.mp4', import.meta.url).href` — both patterns survive `vite build`.

The legacy → new path map is in [ASSET_MANIFEST.md](ASSET_MANIFEST.md) at root.

### Environment

All runtime config goes through `import.meta.env.VITE_*` and is centralized in [src/config/env.js](src/config/env.js). The Mapbox token previously hard-coded in `template/map_init.js` is now `VITE_MAPBOX_TOKEN`. Two GeoServer base URLs are split (federal `172.18.1.85:8080`, provincial `172.18.1.4:8080`) — most layers will silently return empty data off the LAN.

### Path alias

`@/*` resolves to `src/*` (Vite + jsconfig). Use it for imports — `import { useTheme } from '@/hooks/useTheme'`.

## Conventions when editing

- Universal classes first. New buttons should use `<Button variant="...">`. New inputs should use `<Input>`/`<Select>`/`<SearchBox>`. If a needed variant doesn't exist, add it to `index.css` and the `VARIANTS` map in the wrapper component — don't bypass with raw Tailwind.
- Day + night together. Every color utility should have its `dark:` counterpart unless the element is explicitly brand-bound (e.g. the titlebar).
- Animations via Framer Motion (already a dep). Standard pattern: `initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}`. Use `whileHover`/`whileTap` for micro-interactions on interactive elements.
- Mapbox initialization belongs in `MapPanel` (currently a placeholder div + `mapContainerRef`). When wiring it up, reference `src/config/mapbox.js` for token/style/default view — do not re-read `import.meta.env` from inside components.
- Layer/source definitions: when the user provides data, port the legacy pattern from [legacy/template/map_layers.js](legacy/template/map_layers.js) into a `src/config/mapLayers.js` that exports source/layer arrays consumed by `MapPanel` inside a `map.on('style.load', ...)` effect. Don't replicate the legacy "everything in one giant style.load handler" — split per-region.
- Don't reintroduce inline `onclick=` handlers, global mutable variables, or jQuery/Bootstrap-style imperative DOM mutation. The legacy code did this heavily; the React port should not.
- Don't fall back to `legacy/` at runtime. It exists for reference only — copy patterns out of it, don't import from it.

## Things to be aware of

- The build emits one chunk over Vite's 500 kB warning threshold (Mapbox GL + Chart.js dominate). Code-splitting (lazy-loading `MapPanel`/`ChartsRow`) is the natural fix when the app is fleshed out.
- `data/`, `Alerts/`, `Maps/` at the project root still exist as the source of the asset migration. They can be deleted once `src/assets/` is verified, but only after user confirmation — they are the source of truth for the manifest.
- The legacy GeoJSON files in [src/assets/data/geojson/](src/assets/data/geojson/) are still `.js` files declaring globals (e.g. `const badswatGlacierSource = {...}`) — they need to be converted to ESM exports or proper `.json` when the map is wired up.
- `npm install` reports a few audit advisories; not addressed during scaffolding to avoid forced major-version upgrades.
