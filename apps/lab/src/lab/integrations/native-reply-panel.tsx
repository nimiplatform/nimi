import { useEffect, useRef, useState } from 'react';
import type { NimiIntegrationCall, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useLabRendererHost } from '../../renderer/context.js';
import { subscribeLabLocalAppSessionLoss } from '../../shell/auth/session-loss.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { getLabCapability } from '../lab-capabilities.js';
import { loadLabAIConfig } from '../lab-ai-config-store.js';
import { createLabRunTargetSummary } from '../lab-run-target.js';
import { createNativeReplyController, INITIAL_NATIVE_REPLY_STATE, nativeReplyPrompt, type NativeReplyController } from './native-reply-controller.js';
import type { NativeEvent } from './native-message-model.js';
import { NativeMessageContent } from './native-message-content.js';
import type { StudioRunHistoryRecord } from '../../ai-studio-core/history.js';

export function NativeReplyPanel({ target, event, externalBusy, setBusy, recordAI, recordCall }: {
  target: NimiIntegrationTarget; event: NativeEvent | null; externalBusy: boolean;
  setBusy: (busy: boolean) => void;
  recordCall: (inputJson: string, call: NimiIntegrationCall) => Promise<void>;
  recordAI: (record: StudioRunHistoryRecord) => Promise<void>;
}) {
  const host = useLabRendererHost(); const { t } = useTranslation();
  const [state, setState] = useState(INITIAL_NATIVE_REPLY_STATE);
  const [saveBodies, setSaveBodies] = useState(false);
  const controller = useRef<NativeReplyController | null>(null);
  const currentHost = useRef(host); currentHost.current = host;
  const callbacks = useRef({ setBusy, recordAI, recordCall }); callbacks.current = { setBusy, recordAI, recordCall };
  const available = target.available && target.permittedOperations.includes(`${target.kind}.messages.reply`);
  let hasText = false;
  if (event) { try { nativeReplyPrompt(event); hasText = true; } catch { /* The UI reports the actual text prerequisite below. */ } }
  useEffect(() => {
    setState(INITIAL_NATIVE_REPLY_STATE); setSaveBodies(false);
    if (!event) return;
    const session = createNativeReplyController({
      targetRef: target.targetRef, adapter: target.kind, event,
      currentScope: () => currentHost.current === host,
      authStatus: () => host.sdk.localAppClient.auth.status(),
      prepareAI: async () => {
        const [config, summary, identity] = await Promise.all([
          loadLabAIConfig(host.sdk.aiConfig), host.app.projection.aiConfigSummary(), host.app.commands.nextRunIdentity(),
        ]);
        const runTarget = createLabRunTargetSummary({ capability: getLabCapability('chat.stream'), runtime: summary.runtime, config: config.config, configState: 'loaded' });
        if (!runTarget.canDispatch) throw new Error(t('Integrations.replyAI.configRequired', { detail: runTarget.detail }));
        return { ...identity, runConfig: { target: runTarget, promptControls: { contextAttached: true, attachmentCount: 0 } } };
      },
      generate: request => host.sdk.runCapability(request),
      recordAI: record => callbacks.current.recordAI(record),
      integration: host.sdk.localAppClient.integration,
      recordIntegration: (inputJson, call) => callbacks.current.recordCall(inputJson, call),
      onState: next => {
        if (controller.current !== session) return;
        setState(next); callbacks.current.setBusy(next.phase === 'generating' || next.phase === 'sending');
      },
    });
    controller.current = session;
    const unsubscribe = subscribeLabLocalAppSessionLoss(() => session.invalidateScope());
    return () => {
      if (controller.current === session) controller.current = null;
      callbacks.current.setBusy(false);
      // Keep observing loss while an issued call drains, so its fact cannot be
      // persisted into a newly admitted scope after leaving this page.
      void session.dispose().finally(unsubscribe);
    };
  }, [host, event, target.targetRef, target.kind]);
  const busy = state.phase === 'generating' || state.phase === 'sending';
  return <section className="rounded-xl border border-[var(--nimi-border-subtle)] p-4" data-testid="native-reply-panel">
    <h3 className="font-semibold">{t('Integrations.replyAI.title')}</h3>
    <p className="mt-2 text-sm">{t('Integrations.replyAI.description')}</p>
    {event ? <p className="mt-2 break-all text-sm">{event.conversation.kind}:{event.conversation.id} · {event.messageId || event.eventId}</p> : <p className="mt-2 text-sm">{t('Integrations.selectReceived')}</p>}
    {event ? <NativeMessageContent event={event} mediaDisabled/> : null}
    {event && !hasText ? <InlineAlert tone="info">{t('Integrations.replyAI.textRequired')}</InlineAlert> : null}
    <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={saveBodies} disabled={busy || externalBusy} onChange={event => setSaveBodies(event.target.checked)}/>{t('Integrations.replyAI.saveBodies')}</label>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button disabled={busy || externalBusy || !hasText || !available || state.scopeEnded} onClick={() => { void controller.current?.generate(saveBodies); }}>{t('Integrations.replyAI.generate')}</Button>
      <Button tone="secondary" disabled={externalBusy || (!busy && state.phase !== 'draft')} onClick={() => controller.current?.stop()}>{t('Integrations.replyAI.stop')}</Button>
    </div>
    {state.phase !== 'idle' ? <p className="mt-3 text-sm" role="status">{t(`Integrations.replyAI.phases.${state.phase}`)}</p> : null}
    {state.error ? <InlineAlert tone="warning">{t(`Integrations.errors.${state.error}`, { defaultValue: state.error })}</InlineAlert> : null}
    {state.phase === 'draft' ? <>
      <label className="mt-3 block text-sm">{t('Integrations.replyAI.review')}<textarea className="mt-1 min-h-28 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-sm" value={state.draft} maxLength={32768} disabled={externalBusy} onChange={event => controller.current?.editDraft(event.target.value)}/></label>
      <Button className="mt-3" disabled={externalBusy || !available || !state.draft.trim()} onClick={() => { void controller.current?.send(); }}>{t('Integrations.replyAI.send')}</Button>
    </> : null}
    {state.aiRecord ? <p className="mt-3 break-all text-xs">{t('Integrations.replyAI.aiFact', { id: state.aiRecord.id, status: state.aiRecord.status, trace: state.aiRecord.runConfig?.traceId || '' })}</p> : null}
    {state.integrationCall ? <p className="mt-2 break-all text-xs">{t('Integrations.replyAI.integrationFact', { id: state.integrationCall.callId, status: t(`Integrations.states.${state.integrationCall.status}`) })}</p> : null}
    <p className="mt-3 text-xs">{t('Integrations.replyAI.factBoundary')}</p>
  </section>;
}
