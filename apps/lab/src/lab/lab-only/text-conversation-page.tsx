import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  OverlayShell,
  StatusBadge,
  TextareaField,
} from '@nimiplatform/kit/ui';
import { createNimiClientId } from '@nimiplatform/sdk';

import type { StudioRuntimeInspection } from '../../ai-studio-core/runtime-types.js';
import { useStudioRunTargetSummary } from '../../ai-studio-core/section-ai-testing-run.js';
import { notifyStudioAIConfigChanged } from '../../ai-studio-core/ai-config.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { LabAIStudioAdapter } from '../lab-ai-studio-adapter.js';
import { labTextConversationCapability } from './capability-test-registrations.js';
import { LabConversationTranscript, type LabConversationDisplayMessage } from './conversation-transcript.js';
import {
  INITIAL_LAB_TEXT_CONVERSATION_STATE,
  LAB_TEXT_CONVERSATION_MAX_BYTES,
  createLabTextConversationController,
  labTextConversationContinuity,
  type LabTextConversationController,
  type LabTextConversationNotice,
  type LabTextConversationState,
} from './text-conversation.js';

const LabAiConfigSettingsPanel = lazy(async () => ({
  default: (await import('../workbench/lab-ai-config-settings-panel.js')).LabAiConfigSettingsPanel,
}));

export function LabTextConversationPage(props: { readonly runtime: StudioRuntimeInspection | null }) {
  return (
    <LabAIStudioAdapter>
      <LabTextConversationSurface {...props} />
    </LabAIStudioAdapter>
  );
}

const kib = (bytes: number) => Math.ceil(bytes / 1024);

