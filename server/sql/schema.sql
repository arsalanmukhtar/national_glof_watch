-- PMD Datascape station data schema.
-- `stations` holds stable identity/location; `station_readings` the
-- time-series of measured values (one row per station/element/last_update
-- tuple — the unique constraint dedupes refetches). `station_elements` is
-- the network-wide element catalog and `element_thresholds` the decoded
-- alert bands, both populated from the Datascape v3 API.
--
-- Run automatically by server/lib/db.js on backend boot. Safe to re-run.

CREATE TABLE IF NOT EXISTS stations (
  station_id   BIGINT PRIMARY KEY,
  station_name TEXT NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lon          DOUBLE PRECISION NOT NULL,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS station_readings (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
  element     TEXT NOT NULL,
  value       DOUBLE PRECISION,
  unit        TEXT,
  last_update TIMESTAMP,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_station_reading UNIQUE (station_id, element, last_update)
);

-- Datascape v3 migration: each reading now also carries the upstream
-- elementId (the per-station-per-element instance id) and stateId (the
-- alert classification PMD computed against the station's thresholds).
-- Additive — legacy EWS rows keep element_id/state_id NULL and still
-- serve the trend chart, which is keyed on (element name, station_id).
ALTER TABLE station_readings ADD COLUMN IF NOT EXISTS element_id BIGINT;
ALTER TABLE station_readings ADD COLUMN IF NOT EXISTS state_id   INTEGER;

CREATE INDEX IF NOT EXISTS idx_station_readings_element
  ON station_readings(element);

CREATE INDEX IF NOT EXISTS idx_station_readings_fetched
  ON station_readings(fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_station_readings_station_element
  ON station_readings(station_id, element, last_update DESC);

CREATE INDEX IF NOT EXISTS idx_station_readings_element_id
  ON station_readings(element_id, last_update DESC);

-- Network-wide element catalog discovered from the Datascape v3 API.
-- One row per (station, element) instance — `element_id` is globally
-- unique (a station's "Air Temperature" has a different element_id than
-- another station's). The frontend element selector is built from the
-- DISTINCT `element_name` set; `element_id` builds the threshold URL.
CREATE TABLE IF NOT EXISTS station_elements (
  element_id   BIGINT PRIMARY KEY,
  station_id   BIGINT NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
  element_name TEXT NOT NULL,
  meas_unit    TEXT,
  decimals     INTEGER,
  category     INTEGER,
  is_queryable BOOLEAN,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_station_elements_name
  ON station_elements(element_name);

CREATE INDEX IF NOT EXISTS idx_station_elements_station
  ON station_elements(station_id);

-- Decoded alert thresholds per element instance (the `entryCfgs` from
-- the Datascape v3 detail endpoint, parsed into labelled bands). Stored
-- as a JSONB `alarms` blob — the shape produced by parseEntryCfgs() in
-- server/lib/datascape.js. Refreshed monthly (config changes rarely);
-- powers the Feature Details threshold table. No FK on element_id for
-- the same decoupling reason as station_photos.
CREATE TABLE IF NOT EXISTS element_thresholds (
  element_id   BIGINT PRIMARY KEY,
  station_id   BIGINT,
  element_name TEXT,
  decimals     INTEGER,
  alarms       JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_element_thresholds_station
  ON element_thresholds(station_id);

-- Photo catalog for PMD stations. Seeded once from
-- `data/csv/station_photos.json` via `scripts/db/seed-station-photos.js`
-- and surfaced by the Feature Details "Image Catalog" tile when a
-- station feature is clicked. Decoupled from `stations` (no FK) because
-- the JSON ships rosters for some IDs that the PMD cron may not yet
-- have inserted, and we don't want partial-station inventory to block
-- photo retrieval.
CREATE TABLE IF NOT EXISTS station_photos (
  id         BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL,
  filename   TEXT NOT NULL,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_station_photo UNIQUE (station_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_station_photos_station
  ON station_photos(station_id, position);
