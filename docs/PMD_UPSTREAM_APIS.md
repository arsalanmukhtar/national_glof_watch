# PMD Upstream APIs

Complete inventory of every PMD (Pakistan Meteorological Department) endpoint the National GLOF Watch backend fetches from, what each returns, and which cron / on-demand path pulls it. The frontend **never** talks to PMD directly — the Node backend authenticates, decodes, caches, and re-exposes everything under our own `/api/*` routes.

There are two distinct upstream systems:

- **Datascape v3** — the modern token-authenticated telemetry API (element catalog, live readings, alert thresholds). Primary data source.
- **Legacy EWS** — the older HTTPS/private-CA endpoint. Kept alive only for a handful of things Datascape does not expose (network health badge, four GIS reference layers, station photo binaries).

---

## 1. Datascape v3 API

Base URL: `http://115.186.56.181/datascapea` (override with `DATASCAPE_BASE`)
Transport: plain HTTP, Bearer-token auth
Client: [`server/lib/datascape.js`](../server/lib/datascape.js)

### 1.1 `POST /connect/token`

**Purpose:** obtain an OAuth password-grant access token.

**Sends** (form-urlencoded):

```
username=DatascapeUser
password=hQKPv8N27RxWQu3t4DE0
grant_type=password
client_id=GenericClient
client_instance=12345
```

**Returns:** `{ access_token, expires_in, … }`. The token is cached in-process (`tokenCache`) and reused across the whole fetch cycle. Proactively refreshed 60 s before `expires_in`; any 401 from a downstream call triggers a reactive refresh + one retry.

**Where called:** implicitly by `authedGet()` on every other Datascape call.

---

### 1.2 `GET /v1/elements?category=All&field=StationId&field=StationName&ui_culture=en-US`

**Purpose:** network-wide station roster — the entry point for the value cron.

**Returns:** flat list of element records for the whole network. We only care about `StationId` + `StationName`; the response is deduped to unique `(stationId, stationName)` pairs and sorted by ID.

**Where called:** [`fetchStationList()`](../server/lib/datascape.js) — invoked at the top of every value-cron cycle to know which stations to poll.

---

### 1.3 `GET /v3/elements?station_id={id}&field=…&category=1&ui_culture=en`

**Purpose:** one station's currently-reporting elements.

**Fields requested:** `ElementName`, `Time`, `Value`, `Decimals`, `MeasUnit`, `Trend`, `StateId`, `IsQueryable`.

**Returns:** array of `{ elementName, elementId, decimals, measUnit, time, value, trend, stateId, stateDescr, isQueryable, … }`. `stateId` is PMD's own 0-100 alert severity score (0 = Normal, 20 = Error, 40+ = Warning, 70+ = Pre-alarm, 90+ = Alarm).

**Where called:** [`fetchStationElements(stationId)`](../server/lib/datascape.js) — looped over every station in `storeAllStations()` on the 10-minute value cron. Each response is upserted into:
- `station_elements` (the element catalog, `element_id` unique per station-per-element)
- `station_readings` (the timeseries — `value`, `state_id`, `last_update`, `element_id`, deduped by `UNIQUE (station_id, element, last_update)`)

**Caveat:** the v3 list **omits** elements that aren't currently reporting, so a station's element set fluctuates per fetch. `station_elements` (rebuilt monthly) is the stable catalog; `/latest` is catalog-driven so a silent station shows as gray "Inactive" instead of vanishing.

---

### 1.4 `GET /v3/elements/{elementId}?ui_culture=en`

**Purpose:** one element instance's full detail, including the alarm-band definitions.

**Returns:** an object carrying `entryCfgs` — the raw threshold definitions (`thresholdOperator`, `value`, `maxValue`, `alertStateId`, `alarmName`, `alarmId`, `stateDescr`, `thresholdType`, `trendPeriod`, …) — plus the station's `latitude` / `longitude` (used to refresh `stations.lat/lon`).

**Where called:** [`fetchElementDetail(elementId)`](../server/lib/datascape.js) — walked over every element in the network by [`refreshAllThresholds()`](../server/lib/thresholds.js) on the ~30-day threshold cron. `entryCfgs` is decoded by `parseEntryCfgs()` into labelled bands and upserted into `element_thresholds.alarms` (JSONB). Also runnable via `npm run db:seed-elements` and `POST /api/parameters/thresholds/refresh`.

**Operator decoding table** (from `OPERATOR_SYMBOL` in the client):
| `thresholdOperator` | Symbol | Meaning |
|---|---|---|
| 1 | `<` | value strictly less than |
| 2 | `≤` | value less than or equal |
| 5 | `≥` | value greater than or equal |
| 6 | `>` | value strictly greater than |
| 7 | `range` | value falls in `[min, max)` |

---

## 2. Legacy EWS API

Base host: `https://115.186.56.181/ews/`
Transport: HTTPS, but the cert is self-signed / private CA — every call uses an `undici` `Agent` with `rejectUnauthorized: false`, scoped to just these requests. No global TLS relaxation.

### 2.1 `GET /ews/classes/station_status.php`

**Purpose:** lightweight network health snapshot for the titlebar badge.

**Returns:** `{ totalStations, totalActive, currentActive, windowMinutes }`.

**Where called:** [`fetchStationStatus()`](../server/lib/pmd.js).

**Caveat:** upstream has been observed to take **20–100+ seconds** to respond. Serving the badge directly would break it (the browser times out and the badge disappears). Instead a **warm cache** is refreshed on a 5-minute server-side cron ([`refreshStationStatusCache()`](../server/lib/pmd.js), kicked from [`server/index.js`](../server/index.js)); the badge is served from the cache in <10 ms. On a transient upstream failure the last-good response is preserved.

