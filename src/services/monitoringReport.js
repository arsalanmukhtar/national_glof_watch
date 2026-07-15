import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Chart } from 'chart.js';
import { colorFor } from '@/config/parameterColors';
import { buildLegendGradient } from '@/config/parameterLegends';

// PDF report generator for the Monitoring surface.
// -----------------------------------------------------------------
// Design goals:
//   • One consistent visual language — muted slate body, emerald
//     brand bar, parameter-accent per-cell headers, everything
//     aligned to a 15 mm margin grid.
//   • Every image high-DPR (map = mapbox canvas, chart = re-rendered
//     offscreen at 2400×750) so nothing looks pixelated when the PDF
//     is zoomed / printed.
//   • All text sanitised for the built-in Helvetica font (Unicode
//     arrows, degree signs, bullets get ASCII fallbacks) so no
//     "gibberish" runs of `&U&n&i&c&o&d&e` show up when a special
//     character is passed through.
//   • Cell page header sits BELOW the top-of-page stamp so nothing
//     overlaps regardless of page number.
//   • Trend table highlights min / max rows and adds a light red→
//     green gradient on the Value column so scan-reading tells the
//     story before you read numbers.
//   • Multiple station photos render in a 2-column grid, not just
//     the first frame.
// -----------------------------------------------------------------

// -------- Layout constants --------
const A4_W = 210;
const A4_H = 297;
const M = 15;                    // page margin
const CW = A4_W - 2 * M;         // content width
const PAGE_HEADER_H = 10;        // top stamp band on non-cover pages
const PAGE_FOOTER_H = 10;        // footer band

// -------- Palette --------
// Mirrors the app's design tokens so the exported doc reads as the
// same product. Uses [r,g,b] tuples because jsPDF's setFillColor et
// al take triples; the hex-to-rgb helper below converts on demand.
const C = {
  emerald:      [4, 47, 46],     // brand emerald (titlebar-dark)
  emeraldMid:   [6, 78, 59],     // deep emerald for lower band
  lime:         [132, 204, 22],  // lime accent
  limeInk:      [26, 46, 5],     // dark text on lime
  slate:        [15, 23, 42],    // primary text
  slateMid:     [51, 65, 85],
  slateSoft:    [71, 85, 105],
  muted:        [100, 116, 139], // slate-500
  hairline:     [226, 232, 240], // slate-200 for borders
  softBg:       [248, 250, 252], // slate-50
  panelBg:      [241, 245, 249], // slate-100
  ndma:         [220, 38, 38],   // red-600 (NDMA badge)
  pmd:          [3, 105, 161],   // sky-700 (PMD badge)
  amber:        [217, 119, 6],
  minCell:      [220, 252, 231], // emerald-100 — subtle green fill
  minInk:       [22, 101, 52],   // emerald-700 — cell text
  maxCell:      [254, 226, 226], // red-100 — subtle red fill
  maxInk:       [153, 27, 27],   // red-800 — cell text
};

const setFill = (pdf, rgb) => pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
const setDraw = (pdf, rgb) => pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
const setText = (pdf, rgb) => pdf.setTextColor(rgb[0], rgb[1], rgb[2]);

// hex → [r,g,b] for parameter accents from colorFor()
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return [100, 116, 139];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// Blend two rgb tuples by weight `t` in [0,1]. t=0 → a, t=1 → b.
function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

// -------- Text sanitisation --------
// jsPDF's built-in Helvetica is Latin-1 only. Unicode characters
// outside that range (arrows, degree sign in some ranges, bullets,
// em-dashes, etc.) render as garbage byte sequences that read like
// `&T&r&e&n&d& &·& …`. This map replaces the offenders with
// safe ASCII lookalikes so labels stay readable and clean.
const UNICODE_MAP = {
  '→': '>',   // → right arrow
  '←': '<',   // ← left arrow
  '⇒': '=>',  // ⇒
  '•': '-',   // • bullet
  '·': '-',   // · middle dot
  '–': '-',   // – en-dash
  '—': '--',  // — em-dash
  '…': '...', // … ellipsis
  '‘': "'",   // ‘
  '’': "'",   // ’
  '“': '"',   // “
  '”': '"',   // ”
  ' ': ' ',   // NBSP
  ' ': ' ',   // thin space
};
function txt(input) {
  if (input == null) return '';
  let s = String(input);
  // Fast-path replacements for the frequent offenders.
  for (const [from, to] of Object.entries(UNICODE_MAP)) {
    if (s.includes(from)) s = s.split(from).join(to);
  }
  // Strip anything remaining outside Latin-1. The degree sign 0xB0
  // IS Latin-1 so it survives. Anything else non-ASCII+non-Latin-1
  // becomes a space so the layout stays intact.
  s = s.replace(/[^\x09\x0A\x0D\x20-\xFF]/g, ' ');
  return s;
}

