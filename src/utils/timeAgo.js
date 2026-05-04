// Compact relative-time formatter.
// "Just now" < 1m, "5 min ago" < 1h, "3 hr ago" < 1d, "2 day ago" otherwise.
export function timeAgo(iso) {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'Never';
  const ms = Date.now() - t;
  if (ms < 0 || ms < 60_000) return 'Just now';
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return `${m} min${m === 1 ? '' : 's'} ago`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    return `${h} hr${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(ms / 86_400_000);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
