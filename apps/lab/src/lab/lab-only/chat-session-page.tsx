import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  OverlayShell,
  StatusBadge,
  TextareaField,
} from '@nimiplatform/kit/ui';
import {
  useAppAiChatSession,
  type AppAiChatError,
  type AppAiChatSessionMessage,
} from '@nimiplatform/kit/features/chat/runtime';

import type { StudioRuntimeInspection } from '../../ai-studio-core/runtime-types.js';
import { useStudioRunTargetSummary } from '../../ai-studio-core/section-ai-testing-run.js';
import { notifyStudioAIConfigChanged } from '../../ai-studio-core/ai-config.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { LabAIStudioAdapter } from '../lab-ai-studio-adapter.js';
import { labChatSessionCapability } from './capability-test-registrations.js';
import {
  LAB_CHAT_SESSION_PATH,
  fromLabChatSessionDocument,
  labChatSessionInput,
  toLabChatSessionDocument,
} from './chat-session.js';
import { LabConversationExport, LabConversationTranscript, type LabConversationDisplayMessage } from './conversation-transcript.js';
import {
  LAB_TEXT_CONVERSATION_MAX_BYTES,
  LabTextConversationTooLargeError,
  createLabObservedTextModel,
  labErrorReason,
  labErrorText,
  labTextConversationContinuity,
  labTurnFailureNotice,
  loadLabTextConversation,
  saveLabTextConversation,
  planLabTextConversation,
  type LabTextConversationDocument,
  type LabTextConversationNotice,
  type LabTextConversationRequest,
} from './text-conversation.js';

const LabAiConfigSettingsPanel = lazy(async () => ({
  default: (await import('../workbench/lab-ai-config-settings-panel.js')).LabAiConfigSettingsPanel,
}));

export function LabChatSessionPage(props: { readonly runtime: StudioRuntimeInspection | null }) {
  return (
    <LabAIStudioAdapter>
      <LabChatSessionSurface {...props} />
    </LabAIStudioAdapter>
  );
}

const kib = (bytes: number) => Math.ceil(bytes / 1024);

const displayStatus = (message: AppAiChatSessionMessage): LabConversationDisplayMessage['status'] => (
  message.status === 'streaming' ? 'generating' : message.status === 'error' ? 'failed' : message.status === 'canceled' ? 'stopped' : undefined
);