// -------- Data collection --------

// Fetch everything the PDF needs for one cell: map snapshot, chart
// snapshot + resolved data, station feature (for coord/attributes),
// district + neighbours (via coord), and any station photos.
async function collectCellData(cell, meta) {
  const { cellKey, parameter, mapApi, chartApi } = cell;

  const chartInfo = chartApi?.getData?.() ?? {};

  let mapPng = null;
  try {
    mapPng = await mapApi?.snapshot?.();
  } catch { /* leave null; section will note "map unavailable" */ }

  const result = {
    cellKey,
    parameter,
    accent: hexToRgb(colorFor(parameter)),
    chartInfo,
    chartPng: null,      // populated by hi-res render below
    mapPng,
    feature: null,
    districtInfo: null,
    photos: [],
  };

  // Hi-res chart render — build an off-screen canvas at 2400x750 so
  // the embedded image doesn't pixelate at PDF scale.
  if (Array.isArray(chartInfo.points) && chartInfo.points.length > 0) {
    result.chartPng = await renderChartOffscreen(chartInfo);
  }

  if (chartInfo.stationId == null) return result;

  // Station feature — for coord + station attributes.
  try {
    const qs = meta.earlyWarning
      ? `?earlyFactor=${encodeURIComponent(meta.earlyWarningFactor)}`
      : '';
    const res = await fetch(
      `/api/parameters/${encodeURIComponent(parameter)}/latest${qs}`,
    );
    if (res.ok) {
      const data = await res.json();
      result.feature =
        data?.features?.find(
          (f) =>
            Number(f?.properties?.stationId) === Number(chartInfo.stationId),
        ) ?? null;
    }
  } catch { /* leave feature null */ }

  // District context.
  const coords = result.feature?.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const [lng, lat] = coords;
    try {
      const dres = await fetch(
        `/api/secondary/district-at?lng=${lng}&lat=${lat}`,
      );
      if (dres.ok) {
        const dist = await dres.json();
        try {
          const nres = await fetch(
            `/api/secondary/district-neighbours/${encodeURIComponent(dist.district)}`,
          );
          if (nres.ok) {
            result.districtInfo = await nres.json();
          } else {
            result.districtInfo = { ...dist, neighbours: [] };
          }
        } catch {
          result.districtInfo = { ...dist, neighbours: [] };
        }
      }
    } catch { /* leave districtInfo null */ }
  }

  // Photos — up to first four for the grid.
  try {
    const pres = await fetch(
      `/api/parameters/stations/${chartInfo.stationId}/photos`,
    );
    if (pres.ok) {
      const data = await pres.json();
      result.photos = (Array.isArray(data?.photos) ? data.photos : []).slice(0, 4);
    }
  } catch { /* no photos */ }

  return result;
}

// -------- Off-screen high-res chart render --------

