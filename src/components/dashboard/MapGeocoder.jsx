import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { mapboxgl } from '@/config/mapbox';
import { MAPBOX_TOKEN } from '@/config/env';
import { cn } from '@/utils/cn';

const GEOCODE_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

// Custom themed geocoder. Hits the Mapbox geocoding REST API directly so
// we can fully style the input + result list to match day/night surfaces;
// the official @mapbox/mapbox-gl-geocoder ships a stylesheet that's hard
// to override cleanly.
export default function MapGeocoder({ map }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const markerRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  // Drop the result-pin marker when this component unmounts.
  useEffect(() => {
    return () => {
      if (markerRef.current) markerRef.current.remove();
    };
  }, []);

  // Debounced fetch — kicks in after 250ms of typing pause, ≥2 chars.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(`${GEOCODE_BASE}/${encodeURIComponent(trimmed)}.json`);
        url.searchParams.set('access_token', MAPBOX_TOKEN);
        url.searchParams.set('limit', '6');
        url.searchParams.set('autocomplete', 'true');
        if (map) {
          const c = map.getCenter();
          url.searchParams.set('proximity', `${c.lng},${c.lat}`);
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(Array.isArray(data?.features) ? data.features : []);
      } catch (err) {
        console.error('[geocoder]', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, map]);

  // Close the results list when clicking elsewhere on the page.
  useEffect(() => {
    const onClick = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleSelect = (feature) => {
    if (!map) return;
    const [lng, lat] = feature.center ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    map.flyTo({ center: [lng, lat], zoom: 11, essential: true });
    if (markerRef.current) markerRef.current.remove();
    markerRef.current = new mapboxgl.Marker({ color: '#fbbf24' })
      .setLngLat([lng, lat])
      .addTo(map);

    setQuery(feature.place_name ?? feature.text ?? '');
    setOpen(false);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="absolute top-2 right-12 z-10 w-[320px] max-w-[calc(100%-360px)]"
    >
      <div
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 rounded-md shadow-sm',
          'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
          'border border-day-border dark:border-night-border',
          'focus-within:ring-1 focus-within:ring-[#84cc16]',
        )}
      >
        <Search
          className="h-3.5 w-3.5 text-day-muted dark:text-night-muted shrink-0"
          strokeWidth={2}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search a place…"
          aria-label="Search a place"
          className={cn(
            'flex-1 bg-transparent outline-none text-[13px] min-w-0',
            'text-day-text dark:text-night-text',
            'placeholder:text-day-muted dark:placeholder:text-night-muted',
          )}
        />
        {loading ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-day-muted dark:text-night-muted shrink-0"
            aria-hidden
          />
        ) : query ? (
          <button
            type="button"
            onClick={handleClear}
            className="text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text shrink-0"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'mt-1 rounded-md shadow-lg overflow-hidden',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border',
            )}
          >
            {results.map((f) => (
              <li
                key={f.id}
                onClick={() => handleSelect(f)}
                className={cn(
                  'flex items-start gap-2 px-2.5 py-1.5 text-[13px] cursor-pointer',
                  'hover:bg-brand-100 dark:hover:bg-[#84cc16]/20',
                  'text-day-text dark:text-night-text',
                  'border-b border-day-border/60 dark:border-night-border/60 last:border-b-0',
                )}
              >
                <MapPin
                  className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[#84cc16]"
                  strokeWidth={1.75}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {f.text ?? f.place_name}
                  </div>
                  {f.place_name && f.place_name !== f.text && (
                    <div className="text-[11.5px] text-day-muted dark:text-night-muted truncate">
                      {f.place_name}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
