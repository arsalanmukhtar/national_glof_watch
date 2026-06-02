// ---------------------------------------------------------------------------
// Geo-analysis PDF report generator.
//
// Page 1 layout (A4 portrait, 595.28 x 841.89 pt):
//
//   ┌─────────── Branded emerald header ─────────────┐   y =   0
//   │  National GLOF Monitoring          Geospatial  │
//   │  Geospatial Analysis Report      Analysis      │
//   ├─ lime accent stripe ───────────────────────────┤   y =  70
//   │                                                │
//   │  Zonal Statistics            Generated …       │   title block
//   │  Raster <name>  &  Mask <label>    Compute …   │
//   ├────────────────────────────────────────────────┤
//   │  ┌── SUM ──┐  ┌── PIXELS ──┐  ┌── MEAN ──┐    │   headline cards
//   ├────────────────────────────────────────────────┤
//   │  LAYERS INVOLVED                               │
//   │  [ Role | Layer | Details ]                    │
//   ├────────────────────────────────────────────────┤
//   │  STATISTICS                AREA OF INTEREST    │
//   │  [ two-column stats grid ] [ map snapshot   ]  │
//   ├────────────────────────────────────────────────┤
//   │  NOTES …                                       │
//   └─ footer rule + page n/n ───────────────────────┘
//
// Why this shape: a single page tells the whole story when the map fits,
// which it usually does at A4 portrait. Stats become a compact 2-col grid
// so they don't dominate; the map sits beside them. Long titles or notes
// gracefully overflow to a second page that re-prints the header.
//
// ALL TEXT IS ASCII. jsPDF's built-in Helvetica is Latin-1 only — any
// Unicode glyph (Σ, →, ∩, ·, …) renders as garbage (£, !', ")) and also
// breaks PDF text extraction by switching to per-glyph positioning.
// If you reach for a Unicode char here, replace it with an ASCII form or
// embed a TTF font before using it.
// ---------------------------------------------------------------------------

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatIntegerWithCommas, formatStatNumber } from './geoAnalysis';
import { COLORMAPS } from './rasterRender';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const HEADER_BG = '#064e3b';       // emerald-900 — matches dashboard titlebar
const HEADER_BG_DARK = '#022c22';  // emerald-950
const ACCENT = '#84cc16';          // lime-500
const TEXT = '#0f172a';            // slate-900
const MUTED = '#475569';           // slate-600
const RULE = '#cbd5e1';            // slate-300
const CARD_BG = '#f8fafc';         // slate-50

function fmtDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// Hard-truncate with an ASCII ellipsis. The Unicode "…" (U+2026) renders
// fine in some PDF viewers but extracts as garbage in others and breaks
// per-glyph positioning, so use "..." literally.
function ellipsize(s, max = 80) {
  if (!s) return '';
  const str = String(s);
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

// Strip any non-Latin-1 chars from a string before handing it to jsPDF.
// Replaces the common offenders with ASCII equivalents and drops
// anything else that would render as garbage in Helvetica.
function ascii(s) {
  if (s == null) return '';
  return String(s)
    .replace(/→/g, 'to')   // →
    .replace(/←/g, 'from') // ←
    .replace(/↔/g, '-')    // ↔
    .replace(/∩/g, '&')    // ∩
    .replace(/∪/g, '|')    // ∪
    .replace(/Σ/g, 'Sum')  // Σ
    .replace(/μ/g, 'u')    // μ
    .replace(/·/g, '-')    // ·
    .replace(/•/g, '-')    // •
    .replace(/…/g, '...')  // …
    .replace(/[‐-―]/g, '-') // various dashes
    .replace(/[‘’]/g, "'")  // curly single quotes
    .replace(/[“”]/g, '"')  // curly double quotes
    .replace(/[^\x00-\xff]/g, '');    // strip anything still non-Latin-1
}

// ---------- header / footer ------------------------------------------------

function drawHeader(doc) {
  doc.setFillColor(HEADER_BG_DARK);
  doc.rect(0, 0, PAGE_W, 70, 'F');
  doc.setFillColor(HEADER_BG);
  doc.rect(0, 0, PAGE_W, 66, 'F');
  doc.setFillColor(ACCENT);
  doc.rect(0, 66, PAGE_W, 4, 'F');

  // Wordmark
  doc.setTextColor('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('National GLOF Monitoring', MARGIN_X, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor('#a7f3d0'); // emerald-200
  doc.text('Geospatial Analysis Report', MARGIN_X, 46);

  // Right-aligned report-type tag — short, fixed, never overflows.
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#a7f3d0');
  doc.text(
    'CONFIDENTIAL / INTERNAL USE',
    PAGE_W - MARGIN_X,
    46,
    { align: 'right' },
  );
}

function drawFooter(doc, pageNum, pageCount, generatedAt) {
  const y = PAGE_H - 28;
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y - 8, PAGE_W - MARGIN_X, y - 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(`Generated ${generatedAt}`, MARGIN_X, y);
  doc.text(
    `Page ${pageNum} of ${pageCount}`,
    PAGE_W - MARGIN_X,
    y,
    { align: 'right' },
  );
  doc.setTextColor(ACCENT);
  doc.setFont('helvetica', 'bold');
  doc.text('National GLOF Monitoring', PAGE_W / 2, y, { align: 'center' });
}

// ---------- title block ----------------------------------------------------

// Lives below the header strip. The per-report title sits IN the body so
// long raster + mask names wrap naturally instead of overflowing the
// right-aligned header slot.
function drawTitleBlock(doc, y, { operation, rasterLabel, maskLabel, generatedAt, elapsedMs }) {
  // H1 — operation name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(TEXT);
  doc.text(ascii(operation), MARGIN_X, y);

  // Meta column on the right
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(`Generated ${generatedAt}`, PAGE_W - MARGIN_X, y - 7, { align: 'right' });
  if (elapsedMs != null) {
    doc.text(
      `Compute time ${elapsedMs.toLocaleString()} ms`,
      PAGE_W - MARGIN_X,
      y + 6,
      { align: 'right' },
    );
  }

  y += 14;

  // Sub-line — "Raster <name>  &  Mask <label>", wraps if it overflows.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  const sub =
    `Raster: ${ellipsize(ascii(rasterLabel || '-'), 48)}` +
    `   &   ` +
    `Mask: ${ellipsize(ascii(maskLabel || '-'), 48)}`;
  const wrapped = doc.splitTextToSize(sub, PAGE_W - MARGIN_X * 2 - 160);
  doc.text(wrapped, MARGIN_X, y);
  y += wrapped.length * 12;
  return y + 6;
}

// ---------- headline cards -------------------------------------------------

function drawHeadlineCards(doc, y, cards) {
  const totalW = PAGE_W - MARGIN_X * 2;
  const gap = 10;
  const cardW = (totalW - gap * (cards.length - 1)) / cards.length;
  const cardH = 64;

  cards.forEach((c, i) => {
    const x = MARGIN_X + i * (cardW + gap);
    doc.setFillColor(CARD_BG);
    doc.roundedRect(x, y, cardW, cardH, 5, 5, 'F');
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, cardW, cardH, 5, 5, 'S');
    doc.setFillColor(ACCENT);
    doc.rect(x, y, 3, cardH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    doc.text(ascii(c.label).toUpperCase(), x + 12, y + 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(TEXT);
    doc.text(ascii(c.value), x + 12, y + 40);

    if (c.hint) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(MUTED);
      doc.text(ascii(c.hint), x + 12, y + 55);
    }
  });
  return y + cardH;
}

function drawSectionHeading(doc, y, label) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT);
  doc.text(ascii(label).toUpperCase(), MARGIN_X, y);
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(1.4);
  doc.line(MARGIN_X, y + 3, MARGIN_X + 28, y + 3);
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X + 32, y + 3, PAGE_W - MARGIN_X, y + 3);
  return y + 16;
}

function bboxString(b) {
  if (!b) return '-';
  return `${b[0].toFixed(4)}, ${b[1].toFixed(4)} to ${b[2].toFixed(4)}, ${b[3].toFixed(4)}`;
}

// ---------- legend renderers ----------------------------------------------

// Pick an RGB triplet [0..255] from a 768-byte LUT at fraction t in [0,1].
function rgbAt(lut, t, reversed = false) {
  const idx = Math.round((reversed ? 1 - t : t) * 255) * 3;
  return [lut[idx], lut[idx + 1], lut[idx + 2]];
}

// Pretty-print a numeric range value for legend tick labels. Keeps the
// label short — `formatStatNumber` shifts to K/M/B so the bar doesn't
// get cluttered with long digit strings.
function legendTick(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return formatStatNumber(v, Math.abs(v) >= 100 ? 1 : 2);
}