// Rebuild the chart in an off-screen canvas at a fixed high
// resolution, then convert to a data URL. This is independent of the
// live UI chart (which is small and pixelates when scaled up) so the
// PDF gets a crisp image regardless of viewport size.
async function renderChartOffscreen(chartInfo) {
  const { points, elementName, unit } = chartInfo;
  if (!Array.isArray(points) || points.length === 0) return null;

  const WIDTH = 2400;
  const HEIGHT = 750;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-100000px';
  container.style.left = '-100000px';
  container.style.width = `${WIDTH}px`;
  container.style.height = `${HEIGHT}px`;
  container.style.pointerEvents = 'none';
  container.style.background = '#ffffff';
  document.body.appendChild(container);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const accent = colorFor(elementName);

  // Simplified point radius rule that reads well at report scale —
  // hourly ticks visible, sub-hour muted.
  const pointRadiusFor = (ctx2) => {
    const lbl = ctx2.chart?.data?.labels?.[ctx2.dataIndex];
    if (!lbl) return 0;
    const d = new Date(lbl);
    if (Number.isNaN(d.getTime())) return 0;
    const isHour = d.getMinutes() === 0;
    return isHour ? 4 : 2;
  };

  // Gradient reuses the same helper the live chart uses so colours
  // match the app precisely.
  const lineGradient = (context) => {
    const { chart } = context;
    const { ctx: cctx, chartArea, scales } = chart;
    const g = buildLegendGradient(cctx, chartArea, scales?.y, elementName, 1);
    return g ?? accent;
  };
  const fillGradient = (context) => {
    const { chart } = context;
    const { ctx: cctx, chartArea, scales } = chart;
    const g = buildLegendGradient(cctx, chartArea, scales?.y, elementName, 0.16);
    return g ?? `${accent}22`;
  };

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: points.map((p) => p.ts),
      datasets: [
        {
          label: `${elementName}${unit ? ` (${unit})` : ''}`,
          data: points.map((p) => (p.value == null ? null : Number(p.value.toFixed(3)))),
          borderColor: lineGradient,
          backgroundColor: fillGradient,
          pointBackgroundColor: lineGradient,
          pointBorderColor: lineGradient,
          pointRadius: pointRadiusFor,
          borderWidth: 3.5,
          fill: true,
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 1,   // canvas is already at target res
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          ticks: {
            color: '#475569',
            font: { size: 22, weight: '600', family: 'Helvetica, Arial, sans-serif' },
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 40,
            callback: function (value) {
              const raw = this.getLabelForValue(value);
              const d = new Date(raw);
              if (Number.isNaN(d.getTime())) return raw;
              const totalHours = (new Date(points[points.length - 1].ts) - new Date(points[0].ts)) / 3_600_000;
              if (totalHours <= 30) {
                return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
              }
              return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
            },
          },
          grid: { color: 'rgba(148,163,184,0.25)', drawBorder: false },
        },
        y: {
          ticks: {
            color: '#475569',
            font: { size: 22, weight: '600', family: 'Helvetica, Arial, sans-serif' },
          },
          grid: { color: 'rgba(148,163,184,0.25)', drawBorder: false },
          title: {
            display: !!unit,
            text: unit || '',
            color: '#475569',
            font: { size: 24, weight: '700', family: 'Helvetica, Arial, sans-serif' },
          },
        },
      },
    },
  });

  // Give Chart.js a tick to draw before capturing.
  await new Promise((r) => setTimeout(r, 60));
  const dataUrl = canvas.toDataURL('image/png');
  chart.destroy();
  document.body.removeChild(container);
  return dataUrl;
}

// Convert a photo URL to a base64 data URL so jsPDF can embed it.
async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// -------- Drawing helpers --------

