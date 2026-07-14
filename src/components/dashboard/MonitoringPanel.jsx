import { AlertCircle, FileDown, Maximize2, Mountain, RotateCcw, Type } from 'lucide-react';
import { motion } from 'framer-motion';
import { BASEMAPS } from '@/config/mapbox';
import { LEGEND_STATES } from '@/config/alertStates';
import {
  DISTRICT_COLOR_PRESETS,
  MONITORING_LAYOUTS,
  layoutById,
  useMonitoring,
} from '@/contexts/MonitoringContext';
import { useParameter } from '@/contexts/ParameterContext';
import { colorFor } from '@/config/parameterColors';
import ParameterSelect from '@/components/ui/ParameterSelect';
import { cn } from '@/utils/cn';

// Config panel for the Monitoring feature. Shown in the LeftSidebar
// when the Monitoring icon is toggled on. Owns:
//   • grid layout picker (four presets, icon-only)
//   • basemap selector (applies to every cell at once)
//   • 3D terrain toggle (applies to every cell at once)
//   • per-cell parameter assignment
//   • fullscreen + reset view actions
//   • Phase-2 placeholders (Alert operator / Export report)
//
// The Alert + Report buttons render fully styled but their click
// handlers are stubs until backend endpoints land; the UX reviews as
// complete while the data path is under construction.
export default function MonitoringPanel() {
  const {
    layoutId,
    setLayoutId,
    cellParameters,
    setCellParameter,
    fullscreen,
    setFullscreen,
    basemap,
    setBasemap,
    terrain,
    setTerrain,
    districtsColorId,
    setDistrictsColorId,
    districtsOpacity,
    setDistrictsOpacity,
    districtsOutlineWidth,
    setDistrictsOutlineWidth,
    districtsLabels,
    setDistrictsLabels,
    earlyWarning,
    setEarlyWarning,
    resetView,
  } = useMonitoring();
  const { elements } = useParameter();

  const layout = layoutById(layoutId);

  return (
    <div className="flex flex-col gap-2">
      {/* Layout picker — icon-only preset thumbnails. Colour flips to
          the lime accent on the active option; hover surfaces the
          layout label via `title`. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
            Grid Layout
          </label>
          <span className="text-[9.5px] text-day-muted dark:text-night-muted">
            {layout.cells} view{layout.cells === 1 ? '' : 's'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONITORING_LAYOUTS.map((l) => {
            const active = l.id === layoutId;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLayoutId(l.id)}
                aria-pressed={active}
                aria-label={l.label}
                title={`${l.label} (${l.cells} view${l.cells === 1 ? '' : 's'})`}
                className={cn(
                  'inline-flex items-center justify-center rounded-md border p-1.5 transition-colors',
                  active
                    ? 'border-[#84cc16] bg-[#84cc16]/12'
                    : 'border-day-border dark:border-night-border hover:bg-day-bg dark:hover:bg-night-bg',
                )}
              >
                <LayoutIcon
                  id={l.id}
                  color={active ? '#84cc16' : undefined}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-cell parameter assignment */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
          Cell Parameters
        </label>
        <div className="flex flex-col gap-1">
          {layout.areas.map((area, idx) => {
            const value = cellParameters[area] ?? '';
            const color = value ? colorFor(value) : '#94a3b8';
            return (
              <div
                key={area}
                className="flex items-center gap-1.5"
              >
                <span
                  className="inline-flex items-center justify-center h-6 w-6 shrink-0 rounded-md text-[10px] font-bold uppercase text-white shadow-sm"
                  style={{ backgroundColor: color }}
                  title={`Cell ${idx + 1}`}
                >
                  {area.toUpperCase()}
                </span>
                <ParameterSelect
                  value={value}
                  onChange={(name) => setCellParameter(area, name)}
                  elements={elements}
                  size="sm"
                  className="flex-1"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Basemap selector — pills for the five styles configured in
          @/config/mapbox. Active pill uses the lime accent so it lines
          up with the layout picker. Basemap opacity is pinned at the
          map layer (see BASEMAP_OPACITY) so overlays always read
          clearly — no operator slider. */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
          Basemap
        </label>
        <div className="grid grid-cols-5 gap-1">
          {Object.keys(BASEMAPS).map((key) => {
            const active = key === basemap;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setBasemap(key)}
                aria-pressed={active}
                title={key.charAt(0).toUpperCase() + key.slice(1)}
                className={cn(
                  'h-6 inline-flex items-center justify-center rounded-md border text-[10px] font-medium capitalize transition-colors',
                  active
                    ? 'border-[#84cc16] bg-[#84cc16] text-[#1a2e05]'
                    : 'border-day-border dark:border-night-border text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
                )}
              >
                {key}
              </button>
            );
          })}
        </div>
      </div>

      {/* Districts overlay — colour preset (out-of-theme grays / earth
          tones so the boundary layer never competes with the station
          palette), outline width slider, opacity slider, and a labels
          toggle. Labels themselves are a fixed red-on-yellow-halo
          style — the toggle just flips visibility. */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
          Districts
        </label>

        {/* Colour preset swatches — click to activate. The row now
            leads with a "Style" label to match the Outline / Opacity
            rows below; swatches shrink to h-5 w-5 so all five fit
            alongside the label without wrapping. */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-day-muted dark:text-night-muted shrink-0 w-12">
            Style
          </span>
          <div className="flex-1 grid grid-cols-5 gap-1">
            {DISTRICT_COLOR_PRESETS.map((preset) => {
              const active = preset.id === districtsColorId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setDistrictsColorId(preset.id)}
                  aria-pressed={active}
                  title={preset.label}
                  className={cn(
                    'h-5 rounded border transition-all inline-flex items-center justify-center',
                    active
                      ? 'border-[#84cc16] ring-1 ring-[#84cc16]/50'
                      : 'border-day-border dark:border-night-border hover:border-day-muted dark:hover:border-night-muted',
                  )}
                  style={{ backgroundColor: preset.fill }}
                >
                  <span
                    aria-hidden
                    className="block h-2 w-2 rounded-[2px]"
                    style={{
                      border: `1.5px solid ${preset.line}`,
                      backgroundColor: preset.fill,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Outline width slider — controls line-width on the districts
            border layer. Range 0.5–3.5 px covers "barely visible" to
            "prominent" without letting the operator go pathological.
            Slider thinned to `h-1` so it stops competing with the
            swatches / segmented pills for visual weight. */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-day-muted dark:text-night-muted shrink-0 w-12">
            Outline
          </span>
          <input
            type="range"
            min="0.5"
            max="3.5"
            step="0.25"
            value={districtsOutlineWidth}
            onChange={(e) => setDistrictsOutlineWidth(Number(e.target.value))}
            aria-label="Districts outline width"
            className="flex-1 accent-[#84cc16] h-1 cursor-pointer"
          />
          <span className="text-[10px] tabular-nums text-day-text dark:text-night-text w-8 text-right">
            {districtsOutlineWidth.toFixed(2)}
          </span>
        </div>

        {/* Opacity slider — drives line-opacity directly and fill
            opacity at a fraction (see DISTRICTS_FILL_OPACITY_RATIO in
            MonitoringMap) so the interior stays subtle. */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-day-muted dark:text-night-muted shrink-0 w-12">
            Opacity
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(districtsOpacity * 100)}
            onChange={(e) => setDistrictsOpacity(Number(e.target.value) / 100)}
            aria-label="Districts opacity"
            className="flex-1 accent-[#84cc16] h-1 cursor-pointer"
          />
          <span className="text-[10px] tabular-nums text-day-text dark:text-night-text w-8 text-right">
            {Math.round(districtsOpacity * 100)}%
          </span>
        </div>

        {/* Labels toggle — segmented Off/On matching the 3D-terrain
            and Classification rows for visual coherence. Labels use a
            fixed red text + yellow halo, so this is a pure show/hide. */}
        <SegmentedRow
          icon={<Type className="h-3 w-3" />}
          label="Labels"
          options={[
            { id: false, label: 'Off' },
            { id: true,  label: 'On'  },
          ]}
          value={districtsLabels}
          onChange={setDistrictsLabels}
        />
      </div>

      {/* Classification source — flips every cell between PMD's own
          alert bands and NDMA's tightened (early-warning) bands. Kept
          independent of the main dashboard's toggle so the operator
          can compare the two side-by-side. */}
      <SegmentedRow
        icon={<AlertCircle className="h-3 w-3" />}
        label="Classification"
        options={[
          { id: false, label: 'PMD',  title: 'Official PMD classification' },
          { id: true,  label: 'NDMA', title: 'NDMA early-warning (10% ahead of PMD)' },
        ]}
        value={earlyWarning}
        onChange={setEarlyWarning}
      />

      {/* 3D terrain — segmented On/Off pill so the state reads at a
          glance instead of hiding behind a subtle switch dot. */}
      <SegmentedRow
        icon={<Mountain className="h-3 w-3" />}
        label="3D Terrain"
        options={[
          { id: false, label: 'Off' },
          { id: true,  label: 'On'  },
        ]}
        value={terrain}
        onChange={setTerrain}
      />

      {/* Grid actions */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
          Actions
        </label>
        <div className="grid grid-cols-2 gap-1">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setFullscreen((v) => !v)}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-day-border dark:border-night-border px-1.5 py-1 text-[10.5px] font-medium text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg"
          >
            <Maximize2 className="h-3 w-3" />
            {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={resetView}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-day-border dark:border-night-border px-1.5 py-1 text-[10.5px] font-medium text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg"
          >
            <RotateCcw className="h-3 w-3" />
            Reset View
          </motion.button>
        </div>
        {/* Phase-2 actions — buttons visible so the UX is testable, but
            the wiring lives on the roadmap. */}
        <div className="grid grid-cols-2 gap-1">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              // TODO: wire to /api/alerts/generate — pop a confirmation
              // modal listing the breached stations before firing.
              console.log('[monitoring] Generate Alert clicked (Phase 2)');
            }}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-red-600/90 px-1.5 py-1 text-[10.5px] font-semibold text-white hover:bg-red-600"
          >
            <AlertCircle className="h-3 w-3" />
            Alert
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              // TODO: wire to /api/reports/monitoring — accepts current
              // cell parameters + selected station and returns PDF.
              console.log('[monitoring] Export Report clicked (Phase 2)');
            }}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-[#84cc16] px-1.5 py-1 text-[10.5px] font-semibold text-[#1a2e05] hover:bg-[#65a30d]"
          >
            <FileDown className="h-3 w-3" />
            Report
          </motion.button>
        </div>
      </div>

      {/* Classification legend — mirrors the LEGEND_STATES palette used
          across the app so the operator can decode the dot colours in
          each cell without leaving the panel. Warning Post is a static
          symbology note (WP_* stations render as concentric rings on
          the main map) — kept here for parity with the map legend. */}
      <div className="flex flex-col gap-1 pt-1 border-t border-day-border dark:border-night-border">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted mt-1">
          Legend
        </label>
        <ul className="flex flex-col gap-0 px-0.5">
          {LEGEND_STATES.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-1.5 py-0.5 text-[10.5px] text-day-text dark:text-night-text"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full border border-slate-900/40 dark:border-white/30"
                style={{ backgroundColor: s.color }}
              />
              <span className="leading-none">{s.label}</span>
            </li>
          ))}
          <li className="flex items-center gap-1.5 py-0.5 text-[10.5px] text-day-text dark:text-night-text mt-0.5 pt-1 border-t border-day-border dark:border-night-border">
            <WarningPostGlyph />
            <span className="leading-none">Warning Post</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// A row with a leading icon + label and a segmented pill on the right.
// Used for the classification (PMD/NDMA) and 3D-terrain toggles — same
// visual shape so the config panel reads as a coherent set.
function SegmentedRow({ icon, label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-day-border dark:border-night-border px-1.5 py-1">
      <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-day-text dark:text-night-text">
        <span className="text-day-muted dark:text-night-muted">{icon}</span>
        {label}
      </span>
      <div className="ml-auto flex rounded bg-day-bg dark:bg-night-bg p-0.5">
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={String(opt.id)}
              type="button"
              onClick={() => onChange(opt.id)}
              aria-pressed={active}
              title={opt.title ?? opt.label}
              className={cn(
                'h-5 min-w-[34px] px-1.5 inline-flex items-center justify-center rounded-[4px] text-[9.5px] font-semibold uppercase tracking-wide transition-colors',
                active
                  ? 'bg-[#84cc16] text-[#1a2e05] shadow-sm'
                  : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Miniature Warning-Post glyph — three concentric black rings around a
// dot, matching the WP_* marker style on the main map's legend so the
// two surfaces agree on how the symbol reads.
function WarningPostGlyph() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 14 14"
      className="shrink-0"
    >
      <circle cx="7" cy="7" r="6"   fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.85" />
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.85" />
      <circle cx="7" cy="7" r="3"   fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.85" />
      <circle cx="7" cy="7" r="1.4" fill="currentColor" />
    </svg>
  );
}

// Icon renderer per layout id — one small SVG per grid preset. Uses
// `currentColor` via a CSS variable (`--c`) so the same shape reads
// on light + dark themes and picks up the lime accent when active.
// When `color` is omitted, defaults to a theme-aware muted tone via
// the `text-day-muted / dark:text-night-muted` class + `currentColor`.
function LayoutIcon({ id, color }) {
  const style = color ? { color } : undefined;
  const cls = cn(
    'shrink-0',
    !color && 'text-day-muted dark:text-night-muted',
  );
  const fill = 'currentColor';
  const common = {
    viewBox: '0 0 100 100',
    xmlns: 'http://www.w3.org/2000/svg',
    width: 26,
    height: 26,
    className: cls,
    style,
    'aria-hidden': true,
  };
  if (id === '2x2') {
    return (
      <svg {...common}>
        <rect x="0"  y="0"  width="47" height="47" rx="8" fill={fill} />
        <rect x="53" y="0"  width="47" height="47" rx="8" fill={fill} />
        <rect x="0"  y="53" width="47" height="47" rx="8" fill={fill} />
        <rect x="53" y="53" width="47" height="47" rx="8" fill={fill} />
      </svg>
    );
  }
  if (id === '1|2') {
    return (
      <svg {...common}>
        <rect x="0"  y="0"  width="47" height="100" rx="8" fill={fill} />
        <rect x="53" y="0"  width="47" height="47"  rx="8" fill={fill} />
        <rect x="53" y="53" width="47" height="47"  rx="8" fill={fill} />
      </svg>
    );
  }
  if (id === '2+1') {
    return (
      <svg {...common}>
        <rect x="0"  y="0"  width="100" height="47" rx="8" fill={fill} />
        <rect x="0"  y="53" width="47"  height="47" rx="8" fill={fill} />
        <rect x="53" y="53" width="47"  height="47" rx="8" fill={fill} />
      </svg>
    );
  }
  return null;
}
