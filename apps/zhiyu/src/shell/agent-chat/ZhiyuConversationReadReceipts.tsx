import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNimiAppActivityView, NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE, type NimiAppActivityRecord, type NimiAppActivityViewSnapshot, type NimiLocalAppActivityClient, type NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';
import { ConversationReadMarker } from '@nimiplatform/kit/features/chat/ui';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';

type ReadClient = Pick<NimiLocalAppActivityClient, 'list' | 'subscribe' | 'markRead'>;
type Input = { scopeKey: string; agentHandle: string | null; activity: ReadClient; listReferences: () => Promise<readonly NimiLocalAppAgentReference[]> };

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r014
export function useConversationReadReceipts({ scopeKey, agentHandle, activity, listReferences }: Input) {
  const [state, setState] = useState<{ scope: string; snapshot: NimiAppActivityViewSnapshot } | null>(null);
  const [failures, setFailures] = useState<ReadonlySet<string>>(new Set());
  const generation = useRef(0);
  const pending = useRef(new Set<string>());
  const scope = `${scopeKey}:${agentHandle ?? ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    const current = ++generation.current;
    let view: ReturnType<typeof createNimiAppActivityView> | undefined;
    setState(null); setFailures(new Set());
    if (agentHandle) void listReferences().then(references => {
      const reference = references.find(item => item.agentHandle === agentHandle);
      if (current !== generation.current || !reference) return;
      view = createNimiAppActivityView({ activity, filter: { agentRef: reference.activityAgentRef }, maxRecords: 300,
        onUpdate: snapshot => {
          if (current !== generation.current) return;
          setState({ scope, snapshot });
          // The SDK publishes before releasing its paging guard. Continue
          // after that callback returns, only for this still-current view.
          if (snapshot.hasMore && !snapshot.error) queueMicrotask(() => {
            if (current === generation.current) view?.loadMore();
          });
        } });
      view.start();
    }).catch(() => { /* No records means no acknowledgement; conversation remains available. */ });
    return () => { generation.current++; void view?.stop(); };
  }, [scope, agentHandle, activity, listReferences]);
  const acknowledge = useCallback(async (record: NimiAppActivityRecord) => {
    if (currentScope.current !== scope) return;
    const key = `${scope}:${record.activityId}:${record.revision}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    setFailures(previous => { const next = new Set(previous); next.delete(record.activityId); return next; });
    try { await activity.markRead({ activityId: record.activityId, displayedRevision: record.revision }); }
    catch { if (currentScope.current === scope) setFailures(previous => new Set(previous).add(record.activityId)); }
    finally { pending.current.delete(key); }
  }, [scope, activity]);
  const replies = useMemo(() => new Map((state?.scope === scope ? state.snapshot.records : [])
    .filter(record => record.source.kind === 'runtime-agent' && record.type === NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE && record.userView.unread)
    .map(record => [record.key, record])), [state, scope]);
  return { replies, failures, acknowledge };
}

export function useZhiyuConversationReadReceipts(scopeKey: string, agentHandle: string | null) {
  const boundClient = useMemo(() => getZhiyuLocalAppClient(), []);
  const activity = useMemo<ReadClient>(() => ({
    list: input => boundClient.activity.list(input),
    subscribe: input => boundClient.activity.subscribe(input),
    markRead: input => boundClient.activity.markRead(input),
  }), []);
  const listReferences = useCallback(() => boundClient.agents.listReferences(), []);
  return useConversationReadReceipts({ scopeKey, agentHandle, activity, listReferences });
}

export function ZhiyuConversationReadReceipt({ reply, state }: { reply: NimiAppActivityRecord; state: ReturnType<typeof useConversationReadReceipts> }) {
  return <>
    <ConversationReadMarker value={reply} onVisible={state.acknowledge} />
    {state.failures.has(reply.activityId) ? <p role="status" className="mt-1 text-xs text-[var(--nimi-text-secondary)]">已读状态暂未同步。<button type="button" className="ml-2 underline" onClick={() => { void state.acknowledge(reply); }}>重试</button></p> : null}
  </>;
}