function fmtNum(v, digits = 2) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function fmtDT(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

// Fit-into-box image render. Preserves aspect ratio inside the given
// (maxW × maxH) rectangle and returns the drawn height so callers can
// advance y precisely.
function drawImageFitted(pdf, dataUrl, x, y, maxW, maxH) {
  if (!dataUrl) return 0;
  try {
    const props = pdf.getImageProperties(dataUrl);
    const ratio = props.width / props.height;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    const dx = x + (maxW - w) / 2;
    pdf.addImage(dataUrl, 'PNG', dx, y, w, h, undefined, 'FAST');
    return h;
  } catch (err) {
    console.warn('[monitoring report] image add failed:', err);
    return 0;
  }
}

// Muted section subheader ("Location", "Trend", "Attributes"…).
function drawSectionTitle(pdf, y, title) {
  setText(pdf, C.slate);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(txt(title), M, y + 3);
  setDraw(pdf, C.hairline);
  pdf.setLineWidth(0.25);
  pdf.line(M, y + 4.5, A4_W - M, y + 4.5);
  return y + 9;
}

// -------- Cover page --------

function drawCoverPage(pdf, meta, cellData) {
  // Emerald hero band — slimmer than before, single anchor bar with
  // brand mark on the left and the classification pill on the right.
  const bandH = 26;
  setFill(pdf, C.emerald);
  pdf.rect(0, 0, A4_W, bandH, 'F');
  // Lime keyline underneath for brand accent.
  setFill(pdf, C.lime);
  pdf.rect(0, bandH, A4_W, 0.9, 'F');

  // Brand mark — small chip + wordmark on the left.
  const chipX = M;
  const chipY = 8;
  setFill(pdf, C.lime);
  pdf.roundedRect(chipX, chipY, 10, 10, 1.6, 1.6, 'F');
  setText(pdf, C.limeInk);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('G', chipX + 5, chipY + 7, { align: 'center' });

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('NATIONAL GLOF WATCH', chipX + 14, chipY + 4.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(200, 220, 200);
  pdf.text('Glacial Lake Outburst Flood Monitoring', chipX + 14, chipY + 8.5);

  // Classification pill top-right.
  drawClassificationPill(pdf, A4_W - M, chipY + 2.5, meta);

  // Big title block below the band.
  let y = bandH + 14;
  setText(pdf, C.slate);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  pdf.text('Monitoring Report', M, y);
  y += 6;
  setText(pdf, C.muted);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(
    txt(`Generated on ${meta.generatedAt.toLocaleString()}`),
    M,
    y,
  );

  // Meta card — 2-column key/value grid.
  y += 8;
  const cardH = 32;
  setFill(pdf, C.softBg);
  setDraw(pdf, C.hairline);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(M, y, CW, cardH, 2, 2, 'FD');

  const kvs = [
    ['Layout', `${meta.layoutLabel}  ${meta.cellCount} cells configured, ${meta.activeCellCount} with data`],
    ['Time window', meta.chartWindowLabel],
    ['Classification', meta.classificationFull],
    ['Report ID', meta.reportId],
  ];
  const colW = CW / 2;
  const padX = 5;
  const rowH = 7;
  kvs.forEach((kv, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = M + col * colW + padX;
    const cy = y + 6 + row * (rowH * 2);
    setText(pdf, C.muted);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text(txt(kv[0].toUpperCase()), cx, cy);
    setText(pdf, C.slate);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    // Truncate long strings to a single line inside the card.
    const line = pdf.splitTextToSize(txt(kv[1]), colW - padX * 2)[0] || '';
    pdf.text(line, cx, cy + 5);
  });
  y += cardH + 8;

  // Cell summary table.
  y = drawSectionTitle(pdf, y, 'Cell summary');
  autoTable(pdf, {
    startY: y,
    head: [['Cell', 'Parameter', 'Station', 'District', 'Latest', 'Updated']],
    body: cellData.map((d) => {
      const p = d.feature?.properties ?? {};
      return [
        d.cellKey.toUpperCase(),
        txt(d.parameter),
        txt(d.chartInfo?.stationName || '-'),
        txt(d.districtInfo?.district || '-'),
        p.value == null ? '-' : `${fmtNum(p.value)}${d.chartInfo.unit ? ` ${txt(d.chartInfo.unit)}` : ''}`,
        p.lastUpdate ? new Date(p.lastUpdate).toLocaleDateString() : '-',
      ];
    }),
    theme: 'grid',
    margin: { left: M, right: M },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 2,
      textColor: C.slate,
      lineColor: C.hairline,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: C.emeraldMid,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: C.softBg },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const d = cellData[data.row.index];
        if (!d) return;
        data.cell.styles.fillColor = d.accent;
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.halign = 'center';
      }
    },
    columnStyles: {
      0: { cellWidth: 14 },
    },
  });

  // Description paragraph — justified with a proper line height so
  // it reads as a real block of body copy, not a wall of default text.
  const startY = pdf.lastAutoTable.finalY + 8;
  setText(pdf, C.slateMid);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  const descParagraphs = [
    'This report captures the current state of the Monitoring surface at the time of export. Each cell contributes one section with a map snapshot centred on the selected station, the chart for the shared time window, a sample of the underlying readings (first five, minimum, maximum, and last five), the station\'s core attributes, and its administrative context (district, province, and the districts that share a boundary).',
    `Classification method: ${meta.classificationFull}. Alert states in the map snapshots and threshold references in the readings all reflect that choice. NDMA tightens PMD's official thresholds by 10 percent to surface potential concerns earlier; the two methods are otherwise identical.`,
  ];
  drawJustified(pdf, descParagraphs, M, startY, CW, 4.6);
}

// -------- Per-cell page --------

async function drawCellPage(pdf, d, meta) {
  pdf.addPage();
  let y = PAGE_HEADER_H + 4;

  // Cell header — accent bar with badge + parameter + station.
  y = drawCellHeader(pdf, y, d, meta);
  y = drawLocationBlock(pdf, y, d.districtInfo);
  y = drawMapBlock(pdf, y, d);
  y = drawChartBlock(pdf, y, d, meta);
  y = drawTrendTable(pdf, y, d);
  y = drawAttributeTable(pdf, y, d);
  y = await drawPhotoGrid(pdf, y, d);
  return y;
}

