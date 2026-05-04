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

const EMPTY_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: 'bottom', labels: { boxWidth: 8, font: { size: 10 } } },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
    y: { beginAtZero: true, ticks: { font: { size: 10 } } },
  },
};

function emptyDataset(label) {
  return {
    labels: [],
    datasets: [
      {
        label,
        data: [],
        borderColor: '#0e2873',
        backgroundColor: 'rgba(14, 40, 115, 0.15)',
        fill: true,
        tension: 0.35,
      },
    ],
  };
}

export default function ChartsRow() {
  const lakeAreaData = useMemo(() => emptyDataset('Lake area (m²)'), []);
  const lakeVolumeData = useMemo(() => emptyDataset('Lake volume (m³)'), []);

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
          <Line data={lakeAreaData} options={EMPTY_OPTIONS} />
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
          <Line data={lakeVolumeData} options={EMPTY_OPTIONS} />
        </div>
      </Panel>
    </motion.div>
  );
}
