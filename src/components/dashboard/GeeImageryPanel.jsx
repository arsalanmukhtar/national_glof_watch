import { useState } from 'react';
import {
  CloudDownload,
  Eraser,
  Hexagon,
  Image as ImageIcon,
  Layers as LayersIcon,
  Pencil,
  Square,
  Telescope,
} from 'lucide-react';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// GEE Imagery panel — frontend skeleton.
//
// Lets the user authenticate against a Google Earth Engine project,
// draw a clip geometry on the map, pick imagery (single date or a
// temporal stack), and choose a band combination (true color, false
// color NDVI, etc.). All actions are stubbed — the panel sets local
// state and surfaces affordances; backend wiring (GEE auth, tile
// fetching, draw-tool integration with Mapbox) follows.
// ---------------------------------------------------------------------------

const BAND_PRESETS = [
  { id: 'true-color',  label: 'True color',     hint: 'B4, B3, B2 — natural visible' },
  { id: 'false-color', label: 'False color',    hint: 'B8, B4, B3 — vegetation health (NIR)' },
  { id: 'agriculture', label: 'Agriculture',    hint: 'B11, B8, B2 — crop / soil' },
  { id: 'urban',       label: 'Urban / built',  hint: 'B12, B11, B4 — built-up surfaces' },
  { id: 'ndvi',        label: 'NDVI',           hint: 'Vegetation index' },
  { id: 'ndwi',        label: 'NDWI',           hint: 'Water index' },
];

