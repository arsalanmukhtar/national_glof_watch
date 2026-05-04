# National GLOF Watch

Glacial Lake Outburst Flood monitoring dashboard for the National Disaster Management Authority of Pakistan.

## Overview

National GLOF Watch is an interactive web dashboard for monitoring glacial lake outburst flood (GLOF) hazards across northern Pakistan, covering the Hindu Kush, Karakoram, and Himalaya ranges. It surfaces a satellite basemap of the region with toggleable layers for individual glacial lakes (Badswat, Hinarchi, Reshun, Brep, Darkot, Gulmit, Thalu, Pindoru, Hunza/Ultar, and others), risk-zonation polygons (avalanche, debris flow, bank erosion, flood, landslide, rockfall, urban flood), and partner infrastructure overlays from AKAH, GMRC/WAPDA, and the UNDP-supported GLOF II early-warning station network.

The dashboard is intended for NDMA staff, provincial disaster management authorities, partner agencies, and decision-makers who need a single operational view of lake conditions, station readings, and historical incidents. Time-series charts (lake area in m^2 and lake volume in m^3 across 2020-2025) are paired with the spatial layers, alongside an alerts gallery, embedded field videos, and Flourish narrative panels.

This repository hosts the React rewrite of the original static HTML/JS dashboard. The legacy implementation is preserved under `legacy/` for reference while the migration stabilises.

## Tech stack

- React 18 (UI framework)
- Vite 5 (build tool and dev server)
- Tailwind CSS 3 (utility-first styling)
- Mapbox GL JS 3.9 (interactive basemap and vector layers)
- Chart.js 4 via react-chartjs-2 (lake area and volume time-series)
- SheetJS / xlsx (parsing Excel station data)
- Framer Motion (panel and accordion transitions)
- Headless UI (accessible primitives: dialogs, menus, disclosures)
- Lucide icons
- Inter font (UI typography)

## Project structure

```
national_glof_watch/
├── src/
│   ├── assets/         Images, videos, and data files (CSV, Excel, GeoJSON)
│   ├── components/     Layout, ui, and dashboard components
│   ├── contexts/       React contexts (e.g. theme)
│   ├── hooks/          Custom React hooks
│   ├── config/         Static configuration (map defaults, layer registry)
│   ├── styles/         Global CSS and Tailwind component layers
│   ├── utils/          Pure helpers (formatters, parsers)
│   ├── App.jsx         Root application component
│   └── main.jsx        Vite entry point
├── docs/
│   └── APP_LAUNCH.md   Setup, deployment, and troubleshooting guide
├── legacy/             Original HTML/JS dashboard, preserved for reference
├── data/               Legacy data folder (CSV, XLSX, GeoJSON, MP4)
├── Alerts/             Legacy alert image assets
├── Maps/               Legacy static map image assets
├── index.html          Vite HTML entry
├── package.json        Dependencies and npm scripts
├── tailwind.config.js  Tailwind theme, dark mode, content globs
├── vite.config.js      Vite build configuration
├── .env.example        Template for required environment variables
├── README.md           This file
└── CLAUDE.md           Architectural notes for AI-assisted development
```

The `data/`, `Alerts/`, and `Maps/` folders are kept alongside `src/assets/` until the React port has been fully verified against the legacy app; once parity is confirmed they can be removed.

## Quick start

```
1. cp .env.example .env       # then fill in VITE_MAPBOX_TOKEN and the GeoServer URLs
2. npm install
3. npm run dev
4. open http://localhost:5174
```

For a production bundle, run `npm run build`. The output is a fully static `dist/` directory that can be deployed to any web host (Nginx, IIS, Netlify, Vercel, S3 + CloudFront, GitHub Pages, etc.). No Node.js runtime is required to serve it.

## Environment variables

All runtime configuration is read from `import.meta.env` and must be prefixed with `VITE_` to be exposed to the browser bundle. Copy `.env.example` to `.env` and populate the values below.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_MAPBOX_TOKEN` | Yes | Mapbox public access token (`pk.*`). Without this the basemap will not render. |
| `VITE_GEOSERVER_BASE_URL` | Yes | Base URL for the federal GeoServer hosting most WFS layers (glacial lakes inventory, AKAH infrastructure, populated places, GMRC/WAPDA, GLOF II stations). |
| `VITE_GEOSERVER_PROVINCIAL_URL` | Yes | Base URL for the provincial GeoServer that hosts a separate set of boundary layers. |
| `VITE_DEFAULT_MAP_CENTER_LNG` | No | Initial map center longitude. Defaults to a northern-Pakistan view if omitted. |
| `VITE_DEFAULT_MAP_CENTER_LAT` | No | Initial map center latitude. |
| `VITE_DEFAULT_MAP_ZOOM` | No | Initial map zoom level. |
| `VITE_DEFAULT_MAP_PITCH` | No | Initial map pitch in degrees (0 = top-down). |

See [docs/APP_LAUNCH.md](docs/APP_LAUNCH.md) for guidance on sourcing each value.

## Theming

The dashboard supports a day and a night theme, implemented via Tailwind's `dark` class on the `<html>` element. The toggle lives in the titlebar; the user's choice is persisted in `localStorage` under the `theme` key, and the system colour-scheme preference is consulted on first load. The navy titlebar (`#002060`) is intentionally constant in both themes because it is part of the NDMA brand identity.

## Universal component classes

To keep the UI visually consistent, prefer the shared utility classes defined in the global stylesheet over per-component ad-hoc styling.

- Buttons: `.btn-primary`, `.btn-secondary`, `.btn-light`, `.btn-dark`, `.btn-ghost`, `.btn-danger`, `.btn-icon`
- Inputs: `.input-base`, `.input-search`
- Selects: `.select-base`
- Surfaces: `.card-base`, `.panel-base`

When building a new component, reach for these first; only add bespoke Tailwind classes when none of the above fit the use case.

## Status

This project is an active migration from the legacy static HTML/JS dashboard to React + Vite + Tailwind. The Vite scaffold, Tailwind theme, day/night toggle, base layout, and asset reorganisation are in place. Map layer wiring, the per-region accordion, and the Chart.js data bindings will be ported in subsequent passes once the upstream data sources (GeoServer endpoints, station spreadsheets, per-region GeoJSON) have been confirmed in the new structure.

The original implementation under `legacy/` is the authoritative reference for behaviour and visual detail until the React port reaches feature parity.

## Documentation

- [docs/APP_LAUNCH.md](docs/APP_LAUNCH.md) — prerequisites, environment setup, local development, production build and deployment, troubleshooting.
- [CLAUDE.md](CLAUDE.md) — architectural notes and conventions, primarily aimed at AI-assisted development sessions but useful to any new contributor.
