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
  readonly openingId: string | null;
  readonly openFailed: boolean;
  readonly retry: () => void;
  readonly open: (record: NimiAppActivityRecord) => void;
};

// @nimi-authority: rule.nimi.desktop.agent-projection.business-reference
// Published references have their own view and lifetime. They never enter the
// canonical message reducer, composer, model request or Memory input.
export function useAgentActivityReferences(input: {
  readonly agentHandle: string | null | undefined;
  readonly listReferences: () => Promise<readonly NimiLocalAppAgentReference[]>;
  readonly activity: Pick<NimiLocalAppActivityClient, 'list' | 'subscribe' | 'open'>;
}): AgentActivityReferencesState {
  const [snapshot, setSnapshot] = useState<NimiAppActivityViewSnapshot | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const { agentHandle, listReferences, activity } = input;
  useEffect(() => {
    const current = ++generation.current;
    let view: NimiAppActivityView | undefined;
    setSnapshot(null);
    setFailed(false);
    setOpeningId(null);
    setOpenFailed(false);
    setSelection(agentHandle ?? null);
    if (agentHandle) void (async () => {
      try {
        const reference = (await listReferences()).find(value => value.agentHandle === agentHandle);
        if (current !== generation.current) return;
        if (!reference) throw new Error('Current Agent reference is unavailable');
        view = createNimiAppActivityView({
          activity,
          filter: { agentRef: reference.activityAgentRef },
          maxRecords: 50,
          onUpdate: value => { if (current === generation.current) setSnapshot(value); },
        });
        view.start();
      } catch { if (current === generation.current) setFailed(true); }
    })();
    return () => { generation.current++; void view?.stop(); };
  }, [agentHandle, listReferences, activity, revision]);

  const open = useCallback((record: NimiAppActivityRecord) => {
    const current = generation.current;
    setOpeningId(record.activityId);
    setOpenFailed(false);
    void activity.open({ activityId: record.activityId }).then(result => {
      if (current === generation.current) setOpenFailed(result.outcome !== 'opened');
    }, () => {
      if (current === generation.current) setOpenFailed(true);
    }).finally(() => { if (current === generation.current) setOpeningId(null); });
  }, [activity]);
  const current = selection === (agentHandle ?? null);
  return {
    records: current ? (snapshot?.records ?? []).filter(record => record.source.kind === 'app') : [],
    loading: Boolean(agentHandle) && (!current || (!snapshot && !failed) || snapshot?.status === 'loading'),
    unavailable: current && (failed || snapshot?.status === 'unavailable'),
    incomplete: current && Boolean(snapshot && !snapshot.complete),
    openingId: current ? openingId : null,
    openFailed: current && openFailed,
    retry: () => setRevision(value => value + 1),
    open,
  };
}