// Continuous color-bar: gradient (~64 rects), 5 ticks, unit label.
function drawColormapBar(doc, x, y, w, h, { colormapId, reversed, min, max, unit }) {
  const def = COLORMAPS[colormapId] || COLORMAPS.viridis;
  const lut = def.stops;
  const STOPS = 64;
  const stepW = w / STOPS;
  for (let i = 0; i < STOPS; i++) {
    const t = i / (STOPS - 1);
    const [r, g, b] = rgbAt(lut, t, reversed);
    doc.setFillColor(r, g, b);
    // Overdraw by 0.5 pt so the renderer doesn't leave hairline seams
    // between adjacent rects at fractional positions.
    doc.rect(x + i * stepW, y, stepW + 0.5, h, 'F');
  }
  // Hairline frame
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h, 'S');

  // 5 evenly spaced tick labels under the bar
  const labelY = y + h + 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  if (min != null && max != null && Number.isFinite(min) && Number.isFinite(max)) {
    const ticks = 5;
    for (let i = 0; i < ticks; i++) {
      const t = i / (ticks - 1);
      const v = min + (max - min) * t;
      const tx = x + t * w;
      const align = i === 0 ? 'left' : i === ticks - 1 ? 'right' : 'center';
      doc.text(legendTick(v), tx, labelY, { align });
    }
  } else {
    doc.text('Low', x, labelY);
    doc.text('High', x + w, labelY, { align: 'right' });
  }
  if (unit) {
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT);
    doc.text(ascii(unit), x + w / 2, labelY + 12, { align: 'center' });
  }
  return labelY + (unit ? 16 : 6);
}

// Classified legend: grid of swatch + value labels.
function drawClassSwatches(doc, x, y, w, classes, { unit } = {}) {
  if (!classes?.length) return y;
  const cols = Math.min(4, classes.length);
  const cellW = w / cols;
  const cellH = 18;
  const swatchSize = 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let rowY = y;
  classes.forEach((cls, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * cellW;
    const cy = y + row * cellH;
    // Swatch
    const hex = String(cls.color || '#94a3b8').replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    doc.setFillColor(r, g, b);
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.4);
    doc.rect(cx, cy + 2, swatchSize, swatchSize, 'FD');
    // Label
    doc.setTextColor(TEXT);
    const label = `${ascii(String(cls.value ?? '-'))}${unit ? ' ' + ascii(unit) : ''}`;
    doc.text(label, cx + swatchSize + 6, cy + 11);
    rowY = cy + cellH;
  });
  return rowY + 4;
}

// AOI overlay swatch — small inline legend explaining the yellow
// highlight on the map. Drawn beside / below the colormap bar.
function drawAoiSwatch(doc, x, y) {
  // Sample of the on-map highlight — keep these in sync with mapDraw.js.
  doc.setFillColor(0xfa, 0xcc, 0x15); // yellow-400
  doc.setDrawColor(0x85, 0x4d, 0x0e); // yellow-800
  doc.setLineWidth(0.9);
  doc.rect(x, y, 14, 10, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT);
  doc.text('AOI selection (drawn on the map)', x + 20, y + 8);
  return y + 16;
}

// ---------- main entry -----------------------------------------------------

/**
 * Build the PDF report and trigger download.
 *
 * @param {object} payload
 *   - operation: 'Zonal Statistics' (etc.)
 *   - rasterLayer: { name, label, unit?, dataMin?, dataMax?, aggregateLabel? }
 *   - maskLayer:   { name, label, featureCount?, source? }
 *   - stats: result of zonalStatistics()
 *   - mapImageDataUrl: PNG data URL of the map snapshot (optional)
 *   - notes: free-form text appended at the bottom (optional)
 *   - filename: download filename (default auto-generated)
 *   - valueUnitLabel: e.g. "people per cell"
 */
