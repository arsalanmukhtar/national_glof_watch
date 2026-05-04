import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import Panel from '@/components/ui/Panel';
import Select from '@/components/ui/Select';
import { useTheme } from '@/hooks/useTheme';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  ChartTooltip,
  Legend,
  Filler,
);

// Per-chart line/fill colors. Each chart picks a distinct hue and each hue
// has a day/night variant tuned for contrast against the panel surface.
const SERIES = {
  area: {
    day:   { line: '#1d4ed8', fill: 'rgba(29, 78, 216, 0.14)' },   // blue-700
    night: { line: '#60a5fa', fill: 'rgba(96, 165, 250, 0.22)' },  // blue-400
  },
  volume: {
    day:   { line: '#0e7490', fill: 'rgba(14, 116, 144, 0.14)' },  // cyan-700
    night: { line: '#22d3ee', fill: 'rgba(34, 211, 238, 0.22)' },  // cyan-400
  },
};

// Axis / grid / tooltip tokens shared across charts.
const TOKENS = {
  day: {
    text:       '#475569', // slate-600
    grid:       'rgba(148, 163, 184, 0.28)',
    axis:       '#cbd5e1', // slate-300
    tooltipBg:  '#0f172a',
    tooltipFg:  '#f8fafc',
  },
  night: {
    text:       '#cbd5e1', // slate-300
    grid:       'rgba(203, 213, 225, 0.12)',
    axis:       '#475569', // slate-600
    tooltipBg:  '#1e272e',
    tooltipFg:  '#f1f5f9',
  },
};

function buildOptions(theme) {
  const t = TOKENS[theme];
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          padding: 8,
          color: t.text,
          font: { size: 10 },
          usePointStyle: true,
        },
      },
      tooltip: {
        backgroundColor: t.tooltipBg,
        titleColor: t.tooltipFg,
        bodyColor: t.tooltipFg,
        borderColor: t.axis,
        borderWidth: 1,
        padding: 8,
        cornerRadius: 6,
        titleFont: { size: 11, weight: '600' },
        bodyFont: { size: 11 },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: t.text, font: { size: 10 } },
        border: { color: t.axis },
      },
      y: {
        beginAtZero: true,
        grid: { color: t.grid },
        ticks: { color: t.text, font: { size: 10 } },
        border: { color: t.axis },
      },
    },
  };
}

function buildDataset(label, palette) {
  return {
    labels: [],
    datasets: [
      {
        label,
        data: [],
        borderColor: palette.line,
        backgroundColor: palette.fill,
        pointBackgroundColor: palette.line,
        pointBorderColor: palette.line,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        fill: true,
        tension: 0.35,
      },
    ],
  };
}

export default function ChartsRow() {
  const { theme } = useTheme();
  const options = useMemo(() => buildOptions(theme), [theme]);
  const lakeAreaData = useMemo(() => buildDataset('Lake area (m²)', SERIES.area[theme]), [theme]);
  const lakeVolumeData = useMemo(() => buildDataset('Lake volume (m³)', SERIES.volume[theme]), [theme]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0"
    >
      <Panel
        title="Lake Area"
        className="!p-3"
        actions={
          <Select aria-label="Lake selector" defaultValue="" className="text-xs py-1">
            <option value="">All lakes</option>
          </Select>
        }
      >
        <div className="h-28 sm:h-32 lg:h-36">
          <Line data={lakeAreaData} options={options} />
        </div>
      </Panel>

      <Panel
        title="Lake Volume"
        className="!p-3"
        actions={
          <Select aria-label="Lake selector" defaultValue="" className="text-xs py-1">
            <option value="">All lakes</option>
          </Select>
        }
      >
        <div className="h-28 sm:h-32 lg:h-36">
          <Line data={lakeVolumeData} options={options} />
        </div>
      </Panel>
    </motion.div>
  );
}
