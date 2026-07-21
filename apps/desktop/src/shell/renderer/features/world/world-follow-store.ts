import type { DesktopRendererWorldFollowPort } from '../../renderer/world-follow-port.js';

export class WorldFollowProjectionError extends Error {
  readonly accountId: string;

  constructor(accountId: string, reason: string) {
    super(`world follow projection failed for ${accountId}: ${reason}`);
    this.name = 'WorldFollowProjectionError';
    this.accountId = accountId;
  }
}

function normalizeAccountId(accountId: unknown): string | null {
  const next = typeof accountId === 'string' ? accountId.trim() : '';
  return next.length > 0 ? next : null;
}

function projectIds(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) throw new Error('projection is not an array');
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of parsed) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export type FollowedWorldsSnapshot = {
  readonly ids: readonly string[];
  readonly set: ReadonlySet<string>;
  readonly error: string | null;
};

function buildSnapshot(ids: string[], error: string | null): FollowedWorldsSnapshot {
  return Object.freeze({
    ids: Object.freeze([...ids]),
    set: new Set(ids),
    error,
  });
}

export function createWorldFollowStore(port: DesktopRendererWorldFollowPort) {
  const emptySnapshot = buildSnapshot([], null);
  const snapshotCache = new Map<string, FollowedWorldsSnapshot>();
  const subscribers = new Set<() => void>();
  let disconnectPort: (() => void) | null = null;
  let disposed = false;

  function notify(): void {
    for (const subscriber of subscribers) subscriber();
  }

  function connect(): void {
    if (disconnectPort || disposed) return;
    disconnectPort = port.subscribe((accountId) => {
      if (accountId) snapshotCache.delete(accountId);
      else snapshotCache.clear();
      notify();
    });
  }

  function getSnapshot(accountId: string | null | undefined): FollowedWorldsSnapshot {
    if (disposed) throw new Error('WORLD_FOLLOW_STORE_DISPOSED');
    const id = normalizeAccountId(accountId);
    if (!id) return emptySnapshot;
    const cached = snapshotCache.get(id);
    if (cached) return cached;
    let snapshot: FollowedWorldsSnapshot;
    try {
      const result = port.read(id);
      if (result.state === 'missing') snapshot = buildSnapshot([], null);
      else if (result.state === 'ready') snapshot = buildSnapshot(projectIds(result.value), null);
      else snapshot = buildSnapshot([], result.error);
    } catch (error) {
      snapshot = buildSnapshot([], error instanceof Error
        ? error.message
        : 'world follow projection unavailable');
    }
    snapshotCache.set(id, snapshot);
    return snapshot;
  }

  function toggle(accountId: string | null | undefined, worldId: string): boolean {
    if (disposed) throw new Error('WORLD_FOLLOW_STORE_DISPOSED');
    const id = normalizeAccountId(accountId);
    const world = String(worldId ?? '').trim();
    if (!id) throw new WorldFollowProjectionError('', 'no authenticated account');
    if (!world) throw new WorldFollowProjectionError(id, 'missing world id');
    const current = getSnapshot(id);
    const nextIds = current.set.has(world)
      ? current.ids.filter((entry) => entry !== world)
      : [...current.ids, world];
    const result = port.write(id, nextIds);
    if (result.state !== 'saved') {
      throw new WorldFollowProjectionError(id, result.error);
    }
    snapshotCache.set(id, buildSnapshot([...nextIds], null));
    notify();
    return !current.set.has(world);
  }

  return Object.freeze({
    emptySnapshot,
    getSnapshot,
    toggle,
    subscribe(onChange: () => void) {
      if (disposed) throw new Error('WORLD_FOLLOW_STORE_DISPOSED');
      connect();
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnectPort?.();
      disconnectPort = null;
      subscribers.clear();
      snapshotCache.clear();
    },
  });
}

export type WorldFollowStore = ReturnType<typeof createWorldFollowStore>;