export function generateGeoAnalysisReport(payload) {
  const {
    operation = 'Zonal Statistics',
    rasterLayer = {},
    maskLayer = {},
    stats,
    mapImageDataUrl,
    notes = '',
    valueUnitLabel = '',
    filename,
  } = payload;

  const generatedAt = fmtDate();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

  drawHeader(doc);
  let y = 92;

  y = drawTitleBlock(doc, y, {
    operation,
    rasterLabel: rasterLayer.label || rasterLayer.name,
    maskLabel: maskLayer.label || maskLayer.name || maskLayer.source,
    generatedAt,
    elapsedMs: stats?.elapsedMs,
  }) + 4;

  // --- Headline cards --------------------------------------------------
  const cards = [];
  if (stats?.sum != null) {
    cards.push({
      label: rasterLayer.aggregateLabel || 'Total',
      value: formatIntegerWithCommas(stats.sum),
      hint: valueUnitLabel ? `Sum of ${valueUnitLabel}` : 'Sum of pixel values',
    });
  }
  if (stats?.count != null) {
    cards.push({
      label: 'Pixels in AOI',
      value: formatIntegerWithCommas(stats.count),
      hint: stats.coveragePct != null
        ? `${stats.coveragePct.toFixed(1)}% of AOI bbox`
        : '',
    });
  }
  if (stats?.mean != null) {
    cards.push({
      label: 'Mean / pixel',
      value: formatStatNumber(stats.mean, 2),
      hint: valueUnitLabel || '',
    });
  }
  if (cards.length) y = drawHeadlineCards(doc, y, cards) + 14;

  // --- Layers involved -------------------------------------------------
  y = drawSectionHeading(doc, y, 'Layers involved');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [['Role', 'Layer', 'Details']],
    body: [
      [
        'Source raster',
        ellipsize(ascii(rasterLayer.label || rasterLayer.name || '-'), 50),
        ascii(
          [
            rasterLayer.unit ? `Unit: ${rasterLayer.unit}` : null,
            rasterLayer.dataMin != null && rasterLayer.dataMax != null
              ? `Range: ${formatStatNumber(rasterLayer.dataMin)} to ${formatStatNumber(rasterLayer.dataMax)}`
              : null,
            rasterLayer.cellSize ? `Pixel: ${rasterLayer.cellSize}` : null,
          ]
            .filter(Boolean)
            .join('   |   ') || '-',
        ),
      ],
      [
        'AOI / mask',
        ellipsize(ascii(maskLayer.label || maskLayer.source || '-'), 50),
        ascii(
          [
            maskLayer.featureCount != null
              ? `${maskLayer.featureCount} feature${maskLayer.featureCount === 1 ? '' : 's'}`
              : null,
            stats?.polygonBbox ? `bbox ${bboxString(stats.polygonBbox)}` : null,
          ]
            .filter(Boolean)
            .join('   |   ') || '-',
        ),
      ],
    ],
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 5,
      textColor: TEXT,
      lineColor: RULE,
      lineWidth: 0.4,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: HEADER_BG,
      textColor: '#ffffff',
      fontStyle: 'bold',
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 78, fontStyle: 'bold' },
      1: { cellWidth: 150 },
      2: { cellWidth: 'auto' },
    },
  });
  y = doc.lastAutoTable.finalY + 14;

  // --- Statistics (full-width 2-up grid) ------------------------------
  // Twelve metrics laid out as a 4-column table — [Metric | Value | Metric | Value]
  // — so the block reads as two neat columns side-by-side without
  // wasting vertical space. Numbers right-align in their column.
  y = drawSectionHeading(doc, y, 'Statistics');
  const rawStats = [
    ['Count (valid pixels)', formatIntegerWithCommas(stats?.count)],
    ['Sum',                  formatIntegerWithCommas(stats?.sum)],
    ['Mean',                 stats?.mean != null ? stats.mean.toFixed(4) : '-'],
    ['Min',                  stats?.min != null ? formatStatNumber(stats.min, 4) : '-'],
    ['Max',                  stats?.max != null ? formatStatNumber(stats.max, 4) : '-'],
    ['Std. dev.',            stats?.std != null ? stats.std.toFixed(4) : '-'],
    ['Median (p50)',         stats?.median != null ? formatStatNumber(stats.median, 4) : '-'],
    ['p10',                  stats?.p10 != null ? formatStatNumber(stats.p10, 4) : '-'],
    ['p25',                  stats?.p25 != null ? formatStatNumber(stats.p25, 4) : '-'],
    ['p75',                  stats?.p75 != null ? formatStatNumber(stats.p75, 4) : '-'],
    ['p90',                  stats?.p90 != null ? formatStatNumber(stats.p90, 4) : '-'],
    ['Coverage',             stats?.coveragePct != null ? `${stats.coveragePct.toFixed(2)}% of AOI bbox` : '-'],
  ];
  const half = Math.ceil(rawStats.length / 2);
  const leftHalf = rawStats.slice(0, half);
  const rightHalf = rawStats.slice(half);
  const statsBody = leftHalf.map((row, i) => [
    ascii(row[0]), ascii(row[1]),
    ascii(rightHalf[i]?.[0] ?? ''), ascii(rightHalf[i]?.[1] ?? ''),
  ]);
  const totalW = PAGE_W - MARGIN_X * 2;
  const metricW = Math.round(totalW * 0.30);
  const valueW = totalW / 2 - metricW;
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [['Metric', 'Value', 'Metric', 'Value']],
    body: statsBody,
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: 5.5,
      textColor: TEXT,
      lineColor: RULE,
      lineWidth: 0.4,
      valign: 'middle',
    },
    headStyles: {
      fillColor: HEADER_BG,
      textColor: '#ffffff',
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left',
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: metricW },
      1: { halign: 'right', cellWidth: valueW },
      2: { fontStyle: 'bold', cellWidth: metricW },
      3: { halign: 'right', cellWidth: valueW },
    },
    alternateRowStyles: { fillColor: '#f1f5f9' },
  });
  // Page 1 ends here. The map gets its own page so it can render large.

  // --- Page 2: big map + notes ----------------------------------------
  doc.addPage();
  drawHeader(doc);
  y = 92;
  y = drawSectionHeading(doc, y, 'Area of interest');

  // Reserve room at the bottom of page 2 for everything that follows
  // the map: bbox caption, legend block, raster-details table, footer,
  // and (when present) notes. Sizes are rough but conservative so the
  // map shrinks instead of pushing the details onto a third page.
  const reservedBelow =
    14 /* bbox caption */ +
    16 /* legend heading */ + 60 /* gradient bar + ticks + unit */ +
    10 /* gap */ +
    16 /* details heading */ + 230 /* details table (~9 rows incl. wrap) */ +
    14 /* gap */ +
    28 /* footer */ + 10 /* extra slack */ +
    (notes ? 60 : 0) /* notes block when present */;
  const mapBoxW = PAGE_W - MARGIN_X * 2;
  const mapMaxH = Math.max(220, PAGE_H - y - reservedBelow);

  let mapBottomY = y;
  if (mapImageDataUrl) {
    try {
      const props = doc.getImageProperties(mapImageDataUrl);
      const aspect = props.width / props.height;
      let drawW = mapBoxW;
      let drawH = drawW / aspect;
      if (drawH > mapMaxH) {
        drawH = mapMaxH;
        drawW = drawH * aspect;
      }
      const drawX = MARGIN_X + (mapBoxW - drawW) / 2;
      // Hairline frame around the image — keeps the snapshot looking
      // like a deliberate figure rather than a free-floating raster.
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.6);
      doc.roundedRect(drawX - 4, y - 4, drawW + 8, drawH + 8, 4, 4, 'S');
      doc.addImage(mapImageDataUrl, 'PNG', drawX, y, drawW, drawH);
      mapBottomY = y + drawH + 8;
    } catch {
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.6);
      const phH = Math.min(360, mapMaxH);
      doc.roundedRect(MARGIN_X, y, mapBoxW, phH, 4, 4, 'S');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(MUTED);
      doc.text('Map snapshot unavailable', PAGE_W / 2, y + phH / 2, { align: 'center' });
      mapBottomY = y + phH + 8;
    }
  } else {
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.6);
    const phH = Math.min(360, mapMaxH);
    doc.roundedRect(MARGIN_X, y, mapBoxW, phH, 4, 4, 'S');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text('No map snapshot provided', PAGE_W / 2, y + phH / 2, { align: 'center' });
    mapBottomY = y + phH + 8;
  }

  // Bbox caption directly under the map
  if (stats?.polygonBbox) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    const caption = `AOI bbox: ${bboxString(stats.polygonBbox)} (EPSG:4326)`;
    doc.text(ascii(caption), MARGIN_X, mapBottomY + 4);
    mapBottomY += 14;
  }
  y = mapBottomY + 14;

  // --- Legend ----------------------------------------------------------
  // Two side-by-side blocks: the raster colormap (or classified
  // swatches) on the left, the yellow AOI overlay swatch on the right.
  y = drawSectionHeading(doc, y, 'Legend');
  const legendW = PAGE_W - MARGIN_X * 2;
  const legendLeftW = Math.round(legendW * 0.66);
  const legendRightX = MARGIN_X + legendLeftW + 18;

  // Heading mini-label for the raster legend
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  const cmapDef = COLORMAPS[rasterLayer.colormap] || COLORMAPS.viridis;
  const cmapLabel = `${cmapDef.label}${rasterLayer.colormapReversed ? ' (reversed)' : ''}`;
  doc.text(
    ascii(`RASTER · ${rasterLayer.mode === 'classified' ? 'classified' : cmapLabel}`).toUpperCase(),
    MARGIN_X,
    y,
  );
  let legendBottomLeft;
  if (rasterLayer.mode === 'classified' && rasterLayer.classes?.length) {
    legendBottomLeft = drawClassSwatches(
      doc,
      MARGIN_X,
      y + 6,
      legendLeftW,
      rasterLayer.classes,
      { unit: rasterLayer.unit },
    );
  } else {
    legendBottomLeft = drawColormapBar(
      doc,
      MARGIN_X,
      y + 8,
      legendLeftW,
      14,
      {
        colormapId: rasterLayer.colormap,
        reversed: !!rasterLayer.colormapReversed,
        min: rasterLayer.styleMin ?? rasterLayer.dataMin,
        max: rasterLayer.styleMax ?? rasterLayer.dataMax,
        unit: rasterLayer.unit,
      },
    );
  }

  // AOI swatch column
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text('AOI OVERLAY', legendRightX, y);
  const legendBottomRight = drawAoiSwatch(doc, legendRightX, y + 8);

  y = Math.max(legendBottomLeft, legendBottomRight) + 10;

  // --- Raster details + interpretation guide --------------------------
  y = drawSectionHeading(doc, y, 'Raster details');
  const stretchLabel = rasterLayer.autoStretch
    ? `Auto — data min/max (${legendTick(rasterLayer.dataMin)} to ${legendTick(rasterLayer.dataMax)})`
    : `Fixed — ${legendTick(rasterLayer.styleMin)} to ${legendTick(rasterLayer.styleMax)}`;
  const detailsRows = [
    ['Layer', ellipsize(rasterLayer.label || rasterLayer.name || '-', 70)],
    ['Active frame', rasterLayer.name || '-'],
    ['Rendering mode', rasterLayer.mode === 'classified' ? 'Classified (exact-match)' : 'Continuous (ramp)'],
    ['Colormap', `${cmapLabel}${rasterLayer.mode === 'classified' ? ' (n/a)' : ''}`],
    ['Display stretch', stretchLabel],
    ['Source data range',
      rasterLayer.dataMin != null && rasterLayer.dataMax != null
        ? `${legendTick(rasterLayer.dataMin)} to ${legendTick(rasterLayer.dataMax)}`
        : '-'],
    ['Pixel size', rasterLayer.cellSize || '-'],
    ['CRS', rasterLayer.crs || 'EPSG:4326 (assumed)'],
    [
      'How to interpret',
      rasterLayer.valueInterpretation ||
        'Each pixel stores one value sampled at the centre of its cell. The Sum metric ' +
        'aggregates these values across the AOI; Mean is the per-pixel average; Median, p10-p90 ' +
        'describe the distribution. Coverage is the share of the AOI bounding box that lies inside ' +
        'the selected polygon mask.',
    ],
  ].map(([k, v]) => [ascii(k), ascii(v)]);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [['Field', 'Value']],
    body: detailsRows,
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 5,
      textColor: TEXT,
      lineColor: RULE,
      lineWidth: 0.4,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: HEADER_BG,
      textColor: '#ffffff',
      fontStyle: 'bold',
      fontSize: 9,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 110 },
      1: { cellWidth: 'auto' },
    },
    alternateRowStyles: { fillColor: '#f1f5f9' },
  });
  y = doc.lastAutoTable.finalY + 14;

  // --- Notes -----------------------------------------------------------
  if (notes) {
    // Drop notes onto a new page only if it truly can't fit — usually
    // the page-2 footer leaves enough room for a 2-3 line caption.
    const wrapped = doc.splitTextToSize(ascii(notes), PAGE_W - MARGIN_X * 2);
    const noteH = wrapped.length * 11 + 22;
    if (y + noteH > PAGE_H - 40) {
      doc.addPage();
      drawHeader(doc);
      y = 92;
    }
    y = drawSectionHeading(doc, y, 'Notes');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT);
    doc.text(wrapped, MARGIN_X, y);
  }

  // --- Footers on every page ------------------------------------------
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawFooter(doc, p, pageCount, generatedAt);
  }

  const safeName = (filename || `geo-analysis_${operation}_${Date.now()}.pdf`)
    .replace(/[\\/:*?"<>|]/g, '_');
  doc.save(safeName);
}