export default function GeeImageryPanel() {
  // All state is local for now. TODO(wire-data): lift into a GEE
  // context/provider once auth + tile fetching land.
  const [projectId, setProjectId] = useState('');
  const [drawTool, setDrawTool] = useState(null); // 'rectangle' | 'polygon' | 'erase' | null
  const [hasGeometry, setHasGeometry] = useState(false);
  const [mode, setMode] = useState('single'); // 'single' | 'temporal'
  const [singleDate, setSingleDate] = useState('');
  const [range, setRange] = useState({ start: '', end: '' });
  const [bands, setBands] = useState('true-color');
  const [cloudPct, setCloudPct] = useState(20);

  return (
    <div className="flex flex-col gap-3">
      {/* GEE project */}
      <Section title="GEE project">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
            Project ID
          </span>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="your-gcp-project-id"
            className={cn(
              'w-full px-2 py-1.5 rounded-md text-[12px]',
              'bg-day-bg dark:bg-night-bg',
              'border border-day-border dark:border-night-border',
              'text-day-text dark:text-night-text placeholder:text-day-muted dark:placeholder:text-night-muted',
              'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
            )}
          />
        </label>
        <button
          type="button"
          disabled={!projectId.trim()}
          className={cn(
            'btn-base btn-sm w-full mt-1.5',
            'bg-[#16a085] text-white hover:bg-[#138b72]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <CloudDownload className="h-3.5 w-3.5" />
          <span>Connect</span>
        </button>
        <p className="text-[11px] text-day-muted dark:text-night-muted">
          Wiring TODO — earthengine-api auth lives here.
        </p>
      </Section>

      {/* Draw tools */}
      <Section title="Clip geometry" titleIcon={Hexagon}>
        <div className="grid grid-cols-3 gap-1">
          <DrawToolButton
            id="rectangle"
            label="Rectangle"
            Icon={Square}
            active={drawTool === 'rectangle'}
            onClick={() =>
              setDrawTool((cur) => (cur === 'rectangle' ? null : 'rectangle'))
            }
          />
          <DrawToolButton
            id="polygon"
            label="Polygon"
            Icon={Pencil}
            active={drawTool === 'polygon'}
            onClick={() =>
              setDrawTool((cur) => (cur === 'polygon' ? null : 'polygon'))
            }
          />
          <DrawToolButton
            id="erase"
            label="Delete"
            Icon={Eraser}
            active={drawTool === 'erase'}
            danger
            onClick={() => {
              setDrawTool('erase');
              setHasGeometry(false);
            }}
          />
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px]',
            hasGeometry
              ? 'border-[#16a085]/40 bg-[#16a085]/10 text-[#16a085]'
              : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted',
          )}
        >
          <Hexagon className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {hasGeometry
              ? 'Clip geometry set on map'
              : 'No geometry — draw one to clip the imagery'}
          </span>
          {/* TODO(wire-data): replace with a stub that toggles when the
              draw tool emits a complete shape. The dev button below is
              just so the rest of the panel can be exercised before
              draw-tool wiring lands. */}
          <button
            type="button"
            onClick={() => setHasGeometry((v) => !v)}
            className="ml-auto text-[10.5px] uppercase tracking-wider opacity-70 hover:opacity-100"
          >
            {hasGeometry ? 'Clear' : 'Stub fill'}
          </button>
        </div>
      </Section>

      {/* Imagery mode */}
      <Section title="Imagery" titleIcon={ImageIcon}>
        <div
          role="radiogroup"
          aria-label="Imagery mode"
          className="grid grid-cols-2 gap-1"
        >
          <ModeButton
            label="Single date"
            hint="Pick one cloud-free image"
            active={mode === 'single'}
            onClick={() => setMode('single')}
          />
          <ModeButton
            label="Temporal stack"
            hint="Animate across a date range"
            active={mode === 'temporal'}
            onClick={() => setMode('temporal')}
          />
        </div>

        {mode === 'single' ? (
          <label className="flex flex-col gap-1 mt-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
              Acquisition date
            </span>
            <input
              type="date"
              value={singleDate}
              onChange={(e) => setSingleDate(e.target.value)}
              className={cn(
                'w-full px-2 py-1.5 rounded-md text-[12px]',
                'bg-day-bg dark:bg-night-bg',
                'border border-day-border dark:border-night-border',
                'text-day-text dark:text-night-text',
                'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
              )}
            />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
                Start
              </span>
              <input
                type="date"
                value={range.start}
                onChange={(e) =>
                  setRange((r) => ({ ...r, start: e.target.value }))
                }
                className="w-full px-2 py-1.5 rounded-md text-[12px] bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border text-day-text dark:text-night-text focus:outline-none focus:ring-2 focus:ring-[#16a085]/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
                End
              </span>
              <input
                type="date"
                value={range.end}
                onChange={(e) =>
                  setRange((r) => ({ ...r, end: e.target.value }))
                }
                className="w-full px-2 py-1.5 rounded-md text-[12px] bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border text-day-text dark:text-night-text focus:outline-none focus:ring-2 focus:ring-[#16a085]/40"
              />
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
              Max cloud cover
            </span>
            <span className="text-[11px] tabular-nums text-day-text dark:text-night-text">
              {cloudPct}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={cloudPct}
            onChange={(e) => setCloudPct(Number(e.target.value))}
            className="w-full h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#16a085] cursor-pointer"
          />
        </label>
      </Section>

      {/* Bands */}
      <Section title="Bands" titleIcon={LayersIcon}>
        <div className="flex flex-col gap-1">
          {BAND_PRESETS.map(({ id, label, hint }) => {
            const on = bands === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBands(id)}
                aria-pressed={on}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors',
                  on
                    ? 'bg-[#16a085]/10 border-[#16a085]/50 text-[#16a085]'
                    : 'border-day-border dark:border-night-border text-day-text dark:text-night-text hover:border-day-text/40 dark:hover:border-night-text/40',
                )}
              >
                <span className="text-[12px] font-semibold leading-tight">
                  {label}
                </span>
                <span className="text-[10.5px] leading-tight opacity-80">
                  {hint}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Fetch */}
      <button
        type="button"
        disabled={!hasGeometry || (mode === 'single' ? !singleDate : !(range.start && range.end))}
        className={cn(
          'btn-base btn-md w-full',
          'bg-[#16a085] text-white hover:bg-[#138b72]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Telescope className="h-4 w-4" />
        <span>Fetch tiles</span>
      </button>
      <p className="text-[11px] text-day-muted dark:text-night-muted text-center -mt-1">
        Wiring TODO — GEE tile request + map overlay attach.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DrawToolButton({ label, Icon, active, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-2 transition-colors',
        active
          ? danger
            ? 'bg-red-500/10 border-red-500/40 text-red-500 dark:text-red-400'
            : 'bg-[#16a085]/10 border-[#16a085]/40 text-[#16a085]'
          : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:border-day-text/40 dark:hover:border-night-text/40',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  );
}

function ModeButton({ label, hint, active, onClick }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-md border px-2 py-2 text-left transition-colors',
        active
          ? 'bg-[#16a085]/10 border-[#16a085]/50 text-[#16a085]'
          : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:border-day-text/40 dark:hover:border-night-text/40',
      )}
    >
      <span className="text-[12px] font-semibold leading-tight">{label}</span>
      <span className="text-[10.5px] leading-tight opacity-80">{hint}</span>
    </button>
  );
}

function Section({ title, titleIcon: TitleIcon, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {TitleIcon ? (
          <TitleIcon className="h-3 w-3 text-brand-700 dark:text-brand-200" />
        ) : null}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          {title}
        </span>
        <span className="flex-1 h-px bg-day-border/60 dark:bg-night-border/60" />
      </div>
      {children}
    </div>
  );
}