// Cell header: accent bar (parameter colour) with cell badge and
// parameter name, followed by a slate sub-line with station + auto/
// classification tags. Anchored at `y` returned from the page-header
// pass so nothing overlaps the top-page stamp.
function drawCellHeader(pdf, y, d, meta) {
  const barH = 12;
  setFill(pdf, d.accent);
  pdf.roundedRect(M, y, CW, barH, 2, 2, 'F');

  // Cell badge — dark rounded rect on the bar left.
  const badgeSize = 8;
  const badgeX = M + 3;
  const badgeY = y + (barH - badgeSize) / 2;
  setFill(pdf, C.slate);
  pdf.roundedRect(badgeX, badgeY, badgeSize, badgeSize, 1.6, 1.6, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text(
    d.cellKey.toUpperCase(),
    badgeX + badgeSize / 2,
    badgeY + badgeSize / 2 + 1.5,
    { align: 'center' },
  );

  // Parameter name — white on the accent bar.
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(txt(d.parameter), badgeX + badgeSize + 4, y + 8);

  // Classification pill mini — right side of the bar.
  drawClassificationPill(pdf, A4_W - M - 3, y + 3.5, meta, { compact: true });

  y += barH + 3;

  // Sub-line: station name + AUTO tag if applicable.
  setText(pdf, C.slateMid);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  const stn = txt(d.chartInfo?.stationName || 'No station resolved');
  const auto = d.chartInfo?.isAutoPick ? '   (auto-picked)' : '';
  pdf.text(`Station: ${stn}${auto}`, M, y + 4);

  return y + 8;
}

// Small classification pill, reused on cover + per-cell. `compact`
// halves the padding so it fits inside the cell accent bar.
function drawClassificationPill(pdf, rightX, topY, meta, { compact = false } = {}) {
  const label = meta.classificationShort;
  const rgb = meta.earlyWarning ? C.ndma : C.pmd;
  const padX = compact ? 2.4 : 3;
  const padY = compact ? 1.4 : 1.8;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(compact ? 8 : 9);
  const tw = pdf.getTextWidth(label);
  const pillW = tw + padX * 2;
  const pillH = compact ? 4.5 : 5.5;
  const px = rightX - pillW;
  const py = topY;
  setFill(pdf, rgb);
  pdf.roundedRect(px, py, pillW, pillH, 1.4, 1.4, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.text(label, px + padX, py + pillH - padY - 0.1);
}

// Location panel — district / province / division + neighbours.
function drawLocationBlock(pdf, y, districtInfo) {
  const boxH = 22;
  setFill(pdf, C.softBg);
  setDraw(pdf, C.hairline);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(M, y, CW, boxH, 2, 2, 'FD');

  if (!districtInfo || !districtInfo.district) {
    setText(pdf, C.muted);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.text(
      'District context unavailable for this station.',
      M + 4,
      y + boxH / 2 + 1,
    );
    return y + boxH + 4;
  }

  const padX = 5;
  const rowY = y + 6.5;
  const colW = (CW - padX * 2) / 3;

  const labels = ['DISTRICT', 'PROVINCE', 'DIVISION'];
  const values = [
    districtInfo.district,
    districtInfo.province,
    districtInfo.division,
  ];
  for (let i = 0; i < 3; i++) {
    const cx = M + padX + i * colW;
    setText(pdf, C.muted);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text(labels[i], cx, rowY);
    setText(pdf, C.slate);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(txt(values[i] || '-'), cx, rowY + 5);
  }

  // Neighbours.
  setText(pdf, C.muted);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.text('NEIGHBOURING DISTRICTS', M + padX, rowY + 11);
  const neighbourLabel =
    Array.isArray(districtInfo.neighbours) && districtInfo.neighbours.length > 0
      ? districtInfo.neighbours.map((n) => n.district).join(', ')
      : 'None recorded';
  setText(pdf, C.slateSoft);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const line = pdf.splitTextToSize(txt(neighbourLabel), CW - padX * 2)[0] || '';
  pdf.text(line, M + padX, rowY + 16);

  return y + boxH + 4;
}

// Map block — larger canvas, aspect-preserving fit up to 110 mm tall.
function drawMapBlock(pdf, y, d) {
  y = drawSectionTitle(pdf, y, 'Map view');
  if (!d.mapPng) {
    setText(pdf, C.muted);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.text('Map snapshot unavailable.', M, y + 3);
    return y + 8;
  }
  const h = drawImageFitted(pdf, d.mapPng, M, y, CW, 110);
  y += h + 3;
  setText(pdf, C.muted);
  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(8.5);
  const caption = txt(
    `Cell ${d.cellKey.toUpperCase()}  |  ${d.parameter}${d.chartInfo?.stationName ? `  |  centred on ${d.chartInfo.stationName}` : ''}`,
  );
  pdf.text(caption, M, y + 3);
  return y + 7;
}

// Chart block — hi-res chart image, 60mm tall by default. If the
// remaining space on the page is thin, push to a fresh page so it
// doesn't collide with the trend table below.
function drawChartBlock(pdf, y, d, meta) {
  if (y > A4_H - PAGE_FOOTER_H - 80) {
    pdf.addPage();
    y = PAGE_HEADER_H + 4;
  }
  const windowText = txt(
    `Trend  |  ${d.chartInfo?.dateRangeLabel || meta.chartWindowLabel}`,
  );
  y = drawSectionTitle(pdf, y, windowText);
  if (!d.chartPng) {
    setText(pdf, C.muted);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.text('Chart snapshot unavailable — no station picked or no data.', M, y + 3);
    return y + 8;
  }
  const h = drawImageFitted(pdf, d.chartPng, M, y, CW, 62);
  return y + h + 4;
}

// Sampled trend table with:
//   • Min row: light green cell + green ink
//   • Max row: light red cell + red ink
//   • Value column: light gradient from green (low) → white (mid) → red (high)
function drawTrendTable(pdf, y, d) {
  const points = Array.isArray(d.chartInfo?.points) ? d.chartInfo.points : [];
  if (points.length === 0) return y;
  if (y > A4_H - PAGE_FOOTER_H - 60) {
    pdf.addPage();
    y = PAGE_HEADER_H + 4;
  }
  y = drawSectionTitle(pdf, y, 'Readings sample');

  const unit = d.chartInfo.unit || '';
  const sampled = pickTrendSample(points);

  // Compute value range for the gradient. Ignore null / non-finite.
  const numeric = sampled.map((s) => Number(s.value)).filter(Number.isFinite);
  const vMin = Math.min(...numeric);
  const vMax = Math.max(...numeric);
  const span = vMax - vMin || 1;

  autoTable(pdf, {
    startY: y,
    head: [['#', 'Timestamp', `Value${unit ? ` (${txt(unit)})` : ''}`, 'Note']],
    body: sampled.map((row) => [
      row.idx + 1,
      fmtDT(row.ts),
      row.value == null ? '-' : fmtNum(row.value),
      txt(row.note || ''),
    ]),
    theme: 'grid',
    margin: { left: M, right: M },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 1.8,
      textColor: C.slate,
      lineColor: C.hairline,
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: C.emeraldMid,
      textColor: [255, 255, 255],
      halign: 'left',
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 55 },
      2: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
      3: { cellWidth: 'auto', textColor: C.muted, fontStyle: 'italic' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const row = sampled[data.row.index];
      if (!row) return;
      // Min / max full-row highlight.
      if (row.note === 'min') {
        data.cell.styles.fillColor = C.minCell;
        if (data.column.index === 2 || data.column.index === 3) {
          data.cell.styles.textColor = C.minInk;
          data.cell.styles.fontStyle = 'bold';
        }
      } else if (row.note === 'max') {
        data.cell.styles.fillColor = C.maxCell;
        if (data.column.index === 2 || data.column.index === 3) {
          data.cell.styles.textColor = C.maxInk;
          data.cell.styles.fontStyle = 'bold';
        }
      } else if (data.row.index % 2 === 1) {
        // Zebra stripe for non-min/max rows.
        data.cell.styles.fillColor = C.softBg;
      }
      // Value column gradient — soft green (low) to soft red (high)
      // via a white midpoint. Overrides zebra fill so the gradient
      // reads cleanly; leaves min/max highlights alone (they've
      // already been set above and win via the early return below).
      if (data.column.index === 2 && row.note !== 'min' && row.note !== 'max') {
        const v = Number(row.value);
        if (Number.isFinite(v)) {
          const t = (v - vMin) / span;         // 0 → low, 1 → high
          const lowFill = [220, 252, 231];      // emerald-100
          const midFill = [255, 255, 255];
          const highFill = [254, 226, 226];    // red-100
          const fill = t < 0.5 ? mix(lowFill, midFill, t * 2) : mix(midFill, highFill, (t - 0.5) * 2);
          data.cell.styles.fillColor = fill;
        }
      }
    },
  });
  return pdf.lastAutoTable.finalY + 5;
}

function pickTrendSample(points) {
  const n = points.length;
  const rows = [];
  const pushed = new Set();
  const push = (idx, note) => {
    if (idx < 0 || idx >= n || pushed.has(idx)) return;
    pushed.add(idx);
    rows.push({ idx, ts: points[idx].ts, value: points[idx].value, note });
  };
  for (let i = 0; i < Math.min(5, n); i++) push(i, i === 0 ? 'first' : '');
  let minIdx = 0, maxIdx = 0;
  for (let i = 0; i < n; i++) {
    const v = Number(points[i].value);
    if (Number.isFinite(v)) {
      const cvMin = Number(points[minIdx].value);
      const cvMax = Number(points[maxIdx].value);
      if (!Number.isFinite(cvMin) || v < cvMin) minIdx = i;
      if (!Number.isFinite(cvMax) || v > cvMax) maxIdx = i;
    }
  }
  push(minIdx, 'min');
  push(maxIdx, 'max');
  for (let i = Math.max(0, n - 5); i < n; i++) push(i, i === n - 1 ? 'latest' : '');
  return rows.sort((a, b) => a.idx - b.idx);
}

// Station attribute table.
function drawAttributeTable(pdf, y, d) {
  if (y > A4_H - PAGE_FOOTER_H - 50) {
    pdf.addPage();
    y = PAGE_HEADER_H + 4;
  }
  y = drawSectionTitle(pdf, y, 'Station attributes');

  const props = d.feature?.properties ?? {};
  const rows = [
    ['Station ID',     fmt(props.stationId)],
    ['Station Name',   fmt(props.stationName)],
    ['Element ID',     fmt(props.elementId)],
    ['State ID',       fmt(props.stateId)],
    ['Latest Value',   props.value == null ? '-' : `${fmtNum(props.value)}${d.chartInfo.unit ? ` ${txt(d.chartInfo.unit)}` : ''}`],
    ['Last Update',    fmtDT(props.lastUpdate)],
    ['Photos on file', String(d.photos.length)],
  ];

  autoTable(pdf, {
    startY: y,
    head: [['Attribute', 'Value']],
    body: rows,
    theme: 'grid',
    margin: { left: M, right: M },
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: 2,
      textColor: C.slate,
      lineColor: C.hairline,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: C.emeraldMid,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: C.softBg },
    columnStyles: {
      0: { cellWidth: 55, fontStyle: 'bold', textColor: C.slateMid },
      1: { cellWidth: 'auto' },
    },
  });
  return pdf.lastAutoTable.finalY + 5;
}

