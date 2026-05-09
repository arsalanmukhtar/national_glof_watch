import {
  Activity,
  ArrowDown,
  Box,
  Cloud,
  CloudUpload,
  Image as ImageIcon,
  Layers,
  LineChart,
  Map,
  MousePointerClick,
  Network,
  PaintBucket,
  Palette,
  Server,
  Settings2,
  Shapes,
  SlidersHorizontal,
  Table2,
  Thermometer,
  Video,
} from 'lucide-react';
import {
  ApiPill,
  Callout,
  DocsSection,
  DocsSubsection,
  FeatureCard,
  Kbd,
  LI,
  OL,
  P,
  Pill,
  StatGrid,
  UL,
} from './parts';

// ---------------------------------------------------------------------------
// Documentation content. Each top-level section has a stable id (the
// TOC links via #id, the IntersectionObserver in DocsLayout uses the
// same id to highlight the active item). Subsections nest under their
// parent and follow the same pattern.
// ---------------------------------------------------------------------------

// Source of truth for the TOC. Adding a section here AND a matching
// <DocsSection id> below is what makes it appear in both the sidebar
// and the page body — no separate registration step.
export const TOC = [
  {
    id: 'overview',
    title: 'Overview',
    children: [],
  },
  {
    id: 'layers',
    title: 'Map Layers',
    children: [
      { id: 'layers-region',    title: 'Region Layers' },
      { id: 'layers-risk',      title: 'Risk Zones' },
      { id: 'layers-secondary', title: 'Secondary Layers' },
      { id: 'layers-stations',  title: 'PMD Stations' },
      { id: 'layers-rasters',   title: 'Raster Overlays' },
    ],
  },
  {
    id: 'components',
    title: 'Components',
    children: [
      { id: 'components-titlebar',    title: 'Title Bar' },
      { id: 'components-layer-menu',  title: 'Layer Menu' },
      { id: 'components-parameters',  title: 'Parameters Panel' },
      { id: 'components-secondary',   title: 'Secondary Panel' },
      { id: 'components-rasters',     title: 'Raster Panel' },
      { id: 'components-map',         title: 'Map Panel & Controls' },
      { id: 'components-charts',      title: 'Charts Row' },
      { id: 'components-stations',    title: 'Stations Table' },
    ],
  },
  {
    id: 'how-to',
    title: 'How-To Guides',
    children: [
      { id: 'how-to-parameters',  title: 'Browse PMD Parameters' },
      { id: 'how-to-region',      title: 'Toggle Region Layers' },
      { id: 'how-to-secondary',   title: 'Use Secondary Layers' },
      { id: 'how-to-upload',      title: 'Upload GeoJSON / Shapefile' },
      { id: 'how-to-csv',         title: 'Import a CSV Dataset' },
      { id: 'how-to-raster',      title: 'Add a Raster' },
      { id: 'how-to-classify',    title: 'Classify a Raster' },
      { id: 'how-to-style',       title: 'Style a Layer' },
      { id: 'how-to-feature',     title: 'Inspect a Feature' },
    ],
  },
  {
    id: 'api',
    title: 'API Reference',
    children: [],
  },
  {
    id: 'stack',
    title: 'Stack & Tools',
    children: [],
  },
  {
    id: 'deployment',
    title: 'Deployment',
    children: [],
  },
];

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function ContentBody() {
  return (
    <>
      <OverviewSection />
      <LayersSection />
      <ComponentsSection />
      <HowToSection />
      <ApiSection />
      <StackSection />
      <DeploymentSection />
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewSection() {
  return (
    <DocsSection id="overview" eyebrow="Introduction" title="Overview">
      <P>
        <strong>National GLOF Monitoring</strong> is a web dashboard for
        tracking glacial-lake outburst flood risk across Pakistan's
        northern glaciated belt. It pulls live readings from the Pakistan
        Meteorological Department (PMD) station network, layers them over
        regional GIS context (lakes, glaciers, rivers, faultlines, risk
        zones, infrastructure), and lets analysts inspect, style, upload,
        and chart the underlying data without leaving the browser.
      </P>
      <P>
        This page is the operator's manual for everyone using the
        dashboard — what each panel does, how the layers fit together,
        and how to drive the common workflows.
      </P>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 my-5">
        <FeatureCard icon={Thermometer} title="Live PMD parameters" anchor="#layers-stations">
          Five canonical readings (Air Temperature, Rainfall, Stage Level,
          Discharge, Battery Voltage) from every station, colour-binned and
          re-fetched every 10 min by the backend cron.
        </FeatureCard>
        <FeatureCard icon={Layers} title="Region + secondary layers" anchor="#layers">
          16 regional zones with per-region lake / river / glacier / risk
          polygons, plus dashboard-wide reference layers (national / provincial
          boundaries, AKAH infrastructure, settlements, cell towers).
        </FeatureCard>
        <FeatureCard icon={ImageIcon} title="Raster overlays" anchor="#layers-rasters">
          Upload single-band GeoTIFFs and render them as continuous (colormap)
          or classified (per-value swatch) on the map, with live min/max
          stretching and a nodata override.
        </FeatureCard>
        <FeatureCard icon={CloudUpload} title="GeoJSON & shapefile uploads" anchor="#how-to-upload">
          Drop a file in and it appears as a styled overlay alongside the
          built-in region / secondary layers.
        </FeatureCard>
        <FeatureCard icon={LineChart} title="Trend charts" anchor="#components-charts">
          Per-station, per-parameter time-series with daily / weekly / custom
          windows, with a fill that traces the legend's colour bins.
        </FeatureCard>
        <FeatureCard icon={MousePointerClick} title="Feature details" anchor="#components-charts">
          Click any vector feature or raster pixel to see its full attribute
          set (areas in m² / km², lengths in m / km, classified-pixel labels)
          in a card layout.
        </FeatureCard>
      </div>

      <Callout tone="info" title="Two processes, one dashboard">
        The frontend (React + Vite) is a single-page app. The backend
        (Node + Express) owns the PMD cron, the PostGIS endpoints, and
        the raster + upload routes. Both run together in development;
        in production the backend lives on a Linux VM and the frontend
        is served either by the same VM (Docker + Nginx) or by Vercel
        with a rewrite proxying <code>/api/*</code> back to the VM.
      </Callout>

      <Callout tone="warning" title="Application status — under active development">
        The dashboard is shipping continuously. Live PMD parameters,
        region + secondary GIS layers, raster overlays, GeoJSON /
        shapefile / CSV ingest, and unit-aware Feature Details are all
        wired and stable today. The following capabilities are on the
        roadmap and not yet available in this build:
        <UL className="mt-2 mb-0">
          <LI>
            <strong>Real-time alerts</strong> — automated threshold
            triggers on PMD readings (rainfall spikes, river-stage
            crossings, battery-voltage drops) with an in-app alerts
            inbox and notification fan-out.
          </LI>
          <LI>
            <strong>Report generation</strong> — one-click PDF / CSV
            exports of station summaries, layer attribute extracts, and
            time-windowed parameter snapshots for stakeholder reporting.
          </LI>
          <LI>
            <strong>Google Earth Engine integration</strong> — pull
            on-demand snow-cover, NDSI, glacier-velocity, and lake-
            extent products straight from GEE so the dashboard isn't
            limited to whatever has been pre-uploaded as a GeoTIFF.
          </LI>
        </UL>
      </Callout>
    </DocsSection>
  );
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------
function LayersSection() {
  return (
    <DocsSection id="layers" eyebrow="Concepts" title="Map Layers">
      <P>
        Every visible thing on the map (apart from the basemap) is one of
        five layer kinds. The kind determines where the data comes from,
        which panel toggles it, and how it renders.
      </P>

      <DocsSubsection id="layers-region" title="Region Layers">
        <P>
          Per-region GIS polygons + lines for the 16 monitored areas
          (Badswat, Brep, Chatiboi, Chitral, Darkot, Gulmit, Hinarchi,
          Ishokoman, Karambar, Lusht, Pindoru Chaat, Reshun, Sardar Gol,
          Shisper, Terset Hundur, Ultar). Each region has any subset of:{' '}
          <Pill>Lake</Pill> <Pill>River</Pill> <Pill>Glacier</Pill>{' '}
          <Pill>Faultline</Pill> <Pill>Buildings</Pill>{' '}
          <Pill>Schools</Pill> <Pill>Roads</Pill>.
        </P>
        <StatGrid
          items={[
            { label: 'Source',     value: 'PostGIS, schema-per-type (lakes, rivers, glaciers, …)' },
            { label: 'Endpoint',   value: 'GET /api/region/:region/:layerKey' },
            { label: 'Toggled in', value: 'Layer Menu → per-region accordion' },
            { label: 'Geometry',   value: 'Polygons / lines / points (per kind)' },
          ]}
        />
      </DocsSubsection>

      <DocsSubsection id="layers-risk" title="Risk Zones">
        <P>
          Three-level GLOF inundation footprints per region —{' '}
          <Pill tone="risk">High</Pill> <Pill tone="warn">Medium</Pill>{' '}
          <Pill tone="ok">Low</Pill>. Toggled from the Risk Zones row
          inside each region's accordion. Levels can be turned on
          independently so an analyst can inspect just the high-risk
          extent or compare medium vs. low coverage.
        </P>
        <Callout tone="info">
          Not every region has all three levels — Chatiboi, for example,
          ships only High and Medium. Toggles for missing levels return
          empty FeatureCollections and the map silently skips them.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="layers-secondary" title="Secondary Layers">
        <P>
          Country-wide reference layers that don't belong to any one
          region. Eight come from PostGIS, four from a live PMD GIS
          proxy (cached server-side, slightly different rendering).
        </P>
        <UL>
          <LI><strong>National Boundary</strong> + <strong>Provincial Boundary</strong> — administrative outlines.</LI>
          <LI><strong>AKAH Infrastructure</strong> — Aga Khan Agency for Habitat assets (points).</LI>
          <LI><strong>AKAH Hazard Exposure</strong> — return-period polygons.</LI>
          <LI><strong>All Stations</strong> — every PMD station, irrespective of currently selected parameter.</LI>
          <LI><strong>Glacial Lakes</strong> — country-wide HKH inventory (~8,800 polygons).</LI>
          <LI><strong>Settlements</strong> — populated places.</LI>
          <LI><strong>Cell Towers</strong> — mobile-network coverage points.</LI>
          <LI><strong>GLOF Districts / Basins / Lakes / Valley</strong> — live PMD reference layers (proxied via <code>/api/gis/*</code>).</LI>
        </UL>
      </DocsSubsection>

      <DocsSubsection id="layers-stations" title="PMD Stations (Live Parameters)">
        <P>
          Coloured dots showing the current value of the selected parameter
          at every PMD station. The active parameter is picked in the
          Parameters panel; switching parameters re-colours the dots
          instantly without re-fetching the station list.
        </P>
        <StatGrid
          items={[
            { label: 'Refresh cadence',  value: 'Backend cron every 10 minutes (configurable)' },
            { label: 'Stale threshold',  value: '> 10 hours since last reading → grey dot' },
            { label: 'Endpoint',         value: 'GET /api/parameters/:el/latest' },
            { label: 'Parameters',       value: 'Air Temperature, Rainfall, Stage Level, Discharge, Battery Voltage' },
          ]}
        />
        <P>
          Click a dot → it pulses with a radar ripple, the Stations Table
          jumps to that row, and the Charts Row's <Kbd>PMD Data Trend</Kbd>{' '}
          tab fetches its time-series.
        </P>
      </DocsSubsection>

      <DocsSubsection id="layers-rasters" title="Raster Overlays">
        <P>
          Single-band GeoTIFFs uploaded by the user. Each raster is wrapped
          in a "group" — single-frame or temporal series — and rendered
          as a Mapbox <code>image</code> source. Symbology is fully
          interactive: pick a colormap, set min/max stretch, switch to
          classified mode, paint nodata pixels, scrub through frames,
          adjust opacity.
        </P>
        <Callout tone="tip" title="When to use a raster vs. a vector layer">
          Use a raster for continuous fields (elevation, NDVI, snow cover,
          temperature surfaces) or for reclassified categorical maps where
          each pixel value maps to a class. Use vectors for discrete
          features (lakes, roads, buildings).
        </Callout>
      </DocsSubsection>
    </DocsSection>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function ComponentsSection() {
  return (
    <DocsSection id="components" eyebrow="Tour" title="Components">
      <P>
        The dashboard is split into a fixed title bar and three columns —
        a left sidebar (icon strip + stackable panels), the centre map +
        charts column, and a right sidebar (videos + alerts). Every panel
        below is reachable from the icon strip on its side.
      </P>

      <DocsSubsection id="components-titlebar" title="Title Bar">
        <P>
          Brand bar (deep emerald, both themes). Holds the app title, the
          live station-status badge, the day/night theme toggle, and the
          Documentation link that opened this page. On mobile the title
          bar gains hamburger / panel buttons that open the off-canvas
          drawers for Layers and Media.
        </P>
      </DocsSubsection>

      <DocsSubsection id="components-layer-menu" title="Layer Menu">
        <P>
          Left sidebar's primary panel.{' '}
          <Pill tone="brand">Per-region accordion</Pill>: collapsing
          regions with their layer rows. Each row has an eye toggle
          (visibility), a zoom-to-extent <Kbd>↘</Kbd> button, and an
          attribute-table icon that opens the layer in the Charts Row's{' '}
          <Kbd>Attributes Table</Kbd> tab.
        </P>
        <P>
          Risk Zones rows expand into three pill toggles (Low / Medium /
          High) so the analyst can pick exactly which severities to show.
        </P>
      </DocsSubsection>

      <DocsSubsection id="components-parameters" title="Parameters Panel">
        <P>
          Five pill chips, one per PMD parameter. Click to set the active
          parameter — the map's station dots recolour, the legend updates,
          the Stations Table re-sorts. A timestamp under each chip shows
          when that parameter last had a successful fetch (defaults to the
          most-recent cron tick).
        </P>
        <P>
          The <Kbd>↻ Refresh All</Kbd> button forces the backend to re-fetch
          every parameter immediately; the <Kbd>↻</Kbd> next to a chip
          refreshes just that one.
        </P>
      </DocsSubsection>

      <DocsSubsection id="components-secondary" title="Secondary Panel">
        <P>
          Lists the country-wide reference layers + any uploaded layers.
          Each row is a card with: eye toggle, layer-style cog, attribute-
          table icon, zoom-to-extent, and (for uploads) a delete button.
          A search box at the top filters the list.
        </P>
      </DocsSubsection>

      <DocsSubsection id="components-rasters" title="Raster Panel">
        <P>
          Upload, group, and toggle GeoTIFFs. The panel shows one card
          per raster group, each with: filename / group label, a
          temporal slider (for multi-frame groups), an opacity slider, a
          symbology cog, an eye toggle, and a delete button. Clicking
          the cog opens the full Style Editor in a slide-out panel.
        </P>
      </DocsSubsection>

      <DocsSubsection id="components-map" title="Map Panel & Controls">
        <P>
          The Mapbox map fills the centre column. Five custom React
          overlays sit on top, replacing the native Mapbox controls:
        </P>
        <UL>
          <LI><strong>Top-left:</strong> Basemap switcher (5 chips: streets, satellite, hybrid, dark, terrain).</LI>
          <LI><strong>Top-right (inboard):</strong> Geocoder — search a place, drop an amber marker.</LI>
          <LI><strong>Top-right (outboard):</strong> Zoom in / out, reset bearing, locate me, projection toggle (Mercator ↔ Globe), fullscreen.</LI>
          <LI><strong>Bottom-left:</strong> Legend — colour bins for the active parameter, click to mute a bin.</LI>
          <LI><strong>Bottom-right:</strong> Stations Table popup with sortable Station / Value / Updated columns.</LI>
        </UL>
        <Callout tone="tip">
          Hover any layer feature or station and the cursor flips to a
          pointer — that's a click target. Clicking either selects the
          station (PMD trend) or populates the Feature Details tab
          (everything else, including raster pixels).
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="components-charts" title="Charts Row">
        <P>
          The strip below the map. Four tabs that share the same card so
          switching is instant and the layout never jumps:
        </P>
        <UL>
          <LI>
            <Pill tone="brand">Attributes Table</Pill> — opens any layer's
            full attribute set in a paginated table with column sort and
            full-text search. Headers automatically read{' '}
            <strong>Area (km²)</strong> / <strong>Length (m)</strong> when
            unit-bearing columns are present.
          </LI>
          <LI>
            <Pill tone="brand">PMD Data Trend</Pill> — line chart for the
            currently-selected station + parameter. Three windows:{' '}
            <Kbd>Daily</Kbd> (24h), <Kbd>Weekly</Kbd> (7d),{' '}
            <Kbd>Custom</Kbd> (1–365 days). Line + fill use a vertical
            gradient mapped onto the legend bins so the curve literally
            crosses through the same colours the dots use.
          </LI>
          <LI>
            <Pill tone="brand">CSV Trend</Pill> — plot the active CSV
            dataset (X / Y columns picked from the side panel).
          </LI>
          <LI>
            <Pill tone="brand">Feature Details</Pill> — most recently-
            clicked feature's full attribute set, rendered as cards with
            per-field icons, unit suffixes, classified-pixel swatches.
          </LI>
        </UL>
      </DocsSubsection>

      <DocsSubsection id="components-stations" title="Stations Table">
        <P>
          Bottom-right floating dropdown over the map. Switches between the
          five parameters via a Listbox. Three sortable columns: <strong>Station</strong>{' '}
          (alphabetic), <strong>Value</strong> (numeric, with unit in the header),
          and <strong>Updated</strong> (recency). Clicking a row flies the
          map to that station and mirrors the click on the dot.
        </P>
      </DocsSubsection>
    </DocsSection>
  );
}

// ---------------------------------------------------------------------------
// How-To
// ---------------------------------------------------------------------------
function HowToSection() {
  return (
    <DocsSection id="how-to" eyebrow="Workflows" title="How-To Guides">
      <DocsSubsection id="how-to-parameters" title="Browse PMD Parameters">
        <OL>
          <LI>Click any chip in the <strong>Parameters</strong> panel (left sidebar) — e.g. <Kbd>Air Temperature</Kbd>.</LI>
          <LI>The map's station dots recolour using the parameter's legend bins. Stale stations (&gt; 10 h since the last reading) go grey.</LI>
          <LI>Click a dot → it pulses, the Stations Table jumps to that row, and the Charts Row's <Kbd>PMD Data Trend</Kbd> tab loads the time-series.</LI>
          <LI>In the trend tab, switch between <Kbd>Daily</Kbd> / <Kbd>Weekly</Kbd> / <Kbd>Custom</Kbd>. For custom, enter a day count (1–365).</LI>
          <LI>Use the legend (bottom-left of the map) to mute a bin — the matching dots fade out so you can isolate just one severity range.</LI>
        </OL>
      </DocsSubsection>

      <DocsSubsection id="how-to-region" title="Toggle Region Layers">
        <OL>
          <LI>Open the <strong>Layer Menu</strong> from the left icon strip.</LI>
          <LI>Click a region (e.g. <Kbd>Badswat</Kbd>) to expand its accordion.</LI>
          <LI>Toggle the eye on any layer row (Lake, Glacier, Faultline, …) — the layer renders on the map with the colour shown in the row's outline.</LI>
          <LI>Click the <Kbd>↘</Kbd> shrink-button to fly the map to that layer's extent.</LI>
          <LI>Click the table icon to open the layer's attributes in the Charts Row's <Kbd>Attributes Table</Kbd> tab.</LI>
        </OL>
        <Callout tone="info">
          Risk Zones are special — the row expands into three pill toggles
          (Low / Medium / High). Pick any combination.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="how-to-secondary" title="Use Secondary Layers">
        <P>
          Same eye/cog/table/zoom controls as region layers, but toggled
          from the <strong>Secondary</strong> panel (Layers icon strip,
          second slot). Use the search box at the top to filter the list
          when there are many uploads.
        </P>
      </DocsSubsection>

      <DocsSubsection id="how-to-upload" title="Upload a GeoJSON or Shapefile">
        <OL>
          <LI>Open the <strong>Secondary</strong> panel.</LI>
          <LI>Click <Kbd>+ Upload</Kbd> at the top of the panel.</LI>
          <LI>
            Drop a <code>.geojson</code> file or a <code>.zip</code> bundle
            of a shapefile (.shp + .dbf + .shx + .prj) into the file picker.
          </LI>
          <LI>The file is parsed in-browser, geometry detected, default style applied. It appears as a new card in the panel.</LI>
          <LI>Toggle the eye to render it; click the cog to style it.</LI>
        </OL>
        <Callout tone="warning">
          Shapefiles must be in EPSG:4326 (WGS-84 lat/lng). Other CRSes
          parse but render in the wrong place. Re-project with{' '}
          <code>ogr2ogr</code> if needed.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="how-to-csv" title="Import a CSV Dataset">
        <OL>
          <LI>Right sidebar → <strong>CSV Data</strong> panel.</LI>
          <LI>Drop a <code>.csv</code> in. Columns are auto-detected.</LI>
          <LI>Pick an X column and a Y column from the dropdowns.</LI>
          <LI>Optionally add filters — column / operator / value triplets that thin the rows.</LI>
          <LI>Switch the Charts Row to the <Kbd>CSV Trend</Kbd> tab to see the chart.</LI>
        </OL>
      </DocsSubsection>

      <DocsSubsection id="how-to-raster" title="Add a Raster">
        <OL>
          <LI>Open the <strong>Raster</strong> panel from the icon strip.</LI>
          <LI>Click <Kbd>+ Add</Kbd> and select one or more <code>.tif</code> / <code>.tiff</code> files from the catalog (uploaded via the same panel's <Kbd>Upload</Kbd> menu, which posts to <code>/api/rasters</code>).</LI>
          <LI>Choose <strong>Single</strong> (one frame) or <strong>Temporal</strong> (multiple frames sortable by parsed date).</LI>
          <LI>The raster decodes client-side, auto-fits the map to its bounds on first render, and registers with the symbology editor.</LI>
        </OL>
      </DocsSubsection>

      <DocsSubsection id="how-to-classify" title="Classify a Raster">
        <P>
          Use classified mode for reclassified rasters where each pixel
          value maps to a discrete category (e.g. risk levels, land
          cover).
        </P>
        <OL>
          <LI>Open the raster's symbology cog.</LI>
          <LI>Switch the mode pill from <Kbd>Continuous</Kbd> to <Kbd>Classified</Kbd>.</LI>
          <LI>
            Click <Kbd>Auto from data</Kbd> to seed one class per unique
            pixel value (works for low-cardinality bands, typically Byte
            rasters with up to ~16 distinct values). Or add classes
            manually with the <Kbd>+ Add class</Kbd> button.
          </LI>
          <LI>Pick a colour swatch and a legend label per class.</LI>
          <LI>Tweak the nodata paint (off by default — pixels stay transparent).</LI>
        </OL>
        <Callout tone="tip">
          Click any pixel on the map → the <strong>Feature Details</strong>{' '}
          tab now shows the raw pixel value, the matched class label, and
          the class colour as a swatch alongside its hex code.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="how-to-style" title="Style a Layer">
        <P>
          Every visible layer (region, secondary, upload, raster) has a
          symbology cog. Click it to open the Style Editor with controls
          appropriate to the layer's geometry:
        </P>
        <UL>
          <LI><strong>Polygons:</strong> fill colour + opacity, stroke colour + width + dash, label expression, optional categorical / graduated palette driven by an attribute.</LI>
          <LI><strong>Lines:</strong> stroke colour + width + dash, optional pattern, attribute-driven categories.</LI>
          <LI><strong>Points:</strong> radius, fill, stroke, plus marker symbology — pick a built-in icon shape and the renderer rasterises a PNG sprite.</LI>
          <LI><strong>Rasters:</strong> mode (continuous / classified), colormap, min/max stretch (auto or manual), classes editor, nodata paint, opacity.</LI>
        </UL>
      </DocsSubsection>

      <DocsSubsection id="how-to-feature" title="Inspect a Feature">
        <OL>
          <LI>Make sure the layer you want to inspect is visible (eye toggled on in its panel).</LI>
          <LI>Hover the map — the cursor changes to a pointer over any clickable feature, station dot, or raster pixel.</LI>
          <LI>Click. The <Kbd>Feature Details</Kbd> tab in the Charts Row populates with the feature's full attribute set, formatted as cards with icons + units.</LI>
          <LI>Manually switch to the Feature Details tab when you want to read the result — it doesn't auto-switch (so you don't lose your place in the trend chart).</LI>
        </OL>
        <Callout tone="info">
          Server-derived stats (<code>area_km2</code>, <code>area_m2</code>,{' '}
          <code>perimeter_km</code>, <code>length_m</code>, …) are merged
          into every region/secondary feature's properties at query time.
          That's why you'll see correctly-unit-labelled tiles even when
          the source table didn't carry a unit-suffix column.
        </Callout>
      </DocsSubsection>
    </DocsSection>
  );
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
function ApiSection() {
  return (
    <DocsSection id="api" eyebrow="Reference" title="API Reference">
      <P>
        Every dashboard fetch goes through the Express backend. Frontend
        dev hits localhost:3001 via Vite's <code>/api</code> proxy; the
        VM build hits the backend container via Nginx; Vercel rewrites
        forward to the public VM IP. Same path string everywhere.
      </P>

      <DocsSubsection id="api-parameters" title="PMD Parameters">
        <ApiPill method="GET" path="/api/parameters" />
        <ApiPill method="GET" path="/api/parameters/status" />
        <ApiPill method="GET" path="/api/parameters/:el/latest" />
        <ApiPill method="GET" path="/api/parameters/:el/geojson" />
        <ApiPill method="GET" path="/api/parameters/:el/stations/:id/trend?bucket=hour|day&days=N" />
        <ApiPill method="POST" path="/api/parameters/:el/store" />
        <ApiPill method="POST" path="/api/parameters/refresh-all" />
      </DocsSubsection>

      <DocsSubsection id="api-region" title="Region & Secondary Layers">
        <ApiPill method="GET" path="/api/region/:region/:layerKey" />
        <ApiPill method="GET" path="/api/secondary/:layer" />
        <ApiPill method="GET" path="/api/gis/:layer" />
        <P>
          Region + secondary endpoints attach derived geometry stats —{' '}
          <code>area_m2</code>, <code>area_km2</code>,{' '}
          <code>perimeter_m</code>, <code>perimeter_km</code> for
          polygons; <code>length_m</code>, <code>length_km</code> for
          lines — computed via PostGIS <code>ST_Area</code> /{' '}
          <code>ST_Length</code> on the geography cast. The client
          recognises the unit suffix and renders values with their
          proper symbol.
        </P>
      </DocsSubsection>

      <DocsSubsection id="api-rasters" title="Rasters & Uploads">
        <ApiPill method="GET" path="/api/rasters" />
        <ApiPill method="GET" path="/api/rasters/:filename" />
        <ApiPill method="POST" path="/api/rasters/upload" />
        <ApiPill method="DELETE" path="/api/rasters/:filename" />
        <ApiPill method="POST" path="/api/upload/import" />
      </DocsSubsection>

      <DocsSubsection id="api-misc" title="Miscellaneous">
        <ApiPill method="GET" path="/api/csv/:layer" />
        <ApiPill method="GET" path="/api/db/tables" />
        <ApiPill method="GET" path="/health" />
      </DocsSubsection>
    </DocsSection>
  );
}

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------
function StackSection() {
  return (
    <DocsSection id="stack" eyebrow="Tooling" title="Stack & Tools">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
        <FeatureCard icon={Map} title="Frontend">
          React 18, Vite 5, Tailwind 3, Mapbox GL JS, Chart.js + react-chartjs-2,
          Headless UI, Framer Motion, lucide-react. React Router 7 for the
          dashboard ↔ docs split.
        </FeatureCard>
        <FeatureCard icon={Server} title="Backend">
          Node 20, Express, pg (Postgres + PostGIS), undici (with a
          PMD-scoped insecure-TLS dispatcher), GeoTIFF parsing via{' '}
          <code>geotiff</code> + sharp/canvas pipelines.
        </FeatureCard>
        <FeatureCard icon={Network} title="Database">
          PostgreSQL 17 with PostGIS 3.5. One schema per layer kind
          (<code>lakes</code>, <code>rivers</code>, <code>glaciers</code>,
          <code>risk_zones</code>, …) plus a <code>secondary</code>{' '}
          schema for cross-region reference layers.
        </FeatureCard>
        <FeatureCard icon={Cloud} title="Hosting">
          A Linux VM runs <code>db</code> + <code>backend</code> +{' '}
          <code>frontend</code> via <code>docker-compose</code>. Vercel
          serves the public preview; <code>vercel.json</code> rewrites
          <code>/api/*</code> to the VM so the frontend talks to a single
          backend regardless of where it's served from.
        </FeatureCard>
      </div>
    </DocsSection>
  );
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------
function DeploymentSection() {
  return (
    <DocsSection id="deployment" eyebrow="Operations" title="Deployment">
      <P>
        Two production targets share a single backend: the VM at the
        configured public IP (port 8090) and Vercel at{' '}
        <a
          href="https://national-glof-watch.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <code>https://national-glof-watch.vercel.app</code>
        </a>
        . Both serve the same React build; both call{' '}
        <code>/api/*</code>; the only difference is who handles the API
        proxy.
      </P>

      <DocsSubsection id="deployment-vercel" title="Vercel">
        <UL>
          <LI><strong>Framework preset:</strong> Vite (auto SPA fallback).</LI>
          <LI><strong>Build command:</strong> <code>npm run build</code>.</LI>
          <LI><strong>Output directory:</strong> <code>dist</code>.</LI>
          <LI><strong>Rewrites</strong> (in <code>vercel.json</code>): <code>/api/:path*</code> → backend on the VM, so cross-origin and mixed-content concerns disappear.</LI>
          <LI><strong>Env vars:</strong> set <code>VITE_MAPBOX_TOKEN</code> in the project's Environment Variables panel (Production + Preview). Optional defaults in code if the others are unset.</LI>
          <LI><strong>Ignore patterns</strong> (in <code>.vercelignore</code>): server, scripts, docker, legacy, etc. Patterns are root-anchored to avoid accidentally stripping <code>src/assets/images/alerts/</code>.</LI>
        </UL>
      </DocsSubsection>

      <DocsSubsection id="deployment-vm" title="VM (Docker stack)">
        <P>
          Three services on one Compose network: <code>db</code> (PostGIS
          17), <code>backend</code> (Node + Express + cron), <code>frontend</code>{' '}
          (Nginx serving the Vite build, reverse-proxying <code>/api/*</code>{' '}
          to the backend container).
        </P>
        <UL>
          <LI><strong>Frontend port:</strong> host 8090 → container 80 (avoiding 80/8080 collisions on the host).</LI>
          <LI><strong>Persistent storage:</strong> Postgres data volume; <code>/opt/glof/rasters</code> bind-mount for uploaded GeoTIFFs so they survive container churn.</LI>
          <LI><strong>Healthcheck:</strong> backend waits for <code>pg_isready</code> via Compose <code>depends_on</code> condition.</LI>
        </UL>
      </DocsSubsection>

      <DocsSubsection id="deployment-scripts" title="Deploy Scripts">
        <P>
          Shell scripts live under <code>scripts/deploy/</code> (run
          locally; some SSH into the VM):
        </P>
        <StatGrid
          items={[
            { label: 'release.sh',     value: 'End-to-end: promote → sync rasters → SSH + vm-deploy.' },
            { label: 'promote.sh',     value: 'Fast-forward prod from main, tag the commit, push to GitHub.' },
            { label: 'vm-deploy.sh',   value: 'Runs ON the VM: git fetch + checkout prod + docker compose build + up.' },
            { label: 'vm-seed-db.sh',  value: 'Runs ON the VM: restore a plain-SQL dump into the prod database.' },
            { label: 'sync-db-dump.sh',value: 'Push a fresh pg_dump from dev → /opt/glof/db-imports/ on the VM.' },
            { label: 'sync-rasters.sh',value: 'Rsync local data/rasters/ → /opt/glof/rasters/ on the VM.' },
            { label: 'rollback.sh',    value: 'Reset the VM to a previous release tag.' },
          ]}
        />
        <P>
          DB-side scripts under <code>scripts/db/</code>:
        </P>
        <StatGrid
          items={[
            { label: 'backup.ps1 / backup.sh',   value: 'Plain-SQL pg_dump of the local dev database to backups/.' },
            { label: 'restore.ps1 / restore.sh', value: 'Stream a backups/*.sql file back into a fresh local database.' },
            { label: 'run-backup.js',            value: 'Cross-platform launcher (npm run db:backup).' },
            { label: 'run-restore.js',           value: 'Cross-platform launcher (npm run db:restore).' },
          ]}
        />
      </DocsSubsection>
    </DocsSection>
  );
}
