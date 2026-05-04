# App launch guide

This document walks through everything required to run National GLOF Watch locally, build it for production, deploy the static bundle, and resolve common issues. For an at-a-glance summary, see the [README](../README.md).

## Prerequisites

| Tool | Minimum | Notes |
| --- | --- | --- |
| Node.js | 18 LTS | 20 LTS is recommended. Vite 5 and Mapbox GL 3.9 require a modern Node release. |
| npm | 9+ | pnpm 8+ or yarn 1.22+ work as drop-in equivalents. |
| Git | Any recent version | Required to clone the repository. |
| Modern browser | Chrome, Edge, Firefox, or Safari (latest two versions) | The dev server prints the URL on start. |

For full layer functionality you also need network access to the NDMA GeoServer LAN, specifically `http://172.18.1.85:8080` and `http://172.18.1.4:8080`. Off the LAN, WFS requests against those hosts will time out or return empty responses; the affected layers will simply appear empty in the UI. This is a configuration concern, not a bug.

<!-- TODO: confirm whether a public mirror or VPN is available for off-site contributors. -->

## Initial setup

```powershell
git clone <repo-url> national_glof_watch
cd national_glof_watch
copy .env.example .env   # on macOS / Linux: cp .env.example .env
```

Open `.env` in your editor and fill in the values described in the [Environment variables](#environment-variables) section.

## Local development

Install dependencies and start the Vite dev server:

```powershell
npm install
npm run dev
```

Vite will print a local URL, by default `http://localhost:5174/`. Hot module replacement is enabled, so most edits propagate without a full reload.

### npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot reload on `http://localhost:5174`. |
| `npm run build` | Produce a production bundle in `dist/`. |
| `npm run preview` | Serve the contents of `dist/` locally to sanity-check a production build. |
| `npm run lint` | Run ESLint over the project (configured in `eslint.config.js`). |

## Production build and deploy

Generate the production bundle:

```powershell
npm run build
```

The output is written to `dist/` and contains an `index.html`, hashed JS/CSS bundles, and copied static assets. Because the dashboard is a single-page application with client-side state only, it can be served by any static host. No Node.js process is required at runtime.

### Deployment targets

- Nginx, Apache, or IIS on a server you control
- Netlify, Vercel, Cloudflare Pages, GitHub Pages
- AWS S3 fronted by CloudFront (or any equivalent object-storage + CDN combination)

### Sample Nginx server block

```nginx
server {
    listen 80;
    server_name glof-watch.example.gov.pk;

    root /var/www/national_glof_watch/dist;
    index index.html;

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

<!-- TODO: document the production hostname and TLS termination once NDMA confirms the deployment target. -->

## Environment variables

All variables are read at build time by Vite and inlined into the bundle. A change to `.env` requires restarting `npm run dev` or rebuilding.

| Variable | Required | Description and notes |
| --- | --- | --- |
| `VITE_MAPBOX_TOKEN` | Yes | A public Mapbox access token (`pk.*`). Create one in the Mapbox account dashboard at `https://account.mapbox.com/access-tokens/`. Restrict the token to the production hostname before deploying. If this is missing or invalid the map renders as a blank grey canvas. |
| `VITE_GEOSERVER_BASE_URL` | Yes | Base URL of the federal NDMA GeoServer (typically `http://172.18.1.85:8080/geoserver`). Hosts the glacial lakes inventory, AKAH infrastructure, populated places, GMRC/WAPDA stations, and GLOF II early-warning stations. Obtain from the NDMA infrastructure team. If wrong, those layers fail silently and the active-layers legend will list them as empty. |
| `VITE_GEOSERVER_PROVINCIAL_URL` | Yes | Base URL of the provincial GeoServer (typically `http://172.18.1.4:8080/geoserver`). Hosts a separate set of boundary layers. Same sourcing as above. |
| `VITE_DEFAULT_MAP_CENTER_LNG` | No | Initial longitude for the map view. Use a value over northern Pakistan (roughly 72-75 degrees east). Omit to fall back to the in-code default. |
| `VITE_DEFAULT_MAP_CENTER_LAT` | No | Initial latitude (roughly 35-37 degrees north for the GLOF region). |
| `VITE_DEFAULT_MAP_ZOOM` | No | Initial zoom level. The legacy app opens around zoom 6-7 to show the full Hindu Kush / Karakoram / Himalaya extent. |
| `VITE_DEFAULT_MAP_PITCH` | No | Initial camera pitch in degrees. `0` is top-down; `60` is the maximum tilt. |

<!-- TODO: confirm the canonical default centre / zoom / pitch values with the design team and pin them here. -->

## Day / night theme

The theme is controlled by a toggle button in the navy titlebar and is implemented via Tailwind's `dark` class strategy.

- The current theme is persisted in `localStorage` under the key `theme`, with values `light` or `dark`.
- On first load (no value stored), the app reads `window.matchMedia('(prefers-color-scheme: dark)')` and adopts the system preference.
- The navy titlebar (`#002060`) is intentionally constant in both themes - it is part of the NDMA brand and is excluded from the dark-mode palette.

To force a specific theme during development, run the following in the browser devtools console and reload:

```js
localStorage.setItem('theme', 'dark');   // or 'light'
```

## Asset organisation

New assets live under `src/assets/`:

- `src/assets/images/` - JPEG / PNG / SVG (alerts gallery, lake static maps, partner logos)
- `src/assets/videos/` - MP4 / GIF field footage used in side panels and lake popups
- `src/assets/data/` - CSV, XLSX, and GeoJSON consumed at runtime

Naming convention: lowercase with underscores, no spaces (e.g. `badswat_lake_2024.geojson`, not `Badswat Lake 2024.geojson`). This avoids URL-encoding pitfalls and matches the pattern emerging in the React port.

For the legacy-to-new path mapping, see `ASSET_MANIFEST.md` in the project root.

<!-- TODO: link the ASSET_MANIFEST.md once the asset-reorganisation agent finishes writing it. -->

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Map area is a blank grey rectangle | `VITE_MAPBOX_TOKEN` is missing, malformed, or restricted to a different domain | Verify the token in `.env`, restart the dev server, and check the browser console for a 401/403 from `api.mapbox.com`. |
| A whole region's layers stay empty after toggling on | GeoServer is unreachable from this network | Test connectivity, for example `curl -I http://172.18.1.85:8080/geoserver/web/`. Off the NDMA LAN this is expected. |
| `npm run build` fails with a `mapbox-gl` or native-module error | Node.js version is too old | Upgrade to Node 18 LTS or newer; delete `node_modules` and `package-lock.json`, then reinstall. |
| Theme is stuck in dark (or light) regardless of the toggle | Stale `localStorage` entry | Run `localStorage.removeItem('theme')` in devtools and reload. |
| Charts render as empty boxes | Chart.js failed to load, or the data file is missing | Open devtools, confirm there is no 404 for the underlying CSV/XLSX, and confirm `chart.js` is present in the network tab. |
| Layer toggle has no effect | The layer id passed to the toggle does not match what was registered on `style.load` | Check the browser console for a Mapbox warning about an unknown layer id. |
| Fonts look wrong on first paint | Inter font is still loading | Expected on the first visit; subsequent loads are cached. |

## Browser support

Targeting modern evergreen browsers only:

- Google Chrome - latest two versions
- Microsoft Edge - latest two versions
- Mozilla Firefox - latest two versions
- Apple Safari - latest two versions

Internet Explorer 11 is not supported and will not be tested against. Older Chromium-derived in-app browsers (for example, embedded WebViews on legacy Android) may render but are not part of the support matrix.

## Migration notes

The legacy static HTML/JS dashboard is preserved in `legacy/` so that behaviour, copy, and visual detail can be cross-checked while the React port is being completed. The original top-level data folders - `data/`, `Alerts/`, and `Maps/` - remain in place alongside the new `src/assets/` tree until parity has been verified end-to-end. Once the React app is confirmed to cover every layer, chart, video, and alert from the legacy implementation, those folders can be removed and `legacy/` can be archived.

When in doubt about expected behaviour, the legacy app is the source of truth.
