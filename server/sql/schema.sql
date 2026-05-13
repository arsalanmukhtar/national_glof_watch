-- PMD EWS station data schema.
-- Two-table design: `stations` for stable identity/location, `station_readings`
-- for the time-series of measured values. One row in `station_readings` per
-- (station, element, last_update) tuple — the unique constraint dedupes when
-- the same reading is fetched twice.
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

CREATE INDEX IF NOT EXISTS idx_station_readings_element
  ON station_readings(element);

CREATE INDEX IF NOT EXISTS idx_station_readings_fetched
  ON station_readings(fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_station_readings_station_element
  ON station_readings(station_id, element, last_update DESC);

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
