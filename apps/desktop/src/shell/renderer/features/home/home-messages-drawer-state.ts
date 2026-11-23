import { useSyncExternalStore } from 'react';

let drawerOpen = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getHomeMessagesDrawerOpen(): boolean {
  return drawerOpen;
}

export function setHomeMessagesDrawerOpen(next: boolean): void {
  if (drawerOpen === next) return;
  drawerOpen = next;
  notify();
}

export function toggleHomeMessagesDrawer(): void {
  setHomeMessagesDrawerOpen(!drawerOpen);
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
