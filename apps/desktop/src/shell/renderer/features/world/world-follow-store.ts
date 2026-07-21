/**
 * Account-scoped local projection for "followed worlds".
 *
 * Following a world is a personal, app-private bookmark — not executable world
 * state. There is no admitted Realm world-follow operation yet, so this is a
 * device-local, account-keyed projection (one localStorage key per account),
 * mirroring the typed-projection discipline used by Settings device
 * preferences. When an admitted Realm operation lands, swap the load/persist
 * bodies behind this same interface; consumers and UI do not change.
 *
 * Fail-close posture: a present-but-corrupt projection surfaces as an empty set
 * plus an `error`, never as a silently fabricated list. An absent projection is
 * a valid first-run state and resolves to an empty set. Writes that cannot
 * persist throw `WorldFollowProjectionError` so a follow toggle never reports a
 * false success.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import { useAppStore } from '../../app-shell/providers/app-store';

const STORAGE_PREFIX = 'nimi.world.followed.v1';
export const WORLD_FOLLOW_EVENT = 'nimi:world:followed-changed';

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

function storageKeyFor(accountId: string): string {
  return `${STORAGE_PREFIX}.${accountId}`;
}

function resolveStorage(accountId: string): Storage {
  const storage = resolveBrowserStorage('local');
  if (!storage) {
    throw new WorldFollowProjectionError(accountId, 'localStorage unavailable');
  }
  return storage;
}

function projectIds(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) {
    throw new Error('projection is not an array');
  }
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

/* ------------------------------------------------------------------ */
/*  Snapshot cache (stable references for useSyncExternalStore)        */
/* ------------------------------------------------------------------ */

export type FollowedWorldsSnapshot = {
  readonly ids: readonly string[];
  readonly set: ReadonlySet<string>;
  readonly error: string | null;
};

const EMPTY_SNAPSHOT: FollowedWorldsSnapshot = {
  ids: Object.freeze([]),
  set: new Set<string>(),
  error: null,
};

const snapshotCache = new Map<string, FollowedWorldsSnapshot>();
const subscribers = new Set<() => void>();

function buildSnapshot(ids: string[], error: string | null): FollowedWorldsSnapshot {
  return { ids: Object.freeze([...ids]), set: new Set(ids), error };
}

function readSnapshot(accountId: string): FollowedWorldsSnapshot {
  const storage = resolveStorage(accountId);
  const result = readStorageJsonFrom(storage, storageKeyFor(accountId), projectIds);
  if (result.state === 'missing') {
    return buildSnapshot([], null);
  }
  if (result.state === 'ready') {
    return buildSnapshot(result.value, null);
  }
  return buildSnapshot([], result.error || 'world follow projection unreadable');
}

/**
 * Resolve the cached snapshot for an account, reading from storage on a cache
 * miss. Returns a stable reference so React can bail out of re-renders.
 */
export function getFollowedWorldsSnapshot(accountId: string | null | undefined): FollowedWorldsSnapshot {
  const id = normalizeAccountId(accountId);
  if (!id) {
    return EMPTY_SNAPSHOT;
  }
  const cached = snapshotCache.get(id);
  if (cached) {
    return cached;
  }
  let snapshot: FollowedWorldsSnapshot;
  try {
    snapshot = readSnapshot(id);
  } catch (error) {
    snapshot = buildSnapshot([], error instanceof Error ? error.message : 'world follow projection unavailable');
  }
  snapshotCache.set(id, snapshot);
  return snapshot;
}

function notify(): void {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  const target = typeof window === 'undefined' ? null : window;
  const onStorage = (event: Event) => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key && !storageEvent.key.startsWith(STORAGE_PREFIX)) {
      return;
    }
    snapshotCache.clear();
    onChange();
  };
  target?.addEventListener?.('storage', onStorage);
  return () => {
    subscribers.delete(onChange);
    target?.removeEventListener?.('storage', onStorage);
  };
}

/**
 * Toggle a world's followed state for an account and persist the result.
 * Throws `WorldFollowProjectionError` when the write cannot be committed.
 */
export function toggleFollowedWorld(accountId: string | null | undefined, worldId: string): boolean {
  const id = normalizeAccountId(accountId);
  const world = String(worldId ?? '').trim();
  if (!id) {
    throw new WorldFollowProjectionError('', 'no authenticated account');
  }
  if (!world) {
    throw new WorldFollowProjectionError(id, 'missing world id');
  }
  const current = getFollowedWorldsSnapshot(id);
  const nextIds = current.set.has(world)
    ? current.ids.filter((entry) => entry !== world)
    : [...current.ids, world];

  const storage = resolveStorage(id);
  const result = writeStorageJsonTo(storage, storageKeyFor(id), nextIds);
  if (result.state !== 'saved') {
    throw new WorldFollowProjectionError(
      id,
      result.error || (result.state === 'unavailable' ? 'localStorage unavailable' : 'storage write rejected'),
    );
  }
  snapshotCache.set(id, buildSnapshot([...nextIds], null));
  notify();
  globalThis.window?.dispatchEvent?.(new CustomEvent(WORLD_FOLLOW_EVENT, { detail: { accountId: id, worldId: world } }));
  const following = !current.set.has(world);
  return following;
}

/* ------------------------------------------------------------------ */
/*  React hook                                                         */
/* ------------------------------------------------------------------ */

export type FollowedWorldsHandle = {
  /** Ordered followed world ids (most recently followed last). */
  readonly ids: readonly string[];
  /** Membership lookup. */
  readonly isFollowed: (worldId: string) => boolean;
  /** Toggle follow for a world; returns the new followed state. */
  readonly toggle: (worldId: string) => boolean;
  /** Whether following is available (requires an authenticated account). */
  readonly available: boolean;
  /** Non-null when the local projection could not be read. */
  readonly error: string | null;
};

export function useFollowedWorlds(): FollowedWorldsHandle {
  const accountId = useAppStore((state) => normalizeAccountId(state.auth.user?.id));
  const snapshot = useSyncExternalStore(
    subscribe,
    () => getFollowedWorldsSnapshot(accountId),
    () => EMPTY_SNAPSHOT,
  );
  const isFollowed = useCallback((worldId: string) => snapshot.set.has(String(worldId ?? '').trim()), [snapshot]);
  const toggle = useCallback((worldId: string) => toggleFollowedWorld(accountId, worldId), [accountId]);
  return {
    ids: snapshot.ids,
    isFollowed,
    toggle,
    available: Boolean(accountId),
    error: snapshot.error,
  };
}
