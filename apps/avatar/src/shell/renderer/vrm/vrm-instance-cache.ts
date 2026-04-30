// Wave 2 chunk 2-B of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Module-level cache for parsed VRM scenes keyed by source URL. Avoids
// re-parsing the same .vrm file when the same model is reloaded (e.g. R3F
// re-mount, agent switch returning to a previously-seen model). HMR-aware:
// in dev mode, `import.meta.hot.dispose` clears the cache so a Vite HMR
// update of the loader module never serves a stale VRM instance.
//
// Algorithm reference: airi `composables/vrm/instance-cache`. 0-import
// policy honoured; only the FIFO-bounded-Map shape is reused. License: airi MIT.
//
// Bound: 4 entries (FIFO eviction when adding a 5th). LRU is intentionally
// not implemented at wave_2 — most sessions hold <=2 VRMs concurrently and
// an LRU pass would overstate the constraints we need at this layer.

import type { VRM } from '@pixiv/three-vrm';

/** Maximum number of VRM scenes retained in the in-memory cache. */
export const VRM_INSTANCE_CACHE_MAX_ENTRIES = 4;

export type VrmCacheEntry = {
  vrm: VRM;
  loadedAt: number;
};

const cache = new Map<string, VrmCacheEntry>();

/**
 * Look up a previously cached VRM by its source URL. Returns the VRM
 * directly (callers do not see the entry metadata wrapper). `null` if the
 * URL is not cached.
 */
export function getCachedVrm(url: string): VRM | null {
  const entry = cache.get(url);
  return entry ? entry.vrm : null;
}

/**
 * Insert a parsed VRM into the cache under the given URL. If the cache is
 * already at `VRM_INSTANCE_CACHE_MAX_ENTRIES` and the URL is new, the
 * oldest entry (by insertion order) is evicted. Re-inserting an existing
 * URL overwrites without eviction.
 */
export function setCachedVrm(url: string, vrm: VRM): void {
  if (cache.has(url)) {
    cache.set(url, { vrm, loadedAt: Date.now() });
    return;
  }
  if (cache.size >= VRM_INSTANCE_CACHE_MAX_ENTRIES) {
    // Map iteration is insertion-ordered; first key is oldest insert.
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  cache.set(url, { vrm, loadedAt: Date.now() });
}

/** Drop every cached VRM. Used by HMR dispose and shutdown paths. */
export function clearVrmCache(): void {
  cache.clear();
}

/** Snapshot of cache state for diagnostics surfaces. */
export function vrmCacheStats(): { size: number; urls: string[] } {
  return {
    size: cache.size,
    urls: Array.from(cache.keys()),
  };
}

// HMR-aware: when Vite hot-reloads this module, drop every cached VRM so
// loader-side changes never serve a stale instance. This is a no-op in
// production builds.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearVrmCache();
  });
}
