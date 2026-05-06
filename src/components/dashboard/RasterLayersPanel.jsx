import { Grid3x3, Hourglass } from 'lucide-react';

// ---------------------------------------------------------------------------
// Raster Layers panel — placeholder skeleton.
// User-facing slot for temporal raster overlays. Real wiring (catalog,
// time slider, basemap composition with the Palette panel) is deferred
// per the user's "add the button only" instruction.
// ---------------------------------------------------------------------------

export default function RasterLayersPanel() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
      <div className="relative">
        <Grid3x3 className="h-9 w-9 text-day-muted/60 dark:text-night-muted/60" />
        <Hourglass className="absolute -bottom-1 -right-1 h-3.5 w-3.5 text-[#16a085]" />
      </div>
      <div className="text-[12px] font-semibold text-day-text dark:text-night-text">
        Raster Layers
      </div>
      <div className="text-[11px] text-day-muted dark:text-night-muted leading-snug max-w-[240px]">
        Temporal raster catalog with an in-map time slider lands here.
        Styling will be driven by the same right-sidebar Palette panel
        used for vector layers.
      </div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mt-1">
        Awaiting data spec
      </div>
    </div>
  );
}