function fmt(v) {
  if (v == null || v === '') return '-';
  return txt(String(v));
}

// Photo grid — 1 photo → full width, 2 → side-by-side, 3-4 → 2×2.
async function drawPhotoGrid(pdf, y, d) {
  if (!d.photos?.length) return y;

  const urls = d.photos.map((p) => p.url).filter(Boolean).slice(0, 4);
  if (urls.length === 0) return y;

  // Fetch all photos in parallel.
  const dataUrls = (await Promise.all(urls.map(urlToDataUrl))).filter(Boolean);
  if (dataUrls.length === 0) return y;

  // Estimate needed height and page-break if necessary.
  const estRowH = dataUrls.length === 1 ? 90 : 60;
  const estH = estRowH * (dataUrls.length <= 2 ? 1 : 2) + 15;
  if (y + estH > A4_H - PAGE_FOOTER_H - 4) {
    pdf.addPage();
    y = PAGE_HEADER_H + 4;
  }
  y = drawSectionTitle(pdf, y, dataUrls.length === 1 ? 'Station photo' : 'Station photos');

  const gap = 4;

  if (dataUrls.length === 1) {
    const h = drawImageFitted(pdf, dataUrls[0], M, y, CW, 100);
    return y + h + 4;
  }

  const cols = 2;
  const rows = Math.ceil(dataUrls.length / cols);
  const cellW = (CW - gap * (cols - 1)) / cols;
  const cellH = 60;

  for (let i = 0; i < dataUrls.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cx = M + c * (cellW + gap);
    const cy = y + r * (cellH + gap);
    drawImageFitted(pdf, dataUrls[i], cx, cy, cellW, cellH);
  }

  return y + rows * cellH + (rows - 1) * gap + 4;
}