---

### 2.2 GLOF reference layers — four GeoJSON files

Served via [`server/routes/gis.js`](../server/routes/gis.js), cached in-process for 1 hour, with a stale-cache fallback when PMD is unreachable. Long browser `Cache-Control` (1 h) so the second toggle of any layer is instant.

| Our key | Upstream URL | What it is |
|---|---|---|
| `glof_districts` | `https://115.186.56.181/ews/gis/Glof_districts.json` | Administrative district polygons in the GLOF area of interest. |
| `glof_basins`    | `https://115.186.56.181/ews/gis/Combine_Basin.json`   | GLOF drainage basin polygons. Also used at first map load to auto-fit the view to the basin envelope. |
| `glof_lakes`     | `https://115.186.56.181/ews/gis/na_lakes.json`        | Northern-Areas glacial lakes inventory (polygons). Coordinates are snapped to 5 decimals (~1 m) before caching/serving — the raw payload carries 12+ decimals of overkill precision that bloats the response by ~3×. |
| `glof_valley`    | `https://115.186.56.181/ews/gis/Comb_Valley.json`     | Combined valley polygons. |

Client access: `/api/gis/:layer` → returns cached FeatureCollection.

---

### 2.3 Station photo binaries

**Purpose:** per-station reference photos surfaced in the Feature Details "Image Catalog" tile.

**Storage:** the upstream URLs (originally sourced from Datascape) are seeded once into the `station_photos` table with columns `(station_id, filename, url, position)`. Runtime **never** takes a client-supplied URL — the filename is looked up in the table, so there's no SSRF surface.

**Proxy path:** `GET /api/parameters/station-photo?stationId=X&filename=Y` streams the upstream binary through the backend. This is required because the frontend is served over HTTPS but the PMD photo host is HTTP-only — mixed-content rules block a direct fetch. Response is streamed with `Cache-Control: public, max-age=86400, immutable`.

**Catalog endpoint:** `GET /api/parameters/stations/:stationId/photos` returns the filename list with each `url` rewritten to the proxy above.

---

## 3. Cron cadence & retry semantics

| Cron | File | Interval | What it does |
|---|---|---|---|
| **Value cron** | [`server/lib/store.js`](../server/lib/store.js) | `STORE_INTERVAL_MIN` (default **10 min**) | Loops the full station roster, calls `/v3/elements?station_id=` for each, upserts `station_elements` + inserts new `station_readings`. Guarded against re-entry — a slow cycle won't stack. |
| **Threshold cron** | [`server/lib/thresholds.js`](../server/lib/thresholds.js) | `THRESHOLD_INTERVAL_DAYS` (default **30 days**) | Walks every element in the network via `/v3/elements/{id}`, decodes `entryCfgs`, upserts `element_thresholds.alarms`, refreshes `stations.lat/lon`. Runs at boot only if `element_thresholds` is empty. |
| **Station-status warm-cache** | [`server/lib/pmd.js`](../server/lib/pmd.js) | Every **5 min** (kicked from `server/index.js`) | Hits the slow EWS `station_status.php` in the background and refreshes the in-memory cache. Serves the titlebar badge in <10 ms. |

All three fire 2 s after `app.listen()` so the HTTP server is responsive before the first upstream call.

---

## 4. Re-exposed endpoints (backend → frontend)

The browser sees only these — none of the raw PMD URLs above are ever hit from the client:

| Route | Backing PMD source |
|---|---|
| `GET /api/parameters/elements` | `station_elements` catalog (built from `/v3/elements?station_id=`) |
| `GET /api/parameters/status` | Per-element `lastFetchedAt` + `stationCount` derived from `station_readings` |
| `GET /api/parameters/:element/latest` | Catalog-joined `station_readings` — one feature per station that *has* the element |
| `GET /api/parameters/:element/latest?earlyFactor=0.9` | Same as above, but each feature also carries `ourStateId` / `ourCrossedThreshold` computed against per-station bands tightened by the factor (NDMA early-warning classification) |
| `GET /api/parameters/:element/stations/:id/trend?days=N` | Raw `station_readings` timeseries |
| `GET /api/parameters/element/:elementId/thresholds` | `element_thresholds.alarms` decoded bands |
| `GET /api/parameters/thresholds/status` · `POST /api/parameters/thresholds/refresh` | Threshold cron status + manual trigger |
| `POST /api/parameters/refresh-all` | Kicks one full v3 value cycle immediately |
| `GET /api/parameters/station-status` | Warm cache of EWS `station_status.php` |
| `GET /api/parameters/stations/:id/photos` · `GET /api/parameters/station-photo` | `station_photos` catalog + EWS binary proxy |
| `GET /api/gis/:layer` | `glof_districts` / `glof_basins` / `glof_lakes` / `glof_valley` GeoJSON files |

---

## 5. Configuration

Backend env vars ([`server/index.js`](../server/index.js), read via `dotenv/config`):

```env
DATASCAPE_BASE=http://115.186.56.181/datascapea
DATASCAPE_USER=DatascapeUser
DATASCAPE_PASSWORD=hQKPv8N27RxWQu3t4DE0
DATASCAPE_CLIENT_ID=GenericClient
DATASCAPE_CLIENT_INSTANCE=12345

STORE_INTERVAL_MIN=10          # value cron cadence
THRESHOLD_INTERVAL_DAYS=30     # threshold cron cadence
```

The Datascape credentials also have working defaults hard-coded in [`server/lib/datascape.js`](../server/lib/datascape.js), so the backend runs out of the box without a `.env` — override only if PMD rotates them.

`node --watch` reloads on `server/**` changes but **not** on `.env` changes — restart `npm run server` after editing the env file.