function LabChatSessionSurface({ runtime }: { readonly runtime: StudioRuntimeInspection | null }) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const registration = labChatSessionCapability;
  const runTarget = useStudioRunTargetSummary(registration, runtime);
  const client = rendererHost.sdk.localAppClient;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState<LabTextConversationDocument | null>(null);
  const [notices, setNotices] = useState<readonly LabTextConversationNotice[]>([]);
  const [lastRequest, setLastRequest] = useState<LabTextConversationRequest | null>(null);
  const [draft, setDraft] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const contextStartRef = useRef(0);
  const requestRef = useRef<ReturnType<typeof labChatSessionInput> | null>(null);
  const activeRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  // Saving starts once the saved conversation has been read (or replaced by
  // New conversation). writtenRef is the document last read or written.
  const savingAllowedRef = useRef(false);
  const writtenRef = useRef('');
  const messagesRef = useRef<readonly AppAiChatSessionMessage[]>([]);
  const resetRef = useRef<(messages?: readonly AppAiChatSessionMessage[]) => void>(() => {});

  const model = useMemo(() => createLabObservedTextModel(client.ai, (request) => {
    setLastRequest(request);
  }), [client]);

  // Saves each settled state of the session in order. A result applies only
  // while the session still holds what that save wrote.
  const persist = useCallback((messages: readonly AppAiChatSessionMessage[]) => {
    messagesRef.current = messages;
    if (!savingAllowedRef.current || messages.some((message) => message.status === 'streaming')) return;
    const document = toLabChatSessionDocument(messages, contextStartRef.current);
    const json = JSON.stringify(document);
    if (json === writtenRef.current) return;
    writtenRef.current = json;
    const current = () => !messagesRef.current.some((message) => message.status === 'streaming')
      && JSON.stringify(toLabChatSessionDocument(messagesRef.current, contextStartRef.current)) === json;
    saveLabTextConversation(client.storage, document, LAB_CHAT_SESSION_PATH).then((stored) => {
      if (!current()) return;
      setSaved(stored);
    }, (error: unknown) => {
      if (!current()) return;
      setNotices((list) => [...list, error instanceof LabTextConversationTooLargeError
        ? { type: 'turn-too-large', bytes: error.bytes }
        : { type: 'save-failed', detail: labErrorText(error) }]);
    });
  }, [client]);

  const onError = useCallback((error: AppAiChatError) => {
    setNotices([labTurnFailureNotice(labErrorReason(error), labErrorText(error))]);
  }, []);

  const session = useAppAiChatSession({
    model,
    resolveRequest: () => {
      if (!requestRef.current) throw new Error('The conversation request has not been prepared.');
      return { input: requestRef.current };
    },
    onMessagesChange: persist,
    onError,
  });
  resetRef.current = session.resetMessages;

  useEffect(() => {
    let active = true;
    activeRef.current = true;
    savingAllowedRef.current = false;
    loadLabTextConversation(client.storage, LAB_CHAT_SESSION_PATH).then((document) => {
      if (!active) return;
      writtenRef.current = JSON.stringify(document);
      savingAllowedRef.current = true;
      setSaved(document);
      contextStartRef.current = document.contextStart ?? 0;
      resetRef.current(fromLabChatSessionDocument(document));
      setLoaded(true);
    }, (error: unknown) => {
      if (!active) return;
      setLoadError(labErrorText(error));
      setLoaded(true);
    });
    return () => {
      active = false;
      activeRef.current = false;
    };
  }, [client]);

  const busy = session.isStreaming || preparing || switching;
  const blocked = !loaded || !!loadError;
  const savedContinuity = labTextConversationContinuity(saved?.messages ?? []);
  const displayed: readonly LabConversationDisplayMessage[] = session.messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.content,
    ...(displayStatus(message) ? { status: displayStatus(message) } : {}),
  }));

  const send = () => {
    const prompt = draft.trim();
    if (!prompt || busy || blocked || !runTarget.canDispatch) return;
    setPreparing(true);
    void (async () => {
      try {
        const document = toLabChatSessionDocument(messagesRef.current, contextStartRef.current);
        const snapshot = await client.aiConfig.get();
        if (!activeRef.current) return;
        const plan = planLabTextConversation(document, snapshot);
        if (plan.continuity === 'reset') {
          const stored = await saveLabTextConversation(client.storage, plan.document, LAB_CHAT_SESSION_PATH);
          if (!activeRef.current) return;
          contextStartRef.current = plan.contextStart;
          writtenRef.current = JSON.stringify(stored);
          setSaved(stored);
        }
        requestRef.current = [
          ...plan.history.map((message) => ({ role: message.role, content: message.text, ...(message.outputItems ? { outputItems: message.outputItems } : {}) })),
          { role: 'user', content: prompt },
        ];
        setDraft('');
        setNotices(plan.continuity === 'reset' ? [{ type: 'context-reset' }] : []);
        setLastRequest(null);
        setPreparing(false);
        await session.sendPrompt(prompt);
      } catch (error) {
        if (activeRef.current) setNotices([{ type: 'turn-failed', code: labErrorReason(error), detail: labErrorText(error) }]);
      } finally {
        if (activeRef.current) setPreparing(false);
      }
    })();
  };

  const startOver = () => {
    contextStartRef.current = 0;
    savingAllowedRef.current = true;
    setLoadError('');
    setNotices([]);
    setLastRequest(null);
    session.resetMessages([]);
  };

  const noticeText = (notice: LabTextConversationNotice) => {
    switch (notice.type) {
      case 'turn-failed': return t('CapabilityTests.textConversation.turnFailed', { code: notice.code, detail: notice.detail });
      case 'turn-too-large': return t('CapabilityTests.textConversation.turnTooLarge', { size: kib(notice.bytes), limit: kib(LAB_TEXT_CONVERSATION_MAX_BYTES) });
      case 'save-failed': return t('CapabilityTests.textConversation.saveFailed', { detail: notice.detail });
      case 'context-reset': return t('CapabilityTests.textConversation.contextReset');
    }
  };

  return (
    <div ref={rootRef} className="lab-realtime lab-conversation" data-testid="lab-chat-session">
      <header className="lab-realtime__head">
        <div>
          <h1>{t('CapabilityTests.chatSession.title')}</h1>
          <p>{t('CapabilityTests.chatSession.intro')}</p>
        </div>
        <div className="lab-realtime__head-actions">
          <StatusBadge tone={runTarget.canDispatch ? 'success' : 'warning'} shape="dot">{runTarget.intentLabel}</StatusBadge>
          <Button type="button" size="sm" tone="secondary" disabled={preparing || switching} onClick={async () => {
            setSwitching(true);
            try {
              const settled = await session.cancelAndWait();
              const document = toLabChatSessionDocument(settled, contextStartRef.current);
              const stored = await saveLabTextConversation(client.storage, document, LAB_CHAT_SESSION_PATH);
              writtenRef.current = JSON.stringify(stored);
              setSaved(stored);
              setConfigOpen(true);
            } catch (error) {
              setNotices([{ type: 'save-failed', detail: labErrorText(error) }]);
            } finally { setSwitching(false); }
          }}>{t(session.isStreaming ? 'CapabilityTests.textConversation.stopAndConfigure' : 'CapabilityTests.textConversation.configure')}</Button>
        </div>
      </header>
      {!runTarget.canDispatch ? <InlineAlert tone="warning">{runTarget.detail}</InlineAlert> : null}
      {loadError ? <InlineAlert tone="danger">{t('CapabilityTests.textConversation.loadFailed', { detail: loadError })}</InlineAlert> : null}

      <LabConversationTranscript messages={displayed} loading={!loaded} />

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.textConversation.composer')}>
        {contextStartRef.current > 0 ? <InlineAlert tone="info">{t('CapabilityTests.textConversation.contextReset')}</InlineAlert> : null}
        <TextareaField
          rows={3}
          value={draft}
          disabled={busy || blocked}
          placeholder={t('CapabilityTests.textConversation.placeholder')}
          aria-label={t('CapabilityTests.textConversation.composer')}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <div className="lab-realtime__row">
          <Button type="button" size="sm" tone="primary" disabled={!draft.trim() || busy || blocked || !runTarget.canDispatch} onClick={send}>
            {t('CapabilityTests.textConversation.send')}
          </Button>
          <Button type="button" size="sm" tone="secondary" disabled={!session.canCancel} onClick={session.cancelCurrent}>
            {t('CapabilityTests.textConversation.stop')}
          </Button>
          <Button type="button" size="sm" tone="ghost" disabled={!loaded || preparing || switching} onClick={startOver}>
            {t('CapabilityTests.textConversation.startOver')}
          </Button>
        </div>
        {notices.filter((notice) => notice.type !== 'context-reset').map((notice) => (
          <InlineAlert key={notice.type} tone="warning">{noticeText(notice)}</InlineAlert>
        ))}
        <LabConversationExport document={loaded && !busy ? toLabChatSessionDocument(session.messages, contextStartRef.current) : null}
          disabled={busy || blocked} filename="lab-chat-session.json" />
      </section>

      <details className="lab-realtime__card">
        <summary>{t('CapabilityTests.textConversation.details')}</summary>
        <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.surface')}: <code>{registration.runtimeMethod}</code></p>
        <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.savedContinuity', { items: savedContinuity.items, bytes: savedContinuity.bytes })}</p>
        {lastRequest ? (
          <p className="lab-realtime__meta" data-testid="lab-chat-session-last-request">
            {t('CapabilityTests.textConversation.lastRequest', lastRequest)}
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
              capabilityId="text.chat-session"
              onCommitted={() => notifyStudioAIConfigChanged(rootRef.current ?? window)}
            />
          ) : null}
        </Suspense>
      </OverlayShell>
    </div>
  );
}
