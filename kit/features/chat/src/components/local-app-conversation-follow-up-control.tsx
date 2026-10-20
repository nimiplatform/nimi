import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { extractNimiErrorFields } from '@nimiplatform/kit/core/sdk-contract';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient, NimiLocalAppConversationState } from '@nimiplatform/kit/core/sdk-contract';

export function LocalAppConversationFollowUpControl(props: {
  translate: (key: string, values?: Record<string, string | number>) => string;
  agentHandle: string;
  conversationAnchorId: string;
  state: NimiLocalAppConversationState | null;
  conversation: () => NimiLocalAppConversationClient;
  refresh: () => void;
  onOpenAgentCenter?: () => void;
}) {
  const t = props.translate, scopeKey = `${props.agentHandle}|${props.conversationAnchorId}`;
  const currentScope = useRef<string | null>(scopeKey); currentScope.current = scopeKey;
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => { currentScope.current = scopeKey; setBusy(false); setError(false); return () => { currentScope.current = null; }; }, [scopeKey]);
  const task = props.state?.pendingFollowUp;
  const cancel = async () => {
    if (!task || busy) return;
    setBusy(true); setError(false);
    try { await props.conversation().cancelFollowUp({ agentHandle: props.agentHandle as NimiLocalAppAgentHandle, conversationAnchorId: props.conversationAnchorId, taskId: task.taskId, expectedRevision: task.revision }); if (currentScope.current === scopeKey) props.refresh(); }
    catch (error) { logRendererEvent({ level: 'warn', area: 'agent-chat', message: 'action:follow-up-cancel-failed', details: { ...extractNimiErrorFields(error) } }); if (currentScope.current === scopeKey) { setError(true); props.refresh(); } }
    finally { if (currentScope.current === scopeKey) setBusy(false); }
  };
  return <div className="mx-3 my-2 text-xs text-[var(--nimi-text-secondary)]">
    <details className="mt-1">
      <summary className="cursor-pointer">{t('Chat.followUpTitle')}</summary>
      <div className="grid gap-2 py-2">
        <p>{t('Chat.followUpDescription')}</p>
        {props.state ? <>
          <p>{t(props.state.freeContactEnabled ? 'Chat.freeContactOn' : 'Chat.freeContactOff')}</p>
          <p>{t('Chat.followUpLimit', { count: props.state.maxFollowUpTurns })}</p>
          {task ? <div className="flex flex-wrap items-center gap-2"><p>{t('Chat.followUpPending', { time: new Date(Number(task.scheduledFor.seconds) * 1000).toLocaleString() })}</p><Button tone="ghost" size="sm" disabled={busy} onClick={() => { void cancel(); }}>{t('Chat.followUpCancel')}</Button></div> : <p>{t('Chat.followUpNone')}</p>}
          <p>{t('Chat.followUpStartedNotice')}</p>
        </> : <p>{t('Chat.followUpUnavailable')}</p>}
        {props.onOpenAgentCenter ? <Button tone="ghost" size="sm" onClick={props.onOpenAgentCenter}>{t('Chat.followUpManage')}</Button> : null}
        {error ? <p role="alert">{t('Chat.followUpChanged')}</p> : null}
        {!props.state || error ? <Button tone="ghost" size="sm" onClick={props.refresh}>{t('Chat.followUpRefresh')}</Button> : null}
      </div>
    </details>
  </div>;
}