// -------- Justified paragraph rendering --------

// jsPDF has no native justified layout, so we split the text into
// lines that fit CW, then space out inter-word gaps on all lines
// except the last one to achieve full justification. Line height in
// mm is caller-controlled so cover paragraphs can use tighter or
// looser leading than body copy elsewhere.
function drawJustified(pdf, paragraphs, x, startY, width, lineHeight) {
  let cursorY = startY;
  for (let p = 0; p < paragraphs.length; p++) {
    const paragraph = txt(paragraphs[p]);
    const lines = pdf.splitTextToSize(paragraph, width);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const isLast = li === lines.length - 1;
      if (isLast) {
        pdf.text(line, x, cursorY);
      } else {
        const words = line.split(' ').filter(Boolean);
        if (words.length <= 1) {
          pdf.text(line, x, cursorY);
        } else {
          const wordsWidth = words.reduce((sum, w) => sum + pdf.getTextWidth(w), 0);
          const spaceExtra = (width - wordsWidth) / (words.length - 1);
          let cx = x;
          for (let wi = 0; wi < words.length; wi++) {
            pdf.text(words[wi], cx, cursorY);
            cx += pdf.getTextWidth(words[wi]) + spaceExtra;
          }
        }
      }
      cursorY += lineHeight;
    }
    // Inter-paragraph spacing.
    cursorY += lineHeight * 0.4;
  }
  return cursorY;
}

