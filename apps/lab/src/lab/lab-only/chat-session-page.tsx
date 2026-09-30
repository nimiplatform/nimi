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
import { LabConversationTranscript, type LabConversationDisplayMessage } from './conversation-transcript.js';
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
  const rootRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<LabTextConversationRequest | null>(null);
  // Saving starts once the saved conversation has been read (or replaced by
  // New conversation). writtenRef is the document last read or written.
  const savingAllowedRef = useRef(false);
  const writtenRef = useRef('');
  const messagesRef = useRef<readonly AppAiChatSessionMessage[]>([]);
  const resetRef = useRef<(messages?: readonly AppAiChatSessionMessage[]) => void>(() => {});

  const model = useMemo(() => createLabObservedTextModel(client.ai, (request) => {
    sentRef.current = request;
    setLastRequest(request);
  }), [client]);

  // Saves each settled state of the session in order. A result applies only
  // while the session still holds what that save wrote.
  const persist = useCallback((messages: readonly AppAiChatSessionMessage[]) => {
    messagesRef.current = messages;
    if (!savingAllowedRef.current || messages.some((message) => message.status === 'streaming')) return;
    const document = toLabChatSessionDocument(messages);
    const json = JSON.stringify(document);
    if (json === writtenRef.current) return;
    writtenRef.current = json;
    const current = () => !messagesRef.current.some((message) => message.status === 'streaming')
      && JSON.stringify(toLabChatSessionDocument(messagesRef.current)) === json;
    saveLabTextConversation(client.storage, document, LAB_CHAT_SESSION_PATH).then((stored) => {
      if (!current()) return;
      setSaved(stored);
      const trimmed = document.messages.length - stored.messages.length;
      if (trimmed > 0) {
        writtenRef.current = JSON.stringify(stored);
        setNotices((list) => [...list, { type: 'trimmed', messages: trimmed }]);
        resetRef.current(fromLabChatSessionDocument(stored));
      }
    }, (error: unknown) => {
      if (!current()) return;
      setNotices((list) => [...list, error instanceof LabTextConversationTooLargeError
        ? { type: 'turn-too-large', bytes: error.bytes }
        : { type: 'save-failed', detail: labErrorText(error) }]);
    });
  }, [client]);

  const onError = useCallback((error: AppAiChatError) => {
    setNotices([labTurnFailureNotice(labErrorReason(error), labErrorText(error), sentRef.current)]);
  }, []);

  const session = useAppAiChatSession({
    model,
    resolveRequest: ({ prompt, messages }) => ({ input: labChatSessionInput(messages, prompt) }),
    onMessagesChange: persist,
    onError,
  });
  resetRef.current = session.resetMessages;

  useEffect(() => {
    let active = true;
    savingAllowedRef.current = false;
    loadLabTextConversation(client.storage, LAB_CHAT_SESSION_PATH).then((document) => {
      if (!active) return;
      writtenRef.current = JSON.stringify(document);
      savingAllowedRef.current = true;
      setSaved(document);
      resetRef.current(fromLabChatSessionDocument(document));
      setLoaded(true);
    }, (error: unknown) => {
      if (!active) return;
      setLoadError(labErrorText(error));
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [client]);

  const busy = session.isStreaming;
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
    setDraft('');
    setNotices([]);
    setLastRequest(null);
    sentRef.current = null;
    void session.sendPrompt(prompt);
  };

  const startOver = () => {
    savingAllowedRef.current = true;
    setLoadError('');
    setNotices([]);
    setLastRequest(null);
    sentRef.current = null;
    session.resetMessages([]);
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
    <div ref={rootRef} className="lab-realtime lab-conversation" data-testid="lab-chat-session">
      <header className="lab-realtime__head">
        <div>
          <h1>{t('CapabilityTests.chatSession.title')}</h1>
          <p>{t('CapabilityTests.chatSession.intro')}</p>
        </div>
        <div className="lab-realtime__head-actions">
          <StatusBadge tone={runTarget.canDispatch ? 'success' : 'warning'} shape="dot">{runTarget.intentLabel}</StatusBadge>
          <Button type="button" size="sm" tone="secondary" onClick={() => setConfigOpen(true)}>{t('CapabilityTests.textConversation.configure')}</Button>
        </div>
      </header>
      {!runTarget.canDispatch ? <InlineAlert tone="warning">{runTarget.detail}</InlineAlert> : null}
      {loadError ? <InlineAlert tone="danger">{t('CapabilityTests.textConversation.loadFailed', { detail: loadError })}</InlineAlert> : null}

      <LabConversationTranscript messages={displayed} loading={!loaded} />

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.textConversation.composer')}>
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
          <Button type="button" size="sm" tone="ghost" disabled={!loaded} onClick={startOver}>
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
