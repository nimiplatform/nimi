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
import {
  EMPTY_LAB_TEXT_CONVERSATION,
  labTextConversationContinuity,
  labTextConversationHistory,
  loadLabTextConversation,
  runLabTextConversationTurn,
  saveLabTextConversation,
  type LabTextConversationDocument,
  type LabTextConversationMessage,
} from './text-conversation.js';

const LabAiConfigSettingsPanel = lazy(async () => ({
  default: (await import('../workbench/lab-ai-config-settings-panel.js')).LabAiConfigSettingsPanel,
}));

type LastRequest = { readonly messages: number; readonly items: number; readonly bytes: number };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LabTextConversationPage(props: { readonly runtime: StudioRuntimeInspection | null }) {
  return (
    <LabAIStudioAdapter>
      <LabTextConversationSurface {...props} />
    </LabAIStudioAdapter>
  );
}

function LabTextConversationSurface({ runtime }: { readonly runtime: StudioRuntimeInspection | null }) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const registration = labTextConversationCapability;
  const runTarget = useStudioRunTargetSummary(registration, runtime);
  const client = rendererHost.sdk.localAppClient;
  const [conversation, setConversation] = useState<LabTextConversationDocument | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ readonly userText: string; readonly text: string } | null>(null);
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    loadLabTextConversation(client.storage).then(
      (document) => { if (active) setConversation(document); },
      (error: unknown) => {
        if (!active) return;
        setLoadError(errorText(error));
        setConversation(EMPTY_LAB_TEXT_CONVERSATION);
      },
    );
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [client]);

  const now = () => new Date(rendererHost.clock.now()).toISOString();

  const save = async (next: LabTextConversationDocument) => {
    try {
      setConversation(await saveLabTextConversation(client.storage, next));
    } catch (error) {
      setConversation(next);
      setNotice(t('CapabilityTests.textConversation.saveFailed', { detail: errorText(error) }));
    }
  };

  const send = async () => {
    const userText = draft.trim();
    if (!userText || !conversation || pending || loadError || !runTarget.canDispatch) return;
    const history = labTextConversationHistory(conversation.messages);
    const returned = labTextConversationContinuity(history);
    setLastRequest({ messages: history.length, ...returned });
    const turnId = createNimiClientId('lab-conversation');
    const question: LabTextConversationMessage = { id: `${turnId}:user`, role: 'user', text: userText, createdAt: now() };
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft('');
    setNotice('');
    setPending({ userText, text: '' });
    const turn = await runLabTextConversationTurn({
      ai: client.ai,
      history,
      userText,
      turnId,
      signal: controller.signal,
      onText: (text) => setPending({ userText, text }),
    });
    abortRef.current = null;
    const answer: LabTextConversationMessage = {
      id: `${turnId}:assistant`,
      role: 'assistant',
      text: turn.text,
      createdAt: now(),
      ...(turn.status === 'completed'
        ? (turn.outputItems ? { outputItems: turn.outputItems } : {})
        : { status: turn.status, ...(turn.status === 'failed' ? { reasonCode: turn.reasonCode } : {}) }),
    };
    if (turn.status === 'failed') {
      // Runtime refuses continuity the selected route cannot accept before
      // anything is sent; the saved conversation stays as it was.
      const refusedContinuity = returned.items > 0
        && ['AI_TEXT_BEHAVIOR_UNSUPPORTED', 'AI_INPUT_INVALID'].includes(turn.reasonCode.replaceAll('-', '_').toUpperCase());
      setNotice(refusedContinuity
        ? t('CapabilityTests.textConversation.continuityRefused', { code: turn.reasonCode })
        : t('CapabilityTests.textConversation.turnFailed', { code: turn.reasonCode, detail: turn.message }));
    }
    setPending(null);
    await save({ version: 1, messages: [...conversation.messages, question, answer] });
  };

  const startOver = async () => {
    abortRef.current?.abort();
    setLoadError('');
    setNotice('');
    setLastRequest(null);
    await save(EMPTY_LAB_TEXT_CONVERSATION);
  };

  const messages = conversation?.messages ?? [];
  const saved = labTextConversationContinuity(messages);

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

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.textConversation.transcript')}>
        {conversation === null ? <LoadingSkeleton lines={3} label={t('Common.loading')} /> : null}
        {conversation !== null && messages.length === 0 && !pending ? <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.empty')}</p> : null}
        <ol className="lab-conversation__messages">
          {messages.map((message) => (
            <li key={message.id} className={`lab-conversation__message lab-conversation__message--${message.role}`}>
              <span className="lab-conversation__role">
                {t(message.role === 'user' ? 'CapabilityTests.textConversation.you' : 'CapabilityTests.textConversation.assistant')}
                {message.status ? (
                  <StatusBadge tone={message.status === 'failed' ? 'danger' : 'neutral'} shape="dot">
                    {t(`CapabilityTests.textConversation.${message.status}`)}
                    {message.reasonCode ? ` · ${message.reasonCode}` : ''}
                  </StatusBadge>
                ) : null}
              </span>
              <p className="lab-conversation__text">{message.text || '…'}</p>
            </li>
          ))}
          {pending ? (
            <>
              <li className="lab-conversation__message lab-conversation__message--user">
                <span className="lab-conversation__role">{t('CapabilityTests.textConversation.you')}</span>
                <p className="lab-conversation__text">{pending.userText}</p>
              </li>
              <li className="lab-conversation__message lab-conversation__message--assistant">
                <span className="lab-conversation__role">
                  {t('CapabilityTests.textConversation.assistant')}
                  <StatusBadge tone="info" shape="dot">{t('CapabilityTests.textConversation.generating')}</StatusBadge>
                </span>
                <p className="lab-conversation__text">{pending.text || '…'}</p>
              </li>
            </>
          ) : null}
        </ol>
      </section>

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.textConversation.composer')}>
        <TextareaField
          rows={3}
          value={draft}
          disabled={!!pending || conversation === null || !!loadError}
          placeholder={t('CapabilityTests.textConversation.placeholder')}
          aria-label={t('CapabilityTests.textConversation.composer')}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <div className="lab-realtime__row">
          <Button type="button" size="sm" tone="primary"
            disabled={!draft.trim() || !!pending || conversation === null || !!loadError || !runTarget.canDispatch}
            onClick={() => void send()}>
            {t('CapabilityTests.textConversation.send')}
          </Button>
          <Button type="button" size="sm" tone="secondary" disabled={!pending} onClick={() => abortRef.current?.abort()}>
            {t('CapabilityTests.textConversation.stop')}
          </Button>
          <Button type="button" size="sm" tone="ghost" disabled={conversation === null} onClick={() => void startOver()}>
            {t('CapabilityTests.textConversation.startOver')}
          </Button>
        </div>
        {notice ? <InlineAlert tone="warning">{notice}</InlineAlert> : null}
      </section>

      <details className="lab-realtime__card">
        <summary>{t('CapabilityTests.textConversation.details')}</summary>
        <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.surface')}: <code>{registration.runtimeMethod}</code></p>
        <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.savedContinuity', { items: saved.items, bytes: saved.bytes })}</p>
        {lastRequest ? (
          <p className="lab-realtime__meta" data-testid="lab-text-conversation-last-request">
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
              capabilityId="text.conversation"
              onCommitted={() => notifyStudioAIConfigChanged(rootRef.current ?? window)}
            />
          ) : null}
        </Suspense>
      </OverlayShell>
    </div>
  );
}