// -------- Header + footer pass --------

function drawFootersAndHeaders(pdf, meta) {
  const total = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);

    // Page-level header stamp (skip cover — its own hero band owns
    // that space).
    if (p > 1) {
      setFill(pdf, C.emerald);
      pdf.rect(0, 0, A4_W, PAGE_HEADER_H, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.text('NATIONAL GLOF WATCH', M, PAGE_HEADER_H / 2 + 1.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      setText(pdf, [200, 220, 200]);
      pdf.text(
        txt(`Monitoring Report  |  ${meta.classificationShort}`),
        M + 48,
        PAGE_HEADER_H / 2 + 1.5,
      );
      // Right side of header: report ID
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(200, 220, 200);
      pdf.text(meta.reportId, A4_W - M, PAGE_HEADER_H / 2 + 1.5, { align: 'right' });
      // Lime keyline.
      setFill(pdf, C.lime);
      pdf.rect(0, PAGE_HEADER_H, A4_W, 0.5, 'F');
    }

    // Footer — always.
    setDraw(pdf, C.hairline);
    pdf.setLineWidth(0.25);
    pdf.line(M, A4_H - PAGE_FOOTER_H, A4_W - M, A4_H - PAGE_FOOTER_H);
    setText(pdf, C.muted);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(
      txt(`Generated ${meta.generatedAt.toLocaleString()}  |  ${meta.classificationShort}`),
      M,
      A4_H - 4,
    );
    pdf.text(
      `Page ${p} of ${total}`,
      A4_W - M,
      A4_H - 4,
      { align: 'right' },
    );
  }
}

// -------- Save --------

function buildFilename(meta) {
  const d = meta.generatedAt;
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const layout = meta.layoutId.replace(/[^a-z0-9]/gi, '');
  return `glof-monitoring-report_${stamp}_${layout}_${meta.classificationShort}.pdf`;
}

async function saveBlob(blob, filename) {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { savedVia: 'picker', filename: handle.name };
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error('Save cancelled.');
      }
      console.warn('[monitoring report] file picker failed, falling back:', err);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { savedVia: 'download', filename };
}

// -------- Public API --------

export async function generateMonitoringReport({
  cells,
  chartDays,
  chartWindowLabel,
  layoutId,
  layoutLabel,
  earlyWarning,
  earlyWarningFactor,
  onProgress,
}) {
  const total = 1 + cells.length + 1;
  let step = 0;
  const tick = (label) => {
    step += 1;
    onProgress?.(step, total, label);
  };

  onProgress?.(0, total, 'Collecting cell data...');

  const generatedAt = new Date();
  const reportId = `NGW-${generatedAt.getFullYear()}${String(generatedAt.getMonth() + 1).padStart(2, '0')}${String(generatedAt.getDate()).padStart(2, '0')}-${String(generatedAt.getHours()).padStart(2, '0')}${String(generatedAt.getMinutes()).padStart(2, '0')}${String(generatedAt.getSeconds()).padStart(2, '0')}`;

  const meta = {
    generatedAt,
    reportId,
    chartDays,
    chartWindowLabel,
    layoutId,
    layoutLabel,
    earlyWarning,
    earlyWarningFactor,
    cellCount: cells.length,
    classificationShort: earlyWarning ? 'NDMA' : 'PMD',
    classificationFull: earlyWarning
      ? 'NDMA (Early Warning: thresholds tightened 10%)'
      : 'PMD (Official classification bands)',
  };

  // Collect per cell.
  const collected = [];
  for (const cell of cells) {
    tick(`Snapshotting cell ${cell.cellKey.toUpperCase()}...`);
    const d = await collectCellData(cell, meta);
    collected.push(d);
  }
  meta.activeCellCount = collected.filter((d) => d.chartInfo?.stationId != null).length;

  // Build PDF.
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setFont('helvetica', 'normal');
  drawCoverPage(pdf, meta, collected);
  for (const d of collected) {
    await drawCellPage(pdf, d, meta);
  }
  drawFootersAndHeaders(pdf, meta);

  tick('Saving PDF...');

  const filename = buildFilename(meta);
  const blob = pdf.output('blob');
  const saved = await saveBlob(blob, filename);
  return { filename: saved.filename };
}
