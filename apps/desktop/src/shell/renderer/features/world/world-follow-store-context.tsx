import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import type { WorldFollowStore } from './world-follow-store.js';

const WorldFollowStoreContext = createContext<WorldFollowStore | null>(null);

export function WorldFollowStoreProvider(
  props: PropsWithChildren<{ readonly store: WorldFollowStore }>,
) {
  return (
    <WorldFollowStoreContext.Provider value={props.store}>
      {props.children}
    </WorldFollowStoreContext.Provider>
  );
}

export type FollowedWorldsHandle = {
  readonly ids: readonly string[];
  readonly isFollowed: (worldId: string) => boolean;
  readonly toggle: (worldId: string) => boolean;
  readonly available: boolean;
  readonly error: string | null;
};

export function useFollowedWorlds(): FollowedWorldsHandle {
  const store = useContext(WorldFollowStoreContext);
  if (!store) throw new Error('WORLD_FOLLOW_STORE_MISSING');
  const accountId = useAppStore((state) => {
    const id = typeof state.auth.user?.id === 'string' ? state.auth.user.id.trim() : '';
    return id || null;
  });
  const snapshot = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot(accountId),
    () => store.emptySnapshot,
  );
  const isFollowed = useCallback(
    (worldId: string) => snapshot.set.has(String(worldId ?? '').trim()),
    [snapshot],
  );
  const toggle = useCallback(
    (worldId: string) => store.toggle(accountId, worldId),
    [accountId, store],
  );
  return {
    ids: snapshot.ids,
    isFollowed,
    toggle,
    available: Boolean(accountId),
    error: snapshot.error,
  };
}
