import { ensureFirstParameterPicked, ensurePanelOpen, ensureTab } from './tourActions';

// Tour catalog — the list surfaced by TourLauncher and consumed by
// TourContext. Each tour is an ordered array of steps; each step
// points at a CSS selector (usually `[data-tour-id="…"]`) and carries
// the tooltip content the overlay renders.
//
// Step shape
// ------------------------------------------------------------------
//   {
//     id:       'unique-step-id',
//     target:   '[data-tour-id="anchor"]' | null,
//     title:    'Short title',
//     body:     'Paragraph, kept to ~2 sentences.',
//     side:     'top' | 'bottom' | 'left' | 'right' | 'center',
//     padding:  number,                // extra px around the spotlight
//     onEnter:  () => void,            // optional side effect (open a panel, etc.)
//   }
//
// `target: null` renders a centred modal-style step (used for
// welcome/intro screens where no specific element is the focus).
//
// `onEnter` fires each time the overlay enters a step. Use it to
// nudge the UI into the state that makes the step's tooltip make
// sense — open the panel we're describing, switch to the tab we're
// pointing at, etc. Helpers in ./tourActions handle the guards so
// re-entering a step doesn't toggle the panel off again.

export const TOURS = [
  // -----------------------------------------------------------------
  // Welcome — 5-step first-visit intro.
  // -----------------------------------------------------------------
  {
    id: 'welcome',
    name: 'Welcome tour',
    description: '2-minute overview of what the dashboard does and where the main pieces live.',
    steps: [
      {
        id: 'welcome-intro',
        target: null,
        side: 'center',
        title: 'Welcome to National GLOF Monitoring',
        body:
          'This is the operator\'s dashboard for tracking glacial-lake outburst flood risk across northern Pakistan. Live PMD sensor data, layered GIS context, and a monitoring surface for side-by-side comparisons — all in one place.',
      },
      {
        id: 'welcome-titlebar',
        target: '[data-tour-id="titlebar"]',
        side: 'bottom',
        title: 'Brand bar',
        body:
          'The emerald bar at the top holds live network status, sensor-type counts, the theme toggle, this documentation link, and the tour button that opens this walkthrough.',
      },
      {
        id: 'welcome-left-sidebar',
        target: '[data-tour-id="left-sidebar"]',
        side: 'right',
        title: 'Left sidebar',
        body:
          'Stack of icon buttons that open panels: Parameters, Layer Menu, Secondary layers, CSV data, and the Monitoring surface.',
      },
      {
        id: 'welcome-map',
        target: '[data-tour-id="map-panel"]',
        side: 'left',
        title: 'The map',
        body:
          'The centre canvas. Station dots colour by alert state; click a dot to trigger a radar ripple, populate the Stations Table, and load the trend chart below.',
      },
      {
        id: 'welcome-tour-launcher',
        target: '[data-tour-id="tour-launcher"]',
        side: 'bottom',
        title: 'Take the full tour any time',
        body:
          'Click this sparkles button again to launch the Dashboard tour, the Monitoring tour, or the Data Workflow walkthrough. We won\'t auto-run this welcome again — it\'s all opt-in from here.',
      },
    ],
  },

  // -----------------------------------------------------------------
  // Dashboard tour — every step now actually opens the panel it's
  // describing via onEnter, so the operator sees the live UI as
  // they read the tooltip.
  // -----------------------------------------------------------------
  {
    id: 'dashboard',
    name: 'Dashboard tour',
    description: 'Every panel, control, and workflow on the main dashboard — panels open automatically as you step through.',
    steps: [
      {
        id: 'dash-sensor-types',
        target: '[data-tour-id="sensor-types-badge"]',
        side: 'bottom',
        title: 'Sensor type breakdown',
        body:
          'Colour-coded chips by sensor family (ARG, WP, WL-R, DG, WL-L, AWS, AWS-H). Each chip\'s tooltip expands the abbreviation and shows the current station count.',
      },
      {
        id: 'dash-station-status',
        target: '[data-tour-id="station-status-badge"]',
        side: 'bottom',
        title: 'PMD GLOF 2 Live badge',
        body:
          'The upstream network status. The pulsing dot goes emerald on a successful fetch and amber when we\'re serving cached data. Click the refresh icon to force a fresh pull.',
      },
      {
        id: 'dash-theme',
        target: '[data-tour-id="theme-toggle"]',
        side: 'bottom',
        title: 'Day / night theme',
        body:
          'Toggle between the light and dark palettes. The titlebar stays emerald in both; every other surface flips.',
      },
      {
        id: 'dash-docs',
        target: '[data-tour-id="docs-link"]',
        side: 'bottom',
        title: 'Documentation',
        body:
          'The full operator\'s manual — every panel documented in detail, plus how-to workflows and API reference.',
      },
      {
        id: 'dash-primary',
        target: '[data-tour-id="primary-panel-icon"]',
        side: 'right',
        title: 'Primary panels',
        body:
          'One click fans out to both the Parameters panel (searchable Datascape v3 catalog) and the Layers panel (region-by-region GIS accordion). We\'ll leave them open so you can see them for the next few steps.',
        onEnter: () => ensurePanelOpen('primary-panel-icon'),
      },
      {
        id: 'dash-secondary',
        target: '[data-tour-id="secondary-panel-icon"]',
        side: 'right',
        title: 'Secondary layers',
        body:
          'Country-wide reference layers plus any GeoJSON / shapefile you upload. Each row has eye, style, table, and zoom controls.',
        onEnter: () => ensurePanelOpen('secondary-panel-icon'),
      },
      {
        id: 'dash-monitoring',
        target: '[data-tour-id="monitoring-panel-icon"]',
        side: 'right',
        title: 'Monitoring surface',
        body:
          'The parallel comparison view — a grid of synced map cells, each with its own parameter, plus a live chart panel and one-click PDF export. There\'s a dedicated tour for this one — pick it from the launcher.',
        // Deliberately DON\'T auto-open here: the Monitoring surface
        // replaces the whole middle column, and opening it while the
        // user is still touring the main dashboard would hide every
        // subsequent step's target. The Monitoring tour opens it.
      },
      {
        id: 'dash-csv',
        target: '[data-tour-id="csv-panel-icon"]',
        side: 'right',
        title: 'CSV data',
        body:
          'Drop a .csv in, pick an X and Y column, add optional filters, and plot it in the CSV Trend tab of the charts row.',
        onEnter: () => ensurePanelOpen('csv-panel-icon'),
      },
      {
        id: 'dash-raster',
        target: '[data-tour-id="raster-panel-icon"]',
        side: 'right',
        title: 'Raster layers',
        body:
          'Add single-band GeoTIFFs, render them as continuous colormaps or classified swatches, and inspect pixel values through the Feature Details tab.',
        onEnter: () => ensurePanelOpen('raster-panel-icon'),
      },
      {
        id: 'dash-map',
        target: '[data-tour-id="map-panel"]',
        side: 'left',
        title: 'The map canvas',
        body:
          'Alarm-classified stations pulse continuously; clicking any dot pins it with an amber selection ripple, populates the stations table, and loads the trend chart. Let\'s reopen the primary panels for the next steps.',
        onEnter: () => ensurePanelOpen('primary-panel-icon'),
      },
      {
        id: 'dash-map-legend',
        target: '[data-tour-id="map-legend"]',
        side: 'top',
        title: 'Legend',
        body:
          'Colour bins for the active parameter. Click a bin to mute those stations on the map — a fast way to isolate just one severity.',
      },
      {
        id: 'dash-stations-table',
        target: '[data-tour-id="stations-table"]',
        side: 'top',
        title: 'Stations table',
        body:
          'Sortable by station, alert state, value, or last-updated. Click a row to fly the map to that station.',
      },
      {
        id: 'dash-charts',
        target: '[data-tour-id="charts-row"]',
        side: 'top',
        title: 'Charts row',
        body:
          'Five tabs sharing one card: Attributes Table, PMD Data Trend, CSV Trend, Feature Details, Lakes Area. There\'s a dedicated Data Workflow tour that walks through picking a parameter and seeing the chart update — try it from the launcher.',
      },
      {
        id: 'dash-right-sidebar',
        target: '[data-tour-id="right-sidebar"]',
        side: 'left',
        title: 'Right sidebar',
        body:
          'Videos of past incidents and an alerts inbox. Icons behave like the left sidebar — click to open the panel.',
      },
      {
        id: 'dash-done',
        target: null,
        side: 'center',
        title: 'That\'s the dashboard',
        body:
          'Ready for more? Launch the Monitoring tour to see the multi-cell comparison surface, or the Data Workflow tour to walk through picking a parameter and inspecting a station end to end.',
      },
    ],
  },

  // -----------------------------------------------------------------
  // Monitoring tour — opens the surface for the operator and walks
  // through the whole comparison view.
  // -----------------------------------------------------------------
  {
    id: 'monitoring',
    name: 'Monitoring tour',
    description: 'The multi-cell comparison surface — opens the panel and walks through grid, districts, classification, charts, and PDF export.',
    steps: [
      {
        id: 'mon-open',
        target: '[data-tour-id="monitoring-panel-icon"]',
        side: 'right',
        title: 'Opening Monitoring',
        body:
          'We\'ll open the Monitoring surface for you now. The main dashboard\'s middle column swaps out for a grid of map cells and a live chart panel.',
        onEnter: () => ensurePanelOpen('monitoring-panel-icon'),
      },
      {
        id: 'mon-grid',
        target: '[data-tour-id="monitoring-grid"]',
        side: 'left',
        title: 'The map grid',
        body:
          'Two to four Mapbox cells, all synced. Pan or zoom any one of them and every other cell rehomes to match.',
      },
      {
        id: 'mon-layout',
        target: '[data-tour-id="monitoring-layout-picker"]',
        side: 'right',
        title: 'Layout picker',
        body:
          '2 × 2, 1 | 2, or 2 + 1 — three preset grid layouts. Cells keep their parameters when you switch layouts (A stays A).',
      },
      {
        id: 'mon-cell-params',
        target: '[data-tour-id="monitoring-cell-params"]',
        side: 'right',
        title: 'Cell parameters',
        body:
          'Assign one parameter per cell. The map for that cell fetches the parameter\'s stations and auto-fits to their extent.',
      },
      {
        id: 'mon-districts',
        target: '[data-tour-id="monitoring-districts"]',
        side: 'right',
        title: 'Districts overlay',
        body:
          'Every cell renders district polygons underneath. Pick a colour preset, drag the outline / opacity sliders, toggle red-on-yellow labels.',
      },
      {
        id: 'mon-classification',
        target: '[data-tour-id="monitoring-classification"]',
        side: 'right',
        title: 'PMD vs NDMA',
        body:
          'Flip between PMD\'s official alert bands and NDMA\'s tightened early-warning bands (thresholds cut 10 %). Every cell reclassifies instantly.',
      },
      {
        id: 'mon-charts',
        target: '[data-tour-id="monitoring-charts-panel"]',
        side: 'left',
        title: 'Charts panel',
        body:
          'Always visible while Monitoring is active. One row per cell, sharing a single time window (Daily / Weekly / Custom).',
      },
      {
        id: 'mon-report',
        target: '[data-tour-id="monitoring-report-btn"]',
        side: 'right',
        title: 'PDF report',
        body:
          'Exports the current grid as a multi-page PDF: cover page, per-cell map snapshot, high-res trend chart, sampled readings table with min/max highlights, station attributes, and district context.',
      },
      {
        id: 'mon-done',
        target: null,
        side: 'center',
        title: 'You\'re set',
        body:
          'Everything on the Monitoring surface persists via localStorage — your parameter picks, pinned stations, map pose, and classification method all come back after a reload.',
      },
    ],
  },

  // -----------------------------------------------------------------
  // Data workflow — walks the operator through the full pick →
  // click → chart → inspect journey, opening panels and switching
  // tabs on their behalf so they see the actual data flow instead
  // of a description of it.
  // -----------------------------------------------------------------
  {
    id: 'workflow',
    name: 'Data workflow tour',
    description: 'Follow a full workflow end to end — pick a parameter, click a station, read the chart, inspect the feature. Panels open and tabs switch automatically.',
    steps: [
      {
        id: 'wf-intro',
        target: null,
        side: 'center',
        title: 'Let\'s follow live data end to end',
        body:
          'We\'ll open the Parameters panel, pick an element if you don\'t have one, look at the map response, then step through the trend chart and feature-details tabs. Nothing you\'ve already configured will be overwritten.',
      },
      {
        id: 'wf-open-params',
        target: '[data-tour-id="primary-panel-icon"]',
        side: 'right',
        title: 'Open Parameters',
        body:
          'The Primary icon opens both the Parameters panel and the Layers panel. We\'ll focus on Parameters for the next few steps.',
        onEnter: () => ensurePanelOpen('primary-panel-icon'),
      },
      {
        id: 'wf-parameters-list',
        target: '[data-tour-id="parameters-list"]',
        side: 'right',
        title: 'The element catalog',
        body:
          '40+ elements from the Datascape v3 API. Each row shows the element name and how many stations currently report it. Filter with the search box above. If none is selected yet, we\'ll pick the first row for you on the next step.',
      },
      {
        id: 'wf-pick-parameter',
        target: '[data-tour-id="parameters-list"]',
        side: 'right',
        title: 'Picking a parameter',
        body:
          'You\'ll see the row turn to its accent colour when active. On the map, every station dot is now coloured by that element\'s alert state — normal / warning / pre-alarm / alarm / error / no-data.',
        onEnter: () => ensureFirstParameterPicked(),
      },
      {
        id: 'wf-map',
        target: '[data-tour-id="map-panel"]',
        side: 'left',
        title: 'Watch the map recolour',
        body:
          'Every station that reports this element shows up as a coloured dot. Alarm stations pulse continuously (red radar ring); everything else stays static so critical stations pop.',
      },
      {
        id: 'wf-legend',
        target: '[data-tour-id="map-legend"]',
        side: 'top',
        title: 'The legend',
        body:
          'The colour bins for the active element. Click any bin to mute those dots — a fast way to isolate just the Alarm stations, for example.',
      },
      {
        id: 'wf-stations-table',
        target: '[data-tour-id="stations-table"]',
        side: 'top',
        title: 'Stations table',
        body:
          'Every station reporting this element, sortable by state or value. Clicking a row is equivalent to clicking the station\'s dot on the map — it flies the view and loads the trend chart.',
      },
      {
        id: 'wf-charts',
        target: '[data-tour-id="charts-row"]',
        side: 'top',
        title: 'Charts row',
        body:
          'Below the map. The next two steps switch tabs for you so you can see what each one does.',
      },
      {
        id: 'wf-pmd-tab',
        target: '[data-tour-id="chart-tab-pmd"]',
        side: 'top',
        title: 'PMD Data Trend',
        body:
          'Time-series for the currently-selected station. Daily (24 h), Weekly (7 d), or Custom (1–365 d). The line + fill use a vertical gradient mapped onto the legend bins, so the curve literally crosses through the same colours the dots use. Day markers annotate midnight boundaries; extreme markers pin min and max points.',
        onEnter: () => ensureTab('pmd'),
      },
      {
        id: 'wf-feature-tab',
        target: '[data-tour-id="chart-tab-feature"]',
        side: 'top',
        title: 'Feature Details',
        body:
          'The most-recently-clicked feature — station, polygon, or raster pixel — rendered as a card layout with per-field icons, unit-suffixed values, threshold bands, and image catalogs. Click any layer feature on the map, then flip to this tab to inspect it.',
        onEnter: () => ensureTab('feature'),
      },
      {
        id: 'wf-click-station',
        target: '[data-tour-id="map-panel"]',
        side: 'left',
        title: 'Try it: click a station dot',
        body:
          'Pause the tour with Escape (or Skip below) and click any dot on the map. The station gets an amber selection ripple, the Stations Table jumps to its row, and the PMD Data Trend tab loads its history.',
      },
      {
        id: 'wf-done',
        target: null,
        side: 'center',
        title: 'That\'s the full loop',
        body:
          'Pick a parameter → map recolours → click a station → chart loads → switch tabs for details. Every panel and tab you saw remembers its state via localStorage, so refresh anytime.',
      },
    ],
  },
];