function LabTextConversationSurface({ runtime }: { readonly runtime: StudioRuntimeInspection | null }) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const registration = labTextConversationCapability;
  const runTarget = useStudioRunTargetSummary(registration, runtime);
  const client = rendererHost.sdk.localAppClient;
  const clock = rendererHost.clock;
  const [session, setSession] = useState<LabTextConversationController | null>(null);
  const [state, setState] = useState<LabTextConversationState>(INITIAL_LAB_TEXT_CONVERSATION_STATE);
  const [draft, setDraft] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = createLabTextConversationController({
      storage: client.storage,
      ai: client.ai,
      now: () => new Date(clock.now()).toISOString(),
      createTurnId: () => createNimiClientId('lab-conversation'),
      onState: setState,
    });
    setSession(controller);
    setState(controller.getState());
    void controller.load();
    // Closing the page stops a reply still streaming; it is not saved.
    return () => controller.dispose();
  }, [client, clock]);

  const { conversation, pending, saving, loadError, lastRequest, notices } = state;
  const busy = !!pending || saving;
  const messages = conversation?.messages ?? [];
  const saved = labTextConversationContinuity(state.saved?.messages ?? []);
  const displayed: readonly LabConversationDisplayMessage[] = [
    ...messages,
    ...(pending ? [
      { id: 'pending:user', role: 'user' as const, text: pending.userText },
      { id: 'pending:assistant', role: 'assistant' as const, text: pending.text, status: 'generating' as const },
    ] : []),
  ];

  const send = () => {
    if (!runTarget.canDispatch || !session?.send(draft)) return;
    setDraft('');
  };

  const noticeText = (notice: LabTextConversationNotice) => {
    switch (notice.type) {
      case 'turn-failed': return t('CapabilityTests.textConversation.turnFailed', { code: notice.code, detail: notice.detail });
      case 'continuity-refused': return t('CapabilityTests.textConversation.continuityRefused', { code: notice.code });
      case 'turn-too-large': return t('CapabilityTests.textConversation.turnTooLarge', { size: kib(notice.bytes), limit: kib(LAB_TEXT_CONVERSATION_MAX_BYTES) });
      case 'trimmed': return t('CapabilityTests.textConversation.trimmed', { messages: notice.messages, limit: kib(LAB_TEXT_CONVERSATION_MAX_BYTES) });
      case 'save-failed': return t('CapabilityTests.textConversation.saveFailed', { detail: notice.detail });
    }
  };

  return (
    <div ref={rootRef} className="lab-realtime lab-conversation" data-testid="lab-text-conversation">
      <header className="lab-realtime__head">
        <div>
          <h1>{t('CapabilityTests.textConversation.title')}</h1>
          <p>{t('CapabilityTests.textConversation.intro')}</p>
        </div>
        <div className="lab-realtime__head-actions">
          <StatusBadge tone={runTarget.canDispatch ? 'success' : 'warning'} shape="dot">{runTarget.intentLabel}</StatusBadge>
          <Button type="button" size="sm" tone="secondary" onClick={() => setConfigOpen(true)}>{t('CapabilityTests.textConversation.configure')}</Button>
        </div>
      </header>
      {!runTarget.canDispatch ? <InlineAlert tone="warning">{runTarget.detail}</InlineAlert> : null}
      {loadError ? <InlineAlert tone="danger">{t('CapabilityTests.textConversation.loadFailed', { detail: loadError })}</InlineAlert> : null}

      <LabConversationTranscript messages={displayed} loading={conversation === null} />

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.textConversation.composer')}>
        <TextareaField
          rows={3}
          value={draft}
          disabled={busy || conversation === null || !!loadError}
          placeholder={t('CapabilityTests.textConversation.placeholder')}
          aria-label={t('CapabilityTests.textConversation.composer')}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <div className="lab-realtime__row">
          <Button type="button" size="sm" tone="primary"
            disabled={!draft.trim() || busy || conversation === null || !!loadError || !runTarget.canDispatch}
            onClick={send}>
            {t('CapabilityTests.textConversation.send')}
          </Button>
          <Button type="button" size="sm" tone="secondary" disabled={!pending} onClick={() => session?.stop()}>
            {t('CapabilityTests.textConversation.stop')}
          </Button>
          <Button type="button" size="sm" tone="ghost" disabled={conversation === null} onClick={() => void session?.startOver()}>
            {t('CapabilityTests.textConversation.startOver')}
          </Button>
        </div>
        {notices.map((notice) => (
          <InlineAlert key={notice.type} tone={notice.type === 'trimmed' ? 'info' : 'warning'}>{noticeText(notice)}</InlineAlert>
        ))}
      </section>

      <details className="lab-realtime__card">
        <summary>{t('CapabilityTests.textConversation.details')}</summary>
        <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.surface')}: <code>{registration.runtimeMethod}</code></p>
        <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.savedContinuity', { items: saved.items, bytes: saved.bytes })}</p>
        {lastRequest ? (
          <p className="lab-realtime__meta" data-testid="lab-text-conversation-last-request">
            {t('CapabilityTests.textConversation.lastRequest', lastRequest)}
            {lastRequest.omitted > 0 ? ` ${t('CapabilityTests.textConversation.windowOmitted', { omitted: lastRequest.omitted })}` : ''}
          </p>
        ) : null}
        <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.continuityNote')}</p>
      </details>

      <OverlayShell
        open={configOpen}
        kind="drawer"
        size="M"
        title={t('StudioModelConfig.drawerTitle')}
        panelClassName="flex flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto p-0"
        onClose={() => {
          setConfigOpen(false);
          if (rootRef.current) notifyStudioAIConfigChanged(rootRef.current);
        }}
      >
        <Suspense fallback={<div className="p-5"><LoadingSkeleton lines={4} label={t('Common.loading')} /></div>}>
          {configOpen ? (
            <LabAiConfigSettingsPanel
              runtime={runtime}
              capabilityId="text.conversation"
              onCommitted={() => notifyStudioAIConfigChanged(rootRef.current ?? window)}
            />
          ) : null}
        </Suspense>
      </OverlayShell>
    </div>
  );
}
