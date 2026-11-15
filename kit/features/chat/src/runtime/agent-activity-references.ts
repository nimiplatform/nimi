import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createNimiAppActivityView,
  type NimiLocalAppAgentReference,
  type NimiLocalAppActivityClient,
  type NimiAppActivityRecord,
  type NimiAppActivityView,
  type NimiAppActivityViewSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';

export type AgentActivityReferencesState = {
  readonly records: readonly NimiAppActivityRecord[];
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly incomplete: boolean;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly pageFailed: boolean;
  readonly openingId: string | null;
  readonly openFailed: boolean;
  readonly retry: () => void;
  readonly loadMore: () => void;
  readonly open: (record: NimiAppActivityRecord) => void;
};

// @nimi-authority: rule.nimi.desktop.agent-projection.business-reference
// Published references have their own view and lifetime. They never enter the
// canonical message reducer, composer, model request or Memory input.
export function useAgentActivityReferences(input: {
  readonly agentHandle: string | null | undefined;
  readonly sourceRef?: string | null;
  readonly pendingOnly?: boolean;
  readonly listReferences: () => Promise<readonly NimiLocalAppAgentReference[]>;
  readonly activity: Pick<NimiLocalAppActivityClient, 'list' | 'subscribe' | 'open'>;
}): AgentActivityReferencesState {
  const [snapshot, setSnapshot] = useState<NimiAppActivityViewSnapshot | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const activeView = useRef<NimiAppActivityView | null>(null);
  const generation = useRef(0);
  const { agentHandle, listReferences, activity, sourceRef, pendingOnly } = input;
  const scope = JSON.stringify([agentHandle ?? null, sourceRef ?? null, Boolean(pendingOnly)]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    const current = ++generation.current;
    let view: NimiAppActivityView | undefined;
    setSnapshot(null);
    setFailed(false);
    setOpeningId(null);
    setOpenFailed(false);
    setLoadingMore(false);
    setSelection(scope);
    if (agentHandle) void (async () => {
      try {
        const reference = (await listReferences()).find(value => value.agentHandle === agentHandle);
        if (current !== generation.current) return;
        if (!reference) throw new Error('Current Agent reference is unavailable');
        view = createNimiAppActivityView({
          activity: {
            subscribe: activity.subscribe,
            list: async query => {
              if (query?.pageToken && current === generation.current) setLoadingMore(true);
              try { return await activity.list(query); }
              finally { if (current === generation.current) setLoadingMore(false); }
            },
          },
          filter: { agentRef: reference.activityAgentRef, ...(sourceRef ? { sourceRef } : {}),
            ...(pendingOnly ? { kind: 'todo' as const, todoStates: ['open' as const] } : {}) },
          pageSize: 50,
          maxRecords: 50,
          onUpdate: value => { if (current === generation.current) setSnapshot(value); },
        });
        activeView.current = view;
        view.start();
      } catch { if (current === generation.current) setFailed(true); }
    })();
    return () => { generation.current++; activeView.current = null; void view?.stop(); };
  }, [agentHandle, listReferences, activity, sourceRef, pendingOnly, scope, revision]);

  const open = useCallback((record: NimiAppActivityRecord) => {
    if (currentScope.current !== scope || !activeView.current?.snapshot().records.some(row => row.activityId === record.activityId && row.source.kind === 'app')) return;
    const current = generation.current;
    setOpeningId(record.activityId);
    setOpenFailed(false);
    void activity.open({ activityId: record.activityId }).then(result => {
      if (current === generation.current) setOpenFailed(result.outcome !== 'opened');
    }, () => {
      if (current === generation.current) setOpenFailed(true);
    }).finally(() => { if (current === generation.current) setOpeningId(null); });
  }, [activity, scope]);
  const current = selection === scope;
  return {
    records: current ? (snapshot?.records ?? []).filter(record => record.source.kind === 'app') : [],
    loading: Boolean(agentHandle) && (!current || (!snapshot && !failed) || snapshot?.status === 'loading'),
    unavailable: current && (failed || snapshot?.status === 'unavailable'),
    incomplete: current && Boolean(snapshot && !snapshot.complete),
    hasMore: current && Boolean(snapshot?.hasMore),
    loadingMore: current && loadingMore,
    pageFailed: current && Boolean(snapshot?.status === 'ready' && snapshot.error),
    openingId: current ? openingId : null,
    openFailed: current && openFailed,
    retry: () => setRevision(value => value + 1),
    loadMore: () => { if (currentScope.current === scope) activeView.current?.loadMore(); },
    open,
  };
}
