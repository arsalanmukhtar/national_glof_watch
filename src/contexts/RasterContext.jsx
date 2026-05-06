import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// RasterContext — local raster catalog + user-defined groups.
//
// • `available` is the flat list returned by `GET /api/rasters` — every
//   `.tif` / `.tiff` in the configured server directory.
// • `groups` is the user's selection: each group is either a single raster
//   or a temporal series (sorted by parsedDate / mtime).
//
// Phase 1 (current) keeps everything in memory — the panel reads, the
// future map renderer will read the same. Phase 2 will hang symbology
// (colormap, range) and the temporal slider off `groups[*]`.
//
// Group shape:
//   {
//     id,                   // local uid
//     name,                 // user label (defaults to filename / sequence)
//     kind: 'single' | 'temporal',
//     visible: boolean,     // map-render toggle
//     activeIndex: number,  // for temporal — which frame is current
//     layers: [{
//       name,        // filename in RASTER_DIR
//       parsedDate,  // ISO date or null
//       size, mtime, // straight from the catalog
//     }],
//   }
// ---------------------------------------------------------------------------

const RasterContext = createContext(null);

export function RasterProvider({ children }) {
  const [available, setAvailable] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState({
    loading: false,
    error: null,
    dir: null,
  });
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);

  const refresh = useCallback(async () => {
    setCatalogStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fetch('/api/rasters');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setAvailable(Array.isArray(json.files) ? json.files : []);
      setCatalogStatus({ loading: false, error: null, dir: json.dir ?? null });
    } catch (err) {
      setAvailable([]);
      setCatalogStatus({
        loading: false,
        error: err.message || 'Failed to load',
        dir: null,
      });
    }
  }, []);

  // Upload one File via raw streamed POST. Resolves with the catalog
  // entry for the freshly written file. Same-name re-uploads overwrite
  // (matches what most file managers do).
  const uploadFile = useCallback(
    async (file, { onProgress } = {}) => {
      if (!file) throw new Error('No file');
      // XMLHttpRequest is the only path that surfaces upload progress —
      // fetch's body-stream progress isn't supported in any current
      // browser. Wrap it as a Promise so the caller can `await`.
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          'POST',
          `/api/rasters/upload?name=${encodeURIComponent(file.name)}`,
        );
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        if (onProgress) {
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              onProgress(ev.loaded, ev.total);
            }
          };
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (err) {
              reject(err);
            }
          } else {
            let msg = `HTTP ${xhr.status}`;
            try {
              const j = JSON.parse(xhr.responseText);
              if (j?.error) msg = j.error;
            } catch {
              /* keep generic message */
            }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(file);
      });
    },
    [],
  );

  const deleteFile = useCallback(async (name) => {
    const r = await fetch(
      `/api/rasters/file/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    // Pull the file out of any group it was attached to — the file no
    // longer exists on disk, so a group still pointing at it would
    // silently fail at render time.
    setGroups((prev) =>
      prev
        .map((g) => ({
          ...g,
          layers: g.layers.filter((l) => l.name !== name),
          activeIndex: 0,
        }))
        .filter((g) => g.layers.length > 0),
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sort temporal frames by parsedDate (ascending) when present, else by
  // mtime so a directory of timestamped scans still gets a sensible order
  // even when the filename pattern doesn't carry a date.
  const orderTemporalLayers = (layers) => {
    return [...layers].sort((a, b) => {
      const da = a.parsedDate ?? '';
      const db = b.parsedDate ?? '';
      if (da && db) return da.localeCompare(db);
      if (da) return -1;
      if (db) return 1;
      return (a.mtime ?? '').localeCompare(b.mtime ?? '');
    });
  };

  const addGroup = useCallback(({ kind, fileNames, name }) => {
    if (!Array.isArray(fileNames) || fileNames.length === 0) return null;
    const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    setGroups((prev) => {
      // Resolve filenames against the current catalog so we capture the
      // size / mtime / parsedDate once at add-time. The catalog itself
      // can refresh later without invalidating the group.
      const lookup = new Map(available.map((f) => [f.name, f]));
      const layers = fileNames
        .map((fn) => lookup.get(fn))
        .filter(Boolean);
      if (layers.length === 0) return prev;

      const ordered =
        kind === 'temporal' ? orderTemporalLayers(layers) : layers;
      const finalKind = ordered.length === 1 ? 'single' : kind;
      const defaultName =
        name ||
        (finalKind === 'temporal'
          ? `Series · ${ordered.length} frames`
          : ordered[0].name);

      return [
        ...prev,
        {
          id,
          name: defaultName,
          kind: finalKind,
          visible: true,
          activeIndex: 0,
          layers: ordered,
        },
      ];
    });
    setActiveGroupId(id);
    return id;
  }, [available]);

  const removeGroup = useCallback((id) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setActiveGroupId((curr) => (curr === id ? null : curr));
  }, []);

  const updateGroup = useCallback((id, partial) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...partial } : g)),
    );
  }, []);

  const toggleVisible = useCallback((id) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, visible: !g.visible } : g)),
    );
  }, []);

  const setActiveFrame = useCallback((id, index) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const max = Math.max(0, g.layers.length - 1);
        const clamped = Math.min(Math.max(0, index), max);
        return { ...g, activeIndex: clamped };
      }),
    );
  }, []);

  // Filenames already used by existing groups — surfaced to the file
  // picker so the same raster isn't offered twice when it's already in
  // a group. Filter at the picker level, not at the group level (a user
  // might genuinely want the same file in two groups; we can revisit).
  const usedNames = useMemo(() => {
    const s = new Set();
    for (const g of groups) for (const l of g.layers) s.add(l.name);
    return s;
  }, [groups]);

  const value = useMemo(
    () => ({
      available,
      catalogStatus,
      refresh,
      uploadFile,
      deleteFile,
      groups,
      activeGroupId,
      setActiveGroupId,
      addGroup,
      removeGroup,
      updateGroup,
      toggleVisible,
      setActiveFrame,
      usedNames,
    }),
    [
      available,
      catalogStatus,
      refresh,
      uploadFile,
      deleteFile,
      groups,
      activeGroupId,
      addGroup,
      removeGroup,
      updateGroup,
      toggleVisible,
      setActiveFrame,
      usedNames,
    ],
  );

  return (
    <RasterContext.Provider value={value}>{children}</RasterContext.Provider>
  );
}

export function useRasters() {
  const ctx = useContext(RasterContext);
  if (!ctx) {
    throw new Error('useRasters must be used inside RasterProvider');
  }
  return ctx;
}

// Pretty-print byte counts (used by the file picker + group rows).
export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
