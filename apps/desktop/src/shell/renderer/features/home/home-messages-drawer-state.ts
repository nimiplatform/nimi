import { useSyncExternalStore } from 'react';
import type { HomeTimelineQuickFilter } from './home-messages-model.js';

let drawerOpen = false;
let drawerFilter: HomeTimelineQuickFilter = 'all';
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getHomeMessagesDrawerOpen(): boolean {
  return drawerOpen;
}

export function getHomeMessagesDrawerFilter(): HomeTimelineQuickFilter {
  return drawerFilter;
}

export function setHomeMessagesDrawerOpen(next: boolean, filter?: HomeTimelineQuickFilter): void {
  const nextFilter = filter ?? (next ? drawerFilter : 'all');
  if (drawerOpen === next && drawerFilter === nextFilter) return;
  drawerOpen = next;
  drawerFilter = nextFilter;
  notify();
}

export function toggleHomeMessagesDrawer(filter?: HomeTimelineQuickFilter): void {
  setHomeMessagesDrawerOpen(!drawerOpen, !drawerOpen ? filter ?? 'all' : 'all');
}

export function subscribeHomeMessagesDrawer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHomeMessagesDrawerOpen(): boolean {
  return useSyncExternalStore(
    subscribeHomeMessagesDrawer,
    getHomeMessagesDrawerOpen,
    getHomeMessagesDrawerOpen,
  );
}

export function useHomeMessagesDrawerFilter(): HomeTimelineQuickFilter {
  return useSyncExternalStore(
    subscribeHomeMessagesDrawer,
    getHomeMessagesDrawerFilter,
    getHomeMessagesDrawerFilter,
  );
}
