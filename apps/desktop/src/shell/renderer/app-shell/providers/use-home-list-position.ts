import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useHomeNavigation } from './app-store.js';
import type { HomeNavigation } from './home-navigation.js';

type Position = { top: number; focus: string | null };
const positions = new WeakMap<HomeNavigation, { generation: number; entries: Map<string, Position> }>();

/** Ephemeral list position only. Canonical navigation still owns every route,
 * query and selection; reset drops these numbers with the old account scope. */
export function useHomeListPosition(key: string, ready = true) {
  const navigation = useHomeNavigation();
  const viewport = useRef<HTMLDivElement>(null);
  const restoredFocus = useRef(false);
  const generation = useSyncExternalStore(navigation.subscribe, () => navigation.getSnapshot().generation, () => 0);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!ready || !element) return;
    let cache = positions.get(navigation);
    if (!cache || cache.generation !== generation) {
      cache = { generation, entries: new Map() };
      positions.set(navigation, cache);
    }
    const saved = cache.entries.get(key);
    const entries = cache.entries;
    let focus = saved?.focus ?? null;
    element.scrollTop = saved?.top ?? 0;
    const save = () => {
      entries.set(key, { top: element.scrollTop, focus });
      if (entries.size > 64) entries.delete(entries.keys().next().value!);
    };
    const focused = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-view-key]') : null;
      if (target && element.contains(target)) { focus = target.dataset.viewKey ?? null; save(); }
    };
    // Live query edits must keep focus in the search field. A remount on Back
    // may restore the row the user left, but a cache hit alone may not.
    if (!restoredFocus.current) {
      restoredFocus.current = true;
      if (focus) [...element.querySelectorAll<HTMLElement>('[data-view-key]')].find(node => node.dataset.viewKey === focus)?.focus({ preventScroll: true });
    }
    element.addEventListener('scroll', save, { passive: true });
    element.addEventListener('focusin', focused);
    return () => { save(); element.removeEventListener('scroll', save); element.removeEventListener('focusin', focused); };
  }, [navigation, generation, key, ready]);
  return viewport;
}
