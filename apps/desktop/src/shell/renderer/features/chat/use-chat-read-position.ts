import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CanonicalTranscriptViewProps } from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';

type ReadPosition = Parameters<NonNullable<CanonicalTranscriptViewProps['onPositionChange']>>[0];
const positions = new WeakMap<HomeNavigation, { generation: number; values: Map<string, ReadPosition> }>();

/** Retain the visible message across Home visits; Kit still owns scroll mechanics. */
export function useChatReadPosition(key: string, owner: Omit<CanonicalTranscriptViewProps, 'messages'> | undefined) {
  const navigation = useHomeNavigation();
  const generation = useSyncExternalStore(navigation.subscribe, () => navigation.getSnapshot().generation);
  const cache = useMemo(() => {
    let current = positions.get(navigation);
    if (!current || current.generation !== generation) {
      current = { generation, values: new Map() }; positions.set(navigation, current);
    }
    return current.values;
  }, [navigation, generation]);
  const initial = useMemo(() => {
    const saved = cache.get(key);
    return saved ? { ...saved, requestKey: 0, focus: false } : null;
  }, [cache, key]);
  const [cancelled, setCancelled] = useState<typeof initial>(null);
  useEffect(() => { if (owner?.positionRequest) setCancelled(initial); }, [owner?.positionRequest, initial]);
  const onPositionChange = useCallback((position: ReadPosition) => {
    cache.set(key, position);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    owner?.onPositionChange?.(position);
  }, [cache, key, owner?.onPositionChange]);
  return {
    ...owner,
    positionRequest: owner?.positionRequest ?? (initial !== cancelled ? initial : null),
    onPositionChange,
    onUserNavigate: () => { setCancelled(initial); owner?.onUserNavigate?.(); },
  };
}
