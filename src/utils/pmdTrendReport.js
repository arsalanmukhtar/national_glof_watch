// ---------------------------------------------------------------------------
// PMD Parameter Trend → PDF report.
//
// A one-call helper that takes the current PmdTrendPanel state and emits an
// A4 portrait PDF: emerald-and-lime branded header, parameter / station
// meta, headline stat cards, embedded chart snapshot with the high+low
// labelled, and a full per-reading time-series table whose value column is
// shaded with the SAME gradient the chart line uses — so the table by
// itself reads as a heatmap of the parameter's trend.
//
// All text passes through `ascii()` — jsPDF's built-in Helvetica is
// Latin-1 only, so the Σ / → / ° glyphs that would otherwise render as
// garbage get replaced with ASCII equivalents.
// ---------------------------------------------------------------------------

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  PARAMETER_GRADIENTS,
  colorAtValue,
} from '@/config/parameterLegends';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const HEADER_BG = '#064e3b';       // emerald-900 — dashboard titlebar
const HEADER_BG_DARK = '#022c22';  // emerald-950
const ACCENT = '#84cc16';          // lime-500
const TEXT = '#0f172a';            // slate-900
const MUTED = '#475569';           // slate-600
const RULE = '#cbd5e1';            // slate-300
const CARD_BG = '#f8fafc';         // slate-50

// Brand-fallback gradient for parameters that don't have a curated entry
// in PARAMETER_GRADIENTS — interpolate between lime and dark-lime over the
// data range so the table still reads as a heatmap.
const BRAND_LOW = '#84cc16';
const BRAND_HIGH = '#4d7c0f';

function ascii(s) {
  if (s == null) return '';
  return String(s)
    .replace(/→/g, 'to').replace(/←/g, 'from').replace(/↔/g, '-')
    .replace(/∩/g, '&').replace(/∪/g, '|')
    .replace(/Σ/g, 'Sum').replace(/μ/g, 'u')
    .replace(/·/g, '-').replace(/•/g, '-').replace(/…/g, '...')
    .replace(/°/g, ' deg').replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x00-\xff]/g, '');
}

function fmtDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function fmtTs(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fmtNumber(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '-';
  return Number(v).toFixed(decimals);
}

function ellipsize(s, max = 80) {
  if (!s) return '';
  const str = String(s);
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

// "rgb(r, g, b)" or "#rrggbb" -> [r, g, b]
function parseColorToRgb(color) {
  if (!color) return null;
  if (color.startsWith('#')) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    if (!m) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Pick a row-fill colour for a given value. Curated gradient if the
// parameter has one; otherwise interpolate between the brand colors
// across the data's own min->max range.
function valueRowColor(value, element, dataMin, dataMax) {
  if (value == null || !Number.isFinite(value)) return [248, 250, 252]; // slate-50
  const stops = PARAMETER_GRADIENTS[element];
  if (stops?.length) {
    const c = parseColorToRgb(colorAtValue(stops, value));
    if (c) return c;
  }
  // Brand fallback — t = (value - min) / (max - min)
  const low = parseColorToRgb(BRAND_LOW);
  const high = parseColorToRgb(BRAND_HIGH);
  if (!low || !high) return [248, 250, 252];
  const range = (dataMax - dataMin) || 1;
  const t = Math.max(0, Math.min(1, (value - dataMin) / range));
  return lerpRgb(low, high, t);
}

// Lighten an RGB toward white so the cell stays readable behind black
// text. Pure gradient colours are too saturated as a backdrop.
function softenForCell(rgb, mix = 0.55) {
  const white = [255, 255, 255];
  return lerpRgb(rgb, white, mix);
}

// ---------- header / footer ------------------------------------------------

function drawHeader(doc) {
  doc.setFillColor(HEADER_BG_DARK);
  doc.rect(0, 0, PAGE_W, 70, 'F');
  doc.setFillColor(HEADER_BG);
  doc.rect(0, 0, PAGE_W, 66, 'F');
  doc.setFillColor(ACCENT);
  doc.rect(0, 66, PAGE_W, 4, 'F');

  doc.setTextColor('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('National GLOF Monitoring', MARGIN_X, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor('#a7f3d0');
  doc.text('PMD Parameter Trend Report', MARGIN_X, 46);

  doc.setFontSize(9);
  doc.setTextColor('#a7f3d0');
  doc.text(
    'CONFIDENTIAL / INTERNAL USE',
    PAGE_W - MARGIN_X, 46, { align: 'right' },
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
  doc.text(`Page ${pageNum} of ${pageCount}`, PAGE_W - MARGIN_X, y, { align: 'right' });
  doc.setTextColor(ACCENT);
  doc.setFont('helvetica', 'bold');
  doc.text('National GLOF Monitoring', PAGE_W / 2, y, { align: 'center' });
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

function drawTitleBlock(doc, y, { station, parameter, dateRangeLabel, windowLabel, generatedAt }) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(TEXT);
  doc.text(ascii(parameter || '-'), MARGIN_X, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(`Generated ${generatedAt}`, PAGE_W - MARGIN_X, y - 7, { align: 'right' });
  if (windowLabel) {
    doc.text(`Window: ${windowLabel}`, PAGE_W - MARGIN_X, y + 6, { align: 'right' });
  }

  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  const sub = `Station: ${ellipsize(ascii(station || '-'), 60)}` +
    (dateRangeLabel ? `   |   Range: ${ascii(dateRangeLabel)}` : '');
  doc.text(sub, MARGIN_X, y);
  return y + 12;
}

function drawHeadlineCards(doc, y, cards) {
  const totalW = PAGE_W - MARGIN_X * 2;
  const gap = 10;
  const cardW = (totalW - gap * (cards.length - 1)) / cards.length;
  const cardH = 62;

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
    doc.text(ascii(c.label).toUpperCase(), x + 12, y + 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(TEXT);
    doc.text(ascii(c.value), x + 12, y + 38);

    if (c.hint) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      doc.text(ascii(c.hint), x + 12, y + 53);
    }
  });
  return y + cardH;
}

// ---------- main entry -----------------------------------------------------

/**
 * Build the PDF report and trigger download.
 *
 * @param {object} payload
 *   - parameter: string (e.g. "Air Temperature")
 *   - unit: string (e.g. "deg C")
 *   - stationName: string (e.g. "Gabral_ARG_2")
 *   - stationId: number
 *   - windowLabel: e.g. "Weekly", "Custom (14 days)"
 *   - dateRangeLabel: e.g. "Jun 5 -> Jun 11"
 *   - points: [{ ts, value }]
 *   - chartImageDataUrl: PNG data URL of the chart snapshot
 *   - filename?: override download filename
 */
export function generatePmdTrendReport(payload) {
  const {
    parameter = '-',
    unit = '',
    stationName = '-',
    stationId,
    windowLabel = '',
    dateRangeLabel = '',
    points = [],
    chartImageDataUrl,
    filename,
  } = payload;

  const generatedAt = fmtDate();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

  // Compute summary stats
  const numericPoints = points
    .map((p) => ({ ts: p.ts, value: p.value == null ? null : Number(p.value) }))
    .filter((p) => Number.isFinite(p.value));
  const values = numericPoints.map((p) => p.value);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const minPoint = numericPoints.find((p) => p.value === min);
  const maxPoint = numericPoints.find((p) => p.value === max);

  // --- Page 1 head ----------------------------------------------------
  drawHeader(doc);
  let y = 92;
  y = drawTitleBlock(doc, y, {
    station: stationId ? `${stationName} (#${stationId})` : stationName,
    parameter,
    dateRangeLabel,
    windowLabel,
    generatedAt,
  }) + 6;

  // --- Headline cards -------------------------------------------------
  const unitLabel = unit ? ascii(unit) : '';
  y = drawHeadlineCards(doc, y, [
    {
      label: 'Mean',
      value: fmtNumber(mean, 2),
      hint: unitLabel ? `${unitLabel} (avg)` : 'avg reading',
    },
    {
      label: 'Max',
      value: fmtNumber(max, 2),
      hint: maxPoint ? `at ${fmtTs(maxPoint.ts)}` : '',
    },
    {
      label: 'Min',
      value: fmtNumber(min, 2),
      hint: minPoint ? `at ${fmtTs(minPoint.ts)}` : '',
    },
    {
      label: 'Readings',
      value: String(numericPoints.length),
      hint: `${points.length - numericPoints.length} missing` ,
    },
  ]) + 16;

  // --- Chart snapshot -------------------------------------------------
  y = drawSectionHeading(doc, y, 'Trend chart');
  const imgW = PAGE_W - MARGIN_X * 2;
  const imgMaxH = 280;
  let chartBottom = y;
  if (chartImageDataUrl) {
    try {
      const props = doc.getImageProperties(chartImageDataUrl);
      const aspect = props.width / props.height;
      let drawW = imgW;
      let drawH = drawW / aspect;
      if (drawH > imgMaxH) {
        drawH = imgMaxH;
        drawW = drawH * aspect;
      }
      const drawX = MARGIN_X + (imgW - drawW) / 2;
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.6);
      doc.roundedRect(drawX - 4, y - 4, drawW + 8, drawH + 8, 4, 4, 'S');
      doc.addImage(chartImageDataUrl, 'PNG', drawX, y, drawW, drawH);
      chartBottom = y + drawH + 8;
    } catch {
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.6);
      doc.roundedRect(MARGIN_X, y, imgW, 120, 4, 4, 'S');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(MUTED);
      doc.text('Chart snapshot unavailable', PAGE_W / 2, y + 60, { align: 'center' });
      chartBottom = y + 128;
    }
  } else {
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.6);
    doc.roundedRect(MARGIN_X, y, imgW, 120, 4, 4, 'S');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text('No chart snapshot provided', PAGE_W / 2, y + 60, { align: 'center' });
    chartBottom = y + 128;
  }
  y = chartBottom;

  // Caption — high / low call-outs
  if (maxPoint || minPoint) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    const parts = [];
    if (maxPoint) parts.push(`High: ${fmtNumber(maxPoint.value, 2)}${unitLabel ? ' ' + unitLabel : ''} at ${fmtTs(maxPoint.ts)}`);
    if (minPoint) parts.push(`Low: ${fmtNumber(minPoint.value, 2)}${unitLabel ? ' ' + unitLabel : ''} at ${fmtTs(minPoint.ts)}`);
    doc.text(ascii(parts.join('   |   ')), MARGIN_X, y + 6);
    y += 16;
  }
  y += 12;

  // --- Readings table -------------------------------------------------
  // Sort by timestamp ascending so the table reads as a chronological log.
  const tableRows = numericPoints
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .map((p) => ({ ts: p.ts, value: p.value }));

  drawSectionHeading(doc, y, 'Readings');

  const valueRange = { min: min ?? 0, max: max ?? 1 };
  autoTable(doc, {
    startY: y + 4,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [['#', 'Timestamp', `Value${unit ? ` (${ascii(unit)})` : ''}`, 'Note']],
    body: tableRows.map((r, i) => [
      String(i + 1),
      fmtTs(r.ts),
      fmtNumber(r.value, 2),
      r.value === max ? 'HIGH' : r.value === min ? 'LOW' : '',
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4,
      textColor: TEXT,
      lineColor: RULE,
      lineWidth: 0.3,
      valign: 'middle',
    },
    headStyles: {
      fillColor: HEADER_BG,
      textColor: '#ffffff',
      fontStyle: 'bold',
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 28, halign: 'right', textColor: MUTED },
      1: { cellWidth: 132 },
      2: { cellWidth: 90, halign: 'right', fontStyle: 'bold' },
      3: { cellWidth: 'auto', halign: 'center', fontStyle: 'bold' },
    },
    // Colour the value cell using the parameter's gradient at that
    // value, softened so the cell still reads behind black text. Also
    // colour-code the Note column for HIGH / LOW.
    didParseCell(data) {
      if (data.section !== 'body') return;
      if (data.column.index === 2) {
        const row = tableRows[data.row.index];
        if (!row) return;
        const rgb = valueRowColor(row.value, parameter, valueRange.min, valueRange.max);
        const soft = softenForCell(rgb, 0.45);
        data.cell.styles.fillColor = soft;
      }
      if (data.column.index === 3) {
        const note = data.cell.raw;
        if (note === 'HIGH') {
          data.cell.styles.fillColor = [16, 185, 129];   // emerald-500
          data.cell.styles.textColor = '#ffffff';
        } else if (note === 'LOW') {
          data.cell.styles.fillColor = [220, 38, 38];    // red-600
          data.cell.styles.textColor = '#ffffff';
        }
      }
    },
  });

  // --- Footers on every page ------------------------------------------
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawFooter(doc, p, pageCount, generatedAt);
  }

  const slug = (s) =>
    String(s || 'trend')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  const ts = (() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  })();
  const finalName = (filename || `pmd-trend_${slug(stationName)}_${slug(parameter)}_${ts}.pdf`)
    .replace(/[\\/:*?"<>|]/g, '_');
  doc.save(finalName);
}
