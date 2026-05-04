import Panel from '@/components/ui/Panel';
import { cn } from '@/utils/cn';

const VIDEO_MODULES = import.meta.glob('../../assets/videos/*.mp4', {
  eager: true,
  query: '?url',
  import: 'default',
});

const EXCLUDED = new Set(['bg_video.mp4']);

const VIDEOS = Object.entries(VIDEO_MODULES)
  .map(([path, src]) => {
    const name = path.split('/').pop() ?? '';
    return { name, src };
  })
  .filter((v) => !EXCLUDED.has(v.name))
  .map(({ name, src }) => ({
    src,
    name,
    label: name
      .replace(/\.[^.]+$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

function VideoItem({ src, label }) {
  return (
    <figure className="rounded-md overflow-hidden border border-day-border dark:border-night-border bg-day-surface dark:bg-night-surface">
      <div className="relative aspect-video bg-slate-900">
        <video
          src={src}
          controls
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        >
          Your browser does not support video playback.
        </video>
      </div>
      <figcaption className="px-3 py-1.5 text-xs font-medium text-day-text dark:text-night-text">
        {label}
      </figcaption>
    </figure>
  );
}

export default function VideosPanel({ compact = false }) {
  const listClass = compact
    ? 'flex flex-col gap-3'
    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';

  const list = (
    <div className={listClass}>
      {VIDEOS.map((video) => (
        <VideoItem key={video.src} src={video.src} label={video.label} />
      ))}
    </div>
  );

  if (compact) {
    return <div className={cn('w-full')}>{list}</div>;
  }

  return <Panel title="Videos">{list}</Panel>;
}
