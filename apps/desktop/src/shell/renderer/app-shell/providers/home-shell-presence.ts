import type { HomeNavigation } from './home-navigation.js';

// Presentation availability only: the admission gates decide whether MainLayout mounts.
// This does not grant host permissions or infer readiness from a persisted record.
const presentations = new WeakMap<HomeNavigation, ReturnType<typeof createPresence>>();
function createPresence() {
  const mounts = new Set<symbol>();
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => mounts.size > 0,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount() { const owner = Symbol(); mounts.add(owner); publish(); return () => { mounts.delete(owner); publish(); }; },
  };
}
export function homeShellPresence(navigation: HomeNavigation) {
  let presence = presentations.get(navigation);
  if (!presence) { presence = createPresence(); presentations.set(navigation, presence); }
  return presence;
}
