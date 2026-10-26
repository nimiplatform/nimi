import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { extractNimiErrorFields } from '@nimiplatform/kit/core/sdk-contract';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { Clock3 } from 'lucide-react';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient, NimiLocalAppConversationState } from '@nimiplatform/kit/core/sdk-contract';

// @nimi-authority: rule.nimi.runtime.agent-participation.proactive-controls
export function LocalAppConversationFollowUpControl(props: {
  translate: (key: string, values?: Record<string, string | number>) => string;
  agentHandle: string;
  conversationAnchorId: string;
  state: NimiLocalAppConversationState | null;
  conversation: () => NimiLocalAppConversationClient;
  refresh: () => void;
  onOpenAgentCenter?: () => void;
}) {
  const task = props.state?.pendingFollowUp;
  const t = props.translate;
  const scopeKey = `${props.agentHandle}|${props.conversationAnchorId}|${task?.taskId ?? ''}|${task?.revision ?? ''}`;
  const currentScope = useRef<string | null>(scopeKey); currentScope.current = scopeKey;
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => { currentScope.current = scopeKey; setBusy(false); setError(false); return () => { currentScope.current = null; }; }, [scopeKey]);
  const cancel = async () => {
    if (!task || busy) return;
    setBusy(true); setError(false);
    try { await props.conversation().cancelFollowUp({ agentHandle: props.agentHandle as NimiLocalAppAgentHandle, conversationAnchorId: props.conversationAnchorId, taskId: task.taskId, expectedRevision: task.revision }); if (currentScope.current === scopeKey) props.refresh(); }
    catch (error) { logRendererEvent({ level: 'warn', area: 'agent-chat', message: 'action:follow-up-cancel-failed', details: { ...extractNimiErrorFields(error) } }); if (currentScope.current === scopeKey) { setError(true); props.refresh(); } }
    finally { if (currentScope.current === scopeKey) setBusy(false); }
  };
  // Policy belongs to AgentCenter. The conversation shows only actionable work
  // or an observation failure, never an idle settings panel beneath every draft.
  if (props.state && !task && !error) return null;
  return <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-secondary)]">
    {task ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p role="status" className="flex min-w-0 flex-1 items-center gap-2">
        <Clock3 size={16} className="shrink-0" aria-hidden="true" />
        {t('Chat.followUpPending', { time: new Date(Number(task.scheduledFor.seconds) * 1000).toLocaleString() })}
      </p>
      <Button tone="ghost" size="sm" disabled={busy} onClick={() => { void cancel(); }}>{t('Chat.followUpCancel')}</Button>
    </div> : null}
    {!props.state ? <p role="status">{t('Chat.followUpUnavailable')}</p> : null}
    {error ? <p role="alert">{t('Chat.followUpChanged')}</p> : null}
    {!props.state || error ? <div className="mt-1 flex flex-wrap gap-2">
      <Button tone="ghost" size="sm" onClick={props.refresh}>{t('Chat.followUpRefresh')}</Button>
      {props.onOpenAgentCenter ? <Button tone="ghost" size="sm" onClick={props.onOpenAgentCenter}>{t('Chat.followUpManage')}</Button> : null}
    </div> : null}
  </div>;
}
