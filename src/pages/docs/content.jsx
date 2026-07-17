import {
  Activity,
  AlertCircle,
  ArrowDown,
  Box,
  Cloud,
  CloudUpload,
  Compass,
  Database,
  FileDown,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  LineChart,
  Map,
  MapPin,
  MousePointerClick,
  Network,
  PaintBucket,
  Palette,
  Radio,
  Save,
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
    id: 'monitoring',
    title: 'Monitoring Surface',
    children: [
      { id: 'monitoring-overview',      title: 'What it is' },
      { id: 'monitoring-grid',          title: 'Grid Layouts' },
      { id: 'monitoring-cells',         title: 'Cells & Sync' },
      { id: 'monitoring-districts',     title: 'Districts Overlay' },
      { id: 'monitoring-classification',title: 'PMD vs NDMA' },
      { id: 'monitoring-charts',        title: 'Charts Panel' },
      { id: 'monitoring-report',        title: 'PDF Report' },
      { id: 'monitoring-persistence',   title: 'Persistence' },
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
      { id: 'how-to-monitoring',  title: 'Open the Monitoring Surface' },
      { id: 'how-to-monitoring-cells', title: 'Configure Cells & Districts' },
      { id: 'how-to-monitoring-report', title: 'Export a PDF Report' },
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
      <MonitoringSection />
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
          The full Datascape v3 element catalog (40+ elements — air
          temperature, water level, discharge, rain intensity, atmospheric
          pressure, and more) fetched every 10 min and coloured per station
          by its real PMD alert state.
        </FeatureCard>
        <FeatureCard icon={Grid3x3} title="Monitoring surface" anchor="#monitoring">
          A parallel comparison view: up to four synced Mapbox cells, each
          with its own parameter, all sharing pan and zoom, with a live
          chart row per cell and one-click PDF export.
        </FeatureCard>
        <FeatureCard icon={AlertCircle} title="PMD + NDMA classification" anchor="#monitoring-classification">
          Flip every cell (or the main dashboard) between PMD's official
          alert bands and NDMA's early-warning bands (thresholds tightened
          10 %) so operators can compare the two views side by side.
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
        <FeatureCard icon={FileDown} title="PDF monitoring report" anchor="#monitoring-report">
          One-click export of the current Monitoring grid: cover page,
          per-cell map snapshot, high-resolution trend chart, sampled
          readings table with min/max highlights, station attributes, and
          district context (own district plus neighbours).
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
        shapefile / CSV ingest, unit-aware Feature Details, the
        Monitoring surface (grid of synced cells + charts panel), and
        PDF report export are all wired and stable today. The
        following capabilities are on the roadmap:
        <UL className="mt-2 mb-0">
          <LI>
            <strong>Real-time alerts</strong> — automated fan-out on
            threshold breaches (rainfall spikes, water-level crossings,
            classification changes) with an in-app alerts inbox,
            email/SMS delivery, and one-click acknowledgement.
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
          Coloured dots showing the current <strong>alert state</strong> of
          the selected parameter at every PMD station. The active parameter
          is picked in the Parameters panel; switching parameters re-colours
          the dots instantly without re-fetching the station list.
        </P>
        <P>
          Each station is classified against its own decoded alert bands
          (from PMD's <code>entryCfgs</code>) into one of six states:{' '}
          <Pill tone="ok">Normal</Pill> <Pill tone="warn">Warning</Pill>{' '}
          <Pill tone="warn">Pre-alarm</Pill> <Pill tone="risk">Alarm</Pill>{' '}
          <Pill>Error</Pill> <Pill>No data</Pill>. A station keeps its
          real alert-state colour <em>regardless of reading age</em> —
          only stations with no classified reading at all fall back to
          the grey "No data" state.
        </P>
        <StatGrid
          items={[
            { label: 'Value cron',       value: 'Every 10 minutes (STORE_INTERVAL_MIN)' },
            { label: 'Threshold cron',   value: 'Every 30 days (THRESHOLD_INTERVAL_DAYS)' },
            { label: 'Endpoint',         value: 'GET /api/parameters/:el/latest' },
            { label: 'Element catalog',  value: '40+ elements from the Datascape v3 API' },
          ]}
        />
        <Callout tone="info" title="Alarm pulsing">
          Every station currently in the <strong>Alarm</strong> state gets a
          continuous red radar pulse painted around its dot, so an
          operator glancing at the map can spot critical stations without
          opening the legend or the table. Clicking a dot triggers a
          separate amber selection ripple on that station only.
        </Callout>
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
          Brand bar (deep emerald, both themes). From left to right:
          rotating NDMA logo, app title, and — on wide screens — two
          live status badges before the day/night toggle and the
          Documentation link that opened this page. On mobile the
          title bar gains hamburger / panel buttons that open the
          off-canvas drawers for Layers and Media.
        </P>
        <UL>
          <LI>
            <strong>Sensor Types</strong> badge — a colour-coded chip row
            broken down by sensor family (ARG, WP, WL-R, DG, WL-L, AWS,
            AWS-H). Counts come from{' '}
            <code>/api/parameters/sensor-types</code>, cached one hour
            because the roster changes on the order of days. Each chip's
            tooltip expands the abbreviation ("ARG" → "Automatic Rain
            Gauge").
          </LI>
          <LI>
            <strong>PMD GLOF 2 Live</strong> badge — the network-status
            pill: total stations, total active, and currently active
            within the reporting window. Backed by a warm-cache cron in
            the backend so it always responds in milliseconds even when
            the upstream PMD API is slow. A pulsing dot goes emerald
            when the last fetch succeeded and amber when the badge is
            operating on stale data (with the reason in a tooltip and
            the refresh button live).
          </LI>
        </UL>
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
          A scrollable, searchable list of every element in the Datascape
          v3 catalog (40+ names — Air Temperature, Water Level, Cumulative
          Flow, Rain Intensity, Atmospheric Pressure, and many more).
          Click a row to set the active parameter: the map's station dots
          recolour by that element's alert state, the legend updates, the
          Stations Table re-sorts, and the badge next to each row shows
          how many stations currently report that element.
        </P>
        <P>
          The <Kbd>↻ Refresh All</Kbd> button forces the backend to run
          one full value cycle now; the <Kbd>↻</Kbd> next to a row
          refreshes just that element. A timestamp under each row shows
          when that element last had a successful cron tick.
        </P>
        <Callout tone="info">
          The element list is <em>dynamic</em> — it comes from the
          <code>station_elements</code> catalog rebuilt monthly by the
          threshold cron, not from a hard-coded list. As PMD adds sensors
          or elements, they appear here automatically.
        </Callout>
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
// Monitoring
// ---------------------------------------------------------------------------
function MonitoringSection() {
  return (
    <DocsSection id="monitoring" eyebrow="Surface" title="Monitoring Surface">
      <P>
        A parallel view to the main dashboard, opened from the{' '}
        <Kbd>Monitoring</Kbd> icon in the left sidebar (between{' '}
        <Kbd>Secondary</Kbd> and <Kbd>CSV</Kbd>). Instead of one big map
        with one active parameter, the Monitoring surface shows up to
        four map cells side by side, each with its own parameter, all
        sharing pan and zoom, plus an always-visible chart panel and a
        one-click PDF export.
      </P>

      <DocsSubsection id="monitoring-overview" title="What it is (and when to use it)">
        <P>
          Reach for the Monitoring surface when you need to <em>compare</em>{' '}
          multiple things at once — the same station across different
          parameters, or the same parameter across different regions, or
          both classification methods at the same time. The main
          dashboard shows one signal at a time; the Monitoring surface
          shows several, without switching contexts.
        </P>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 my-4">
          <FeatureCard icon={Grid3x3} title="3 grid layouts" anchor="#monitoring-grid">
            Icon-only picker: 2 × 2, 1 | 2 (left column spans both rows),
            and 2 + 1 (top row spans both columns).
          </FeatureCard>
          <FeatureCard icon={Radio} title="Synced view" anchor="#monitoring-cells">
            Pan, zoom, or rotate any cell and every other cell rehomes
            to match. Click a station and the whole grid flies to its
            neighbourhood.
          </FeatureCard>
          <FeatureCard icon={MapPin} title="Districts overlay" anchor="#monitoring-districts">
            Prominent district boundaries under every cell, with
            configurable colour, opacity, outline width, and toggleable
            red-on-yellow labels.
          </FeatureCard>
          <FeatureCard icon={AlertCircle} title="Classification toggle" anchor="#monitoring-classification">
            Flip every cell between PMD's official bands and NDMA's
            early-warning bands in one click.
          </FeatureCard>
          <FeatureCard icon={LineChart} title="Live charts panel" anchor="#monitoring-charts">
            One chart row per cell, all sharing a single time-window
            control. Charts always visible while Monitoring is active.
          </FeatureCard>
          <FeatureCard icon={FileDown} title="One-click PDF" anchor="#monitoring-report">
            Export the current grid as a polished multi-page report with
            map snapshots, chart images, and district context per cell.
          </FeatureCard>
        </div>
      </DocsSubsection>

      <DocsSubsection id="monitoring-grid" title="Grid Layouts">
        <P>
          Pick one of the three layouts at the top of the config panel.
          Each layout locks in a fixed cell count so the comparison
          view stays legible.
        </P>
        <StatGrid
          items={[
            { label: '2 × 2',  value: '4 cells (a, b, c, d) — the general-purpose comparison view.' },
            { label: '1 | 2',  value: '3 cells — a big left cell + two stacked cells on the right.' },
            { label: '2 + 1',  value: '3 cells — a wide top cell + two cells sharing the bottom row.' },
          ]}
        />
        <Callout tone="tip">
          Layout, parameter picks, pinned stations, map pose, districts
          config, and classification method all persist through page
          reloads via <code>localStorage</code>. You come back to
          exactly the surface you left.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="monitoring-cells" title="Cells & Sync">
        <P>
          Each cell owns its own Mapbox instance and its own
          parameter. Cells are keyed by area letter (<code>a</code>,{' '}
          <code>b</code>, …) so switching layouts doesn't shuffle the
          parameters you already assigned — the same cell 'a' keeps
          its parameter when the layout grows or shrinks.
        </P>
        <UL>
          <LI>
            <strong>Parameter picker</strong> (top-right of each cell) — themed
            dropdown with inline search; picks from the same Datascape
            v3 catalog as the main dashboard.
          </LI>
          <LI>
            <strong>Cell letter badge</strong> (top-left) — accent colour
            matches the picked parameter so cells stay identifiable at
            a glance.
          </LI>
          <LI>
            <strong>Basic controls</strong> (bottom-right) — zoom in / out,
            focus-to-parameter-extent, reset north.
          </LI>
          <LI>
            <strong>Alarm pulse</strong> — every Alarm-classified station
            in a cell pulses continuously so ops can spot it without
            hunting.
          </LI>
          <LI>
            <strong>Selection ripple</strong> — clicking a dot pins that
            station with an amber ripple and flies the grid to it
            (zoom 8, 80 px padding — enough surrounding context to
            recognise the network around it).
          </LI>
          <LI>
            <strong>Always-on labels</strong> — station names render as
            small dark-on-yellow-halo text below each dot, gated at
            zoom 7+ so overview zoom stays scannable.
          </LI>
        </UL>
        <Callout tone="info">
          Sync uses an <code>eventData</code> tag on programmatic{' '}
          <code>jumpTo</code> calls so the origin cell's move doesn't
          ping-pong back through every follower. Each cell filters its
          own tagged moveends out and only broadcasts real user input.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="monitoring-districts" title="Districts Overlay">
        <P>
          Every cell renders a district polygon layer under its station
          dots, filtered server-side to just Gilgit Baltistan and
          Khyber Pakhtunkhwa — the two provinces that hold every
          monitoring station. The overlay is fully configurable from
          the config panel.
        </P>
        <UL>
          <LI>
            <strong>Style</strong> — five out-of-theme colour presets
            (beige, sand, gray, charcoal, mocha) so the reference
            boundary never competes with the station palette.
          </LI>
          <LI>
            <strong>Outline</strong> — line-width slider 0.5–3.5 px.
          </LI>
          <LI>
            <strong>Opacity</strong> — 0–100 %; drives line-opacity
            directly and fill-opacity at ~35 % of that.
          </LI>
          <LI>
            <strong>Labels</strong> — on by default; fixed red-on-yellow
            style with a slim halo. INITCAP-normalised at the SQL
            layer, so <code>SKARDU</code> renders as <code>Skardu</code>.
          </LI>
        </UL>
        <Callout tone="tip">
          Basemap opacity in Monitoring is pinned at 60 % so overlays
          (districts + stations) always read clearly on top of dense
          satellite imagery — no per-cell slider.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="monitoring-classification" title="PMD vs NDMA Classification">
        <P>
          A segmented toggle in the config panel flips every cell between
          two classification methods:
        </P>
        <UL>
          <LI>
            <Pill tone="brand">PMD</Pill> — the official alert bands
            decoded verbatim from PMD's <code>entryCfgs</code> per
            station element.
          </LI>
          <LI>
            <Pill tone="risk">NDMA</Pill> — the same bands with every
            threshold tightened by 10 % (factor 0.9). The same reading
            that classifies as <em>Pre-alarm</em> under PMD can trip{' '}
            <em>Alarm</em> under NDMA — that's the point.
          </LI>
        </UL>
        <P>
          The toggle is deliberately independent of the main
          dashboard's classification, so an operator can compare
          PMD-classified data on the main map and NDMA-classified data
          in the Monitoring grid at the same time.
        </P>
      </DocsSubsection>

      <DocsSubsection id="monitoring-charts" title="Charts Panel">
        <P>
          A fixed 460 px column on the right side of the Monitoring
          grid. Always visible while Monitoring is on — no modal, no
          slide-out, no interaction with the maps. One chart row per
          active cell.
        </P>
        <UL>
          <LI>
            <strong>Shared window</strong> at the top: Daily (24 h) /
            Weekly (7 d) / Custom (1–60 days). Applies to every row so
            comparisons stay on the same X axis.
          </LI>
          <LI>
            <strong>Row header</strong>: cell letter badge in the
            parameter accent, parameter name, date range, an{' '}
            <Kbd>AUTO</Kbd> tag when the station was auto-picked, and
            a station picker pinned to the right edge.
          </LI>
          <LI>
            <strong>Chart</strong>: same Chart.js config as the main{' '}
            <Kbd>PMD Data Trend</Kbd> tab (gradient fill, day markers,
            min/max markers) but scaled to fit inside the row.
          </LI>
          <LI>
            <strong>Auto-pick</strong>: if no station is pinned, the row
            plots the first station alphabetically that reports the
            parameter. The pick is <em>not</em> written back to context,
            so the map ripple stays off until the operator clicks a dot.
          </LI>
        </UL>
      </DocsSubsection>

      <DocsSubsection id="monitoring-report" title="PDF Report">
        <P>
          Click the <Kbd>Report</Kbd> button in the config panel. A
          confirmation modal shows what the export will include (layout,
          cells with parameters + resolved stations, time window,
          classification) and streams a live progress line while the
          PDF renders. On confirm, the report opens a save-as picker
          (or falls back to the classic download link on browsers that
          don't support it).
        </P>
        <P>What's inside:</P>
        <UL>
          <LI>
            <strong>Cover page</strong> — slim emerald hero band with
            brand mark and classification pill, title, meta card
            (layout · window · classification · report ID · generation
            timestamp), a colour-coded "Cell summary" table, and a
            justified description paragraph.
          </LI>
          <LI>
            <strong>Per-cell section</strong> — parameter-accent header
            bar with cell badge + parameter + station, location card
            (district / province / division / neighbours via{' '}
            <code>ST_Touches</code>), map snapshot at up to 110 mm
            tall, high-resolution chart image (rebuilt off-screen at
            2400 × 750 for print quality), sampled readings table with
            min/max highlights and a red→green value gradient, station
            attributes table, and station photos in a 1/2/2×2 grid.
          </LI>
          <LI>
            <strong>Every page</strong> — emerald page header stamp with
            report ID on the right; footer with generation timestamp
            and "Page N of M". Classification method is stamped on
            every page so there's no ambiguity about which bands the
            report reflects.
          </LI>
        </UL>
        <Callout tone="info">
          Map snapshots come from <code>preserveDrawingBuffer</code>{' '}
          on each cell's Mapbox canvas — the report grabs live pixels,
          not off-screen re-renders. Chart snapshots are rebuilt at
          higher resolution so they print sharply.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="monitoring-persistence" title="Persistence">
        <P>
          Every user-facing setting on the Monitoring surface is stored
          in <code>localStorage</code> under a versioned{' '}
          <code>monitoring:*:v1</code> namespace. Persisted:
        </P>
        <UL>
          <LI>Active / not active, layout, parameters per cell, pinned stations per cell.</LI>
          <LI>Basemap style, 3D terrain toggle, map pan/zoom/bearing/pitch.</LI>
          <LI>Districts overlay (colour preset, opacity, outline width, labels toggle).</LI>
          <LI>Classification method (PMD or NDMA).</LI>
          <LI>Chart window (Daily / Weekly / Custom + custom day count).</LI>
        </UL>
        <P>
          Reload the page and the surface comes back exactly as you
          left it — every parameter still picked, every station still
          pinned, the map still in the same pose. Only truly ephemeral
          state (fullscreen, in-flight sync counters) resets on reload.
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

      <DocsSubsection id="how-to-monitoring" title="Open the Monitoring Surface">
        <OL>
          <LI>
            Click the <Kbd>Monitoring</Kbd> icon in the left sidebar (between
            <Kbd>Secondary</Kbd> and <Kbd>CSV</Kbd>). The main dashboard
            gives way to a grid of map cells + a charts panel on the right.
          </LI>
          <LI>
            Pick a grid layout at the top of the config panel:{' '}
            <Kbd>2 × 2</Kbd>, <Kbd>1 | 2</Kbd>, or <Kbd>2 + 1</Kbd>. The
            grid re-shapes immediately.
          </LI>
          <LI>
            The bottom of the config panel shows the alert-state legend
            (Normal / Warning / Pre-alarm / Alarm / Error / No data /
            Warning Post) so the dot colours read the same as on the main
            dashboard.
          </LI>
          <LI>
            Toggle the icon again (or hit <Kbd>Reset View</Kbd> +{' '}
            <Kbd>Exit Fullscreen</Kbd>) to return to your previous state.
            Everything you did will still be there next time you open it —
            settings are persisted per browser.
          </LI>
        </OL>
      </DocsSubsection>

      <DocsSubsection id="how-to-monitoring-cells" title="Configure Cells & Districts">
        <OL>
          <LI>
            In the config panel's <strong>Cell Parameters</strong> row,
            pick a parameter for each cell letter (A, B, C, D). The map
            in that cell fetches the parameter's stations and auto-fits
            to their extent the first time.
          </LI>
          <LI>
            Click any dot in a cell → the whole grid flies to that
            station's neighbourhood (zoom 8, 80 px padding) and the
            picked station gets an amber selection ripple in its own
            cell. Click again to clear.
          </LI>
          <LI>
            In the <strong>Districts</strong> row, pick a colour preset,
            drag the outline and opacity sliders, and toggle labels on
            or off. Changes apply to every cell at once.
          </LI>
          <LI>
            In the <strong>Classification</strong> row, flip between{' '}
            <Kbd>PMD</Kbd> and <Kbd>NDMA</Kbd>. Station colours update
            everywhere immediately.
          </LI>
        </OL>
        <Callout tone="tip">
          The chart panel on the right updates in lockstep with the map
          selection — clicking a dot in a cell also swaps the row's
          plotted station. Use the row's own station dropdown to pick
          a station without moving the map.
        </Callout>
      </DocsSubsection>

      <DocsSubsection id="how-to-monitoring-report" title="Export a PDF Report">
        <OL>
          <LI>
            Configure the Monitoring grid the way you want it exported —
            pick parameters, pin stations, set the chart window (Daily
            / Weekly / Custom), choose PMD or NDMA.
          </LI>
          <LI>
            Click <Kbd>Report</Kbd> in the config panel actions row. A
            confirmation modal opens listing what will be included per
            cell and the current classification method.
          </LI>
          <LI>
            Click <Kbd>Yes, export PDF</Kbd>. A progress line streams
            live ("Snapshotting cell A…", "Snapshotting cell B…", …).
          </LI>
          <LI>
            When the render finishes, a save-as picker opens (Chrome /
            Edge) — pick where to save. On Firefox or Safari the file
            downloads to the browser's default folder. Filename pattern:{' '}
            <code>glof-monitoring-report_YYYY-MM-DD_HHmm_&lt;layout&gt;_&lt;PMD|NDMA&gt;.pdf</code>.
          </LI>
        </OL>
        <Callout tone="warning">
          Cells without a picked parameter are skipped in the export.
          The confirmation modal flags them as "no station yet" so you
          can back out and finish configuring before spending the render
          time.
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
        <ApiPill method="GET"  path="/api/parameters/elements" />
        <ApiPill method="GET"  path="/api/parameters/status" />
        <ApiPill method="GET"  path="/api/parameters/sensor-types" />
        <ApiPill method="GET"  path="/api/parameters/station-status" />
        <ApiPill method="GET"  path="/api/parameters/:el/latest" />
        <ApiPill method="GET"  path="/api/parameters/:el/latest?earlyFactor=0.9" />
        <ApiPill method="GET"  path="/api/parameters/:el/stations/:id/trend?days=N" />
        <ApiPill method="GET"  path="/api/parameters/element/:elementId/thresholds" />
        <ApiPill method="GET"  path="/api/parameters/thresholds/status" />
        <ApiPill method="POST" path="/api/parameters/thresholds/refresh" />
        <ApiPill method="POST" path="/api/parameters/refresh-all" />
        <ApiPill method="GET"  path="/api/parameters/stations/:id/photos" />
        <ApiPill method="GET"  path="/api/parameters/station-photo" />
        <P>
          <code>/elements</code> returns the full Datascape v3 element
          catalog with <code>{'{ name, unit, stationCount }'}</code>{' '}
          per element.{' '}
          <code>/sensor-types</code> parses the station-name convention{' '}
          (<code>Region_TYPE_n</code>) into a family breakdown used by
          the titlebar chip row. <code>/station-status</code> is served
          from a warm cache refreshed in-process every few minutes so
          the titlebar badge never blocks on the slow upstream. The
          <code>earlyFactor</code> query on <code>/latest</code>{' '}
          switches the response into NDMA-classified mode (defaults to
          0.9 — every threshold tightened 10 %).
        </P>
      </DocsSubsection>

      <DocsSubsection id="api-region" title="Region & Secondary Layers">
        <ApiPill method="GET" path="/api/region/:region/:layerKey" />
        <ApiPill method="GET" path="/api/secondary/:layer" />
        <ApiPill method="GET" path="/api/secondary/sensor-counts" />
        <ApiPill method="GET" path="/api/secondary/monitoring-districts" />
        <ApiPill method="GET" path="/api/secondary/district-at?lng=&lat=" />
        <ApiPill method="GET" path="/api/secondary/district-neighbours/:district" />
        <ApiPill method="GET" path="/api/gis/:layer" />
        <P>
          Region + <code>/secondary/:layer</code> endpoints attach
          derived geometry stats — <code>area_m2</code>,{' '}
          <code>area_km2</code>, <code>perimeter_m</code>,{' '}
          <code>perimeter_km</code> for polygons;{' '}
          <code>length_m</code>, <code>length_km</code> for lines —
          computed via PostGIS <code>ST_Area</code> /{' '}
          <code>ST_Length</code> on the geography cast. The client
          recognises the unit suffix and renders values with their
          proper symbol.
        </P>
        <P>
          The three <code>district-*</code> endpoints power the
          Monitoring surface's districts overlay and the PDF report's
          location context.{' '}
          <code>monitoring-districts</code> returns a FeatureCollection
          pre-filtered to Gilgit Baltistan + Khyber Pakhtunkhwa (the
          two provinces that hold every monitoring station).{' '}
          <code>district-at</code> reverse-geocodes a lng/lat to its
          containing district via <code>ST_Contains</code>.{' '}
          <code>district-neighbours/:district</code> returns the
          district's own admin context alongside the list of districts
          whose polygons share a boundary with it (via{' '}
          <code>ST_Touches</code>).
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
