import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, MessagesSquare } from 'lucide-react';
import type { NimiLocalAppAgentHandle, } from '@nimiplatform/kit/core/sdk-contract';
import { Avatar, Button, InlineAlert, LoadingSkeleton, Surface, cn } from '@nimiplatform/kit/ui';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ChatCopy } from '../copy.js';
import type { ConversationCanonicalMessage } from '../types.js';
import {
  createAppConversationEntrySession,
  type AppConversationEntryClient,
  type AppConversationEntrySession,
  type AppConversationEntryState,
  type AppConversationHostPort,
} from '../headless/app-conversation-entry-session.js';
import { CanonicalComposer } from './canonical-composer.js';
import { CanonicalTranscriptView } from './canonical-transcript-view.js';

export type AppConversationEntryProps = Readonly<{
  client: AppConversationEntryClient;
  hostPort: AppConversationHostPort;
  language?: string | null;
  className?: string;
}>;

type AppConversationEntryCopy = Readonly<{
  title: string;
  description: string;
  back: string;
  loadingReferences: string;
  empty: string;
  select: string;
  opening: string;
  retry: string;
  reload: string;
  composerPlaceholder: string;
  send: string;
  playVoice: string;
  attachImage: string;
  recordVoice: string;
  stopRecording: string;
  removeAttachment: string;
  pendingAttachment: (name: string) => string;
  stopTurn: string;
  transcriptLoading: string;
  transcriptEmptyEyebrow: string;
  transcriptEmptyTitle: string;
  transcriptEmptyDescription: string;
  requestIdUnavailable: string;
  reuseInput: string;
  preserveDraft: string;
  conversationSettings: string;
  conversationSettingsUnavailable: string;
  controlNotSaved:string;
  regenerateExplanation: string;
  chatCopy: ChatCopy;
}>;

export const APP_CONVERSATION_ENTRY_COPY = Object.freeze({
  en: Object.freeze<AppConversationEntryCopy>({
    title: 'Agent Conversation',
    description: 'Choose a partner to pick up where you left off, or start a new conversation.',
    back: 'All partners',
    loadingReferences: 'Loading current Agents…',
    empty: 'No current Agent is available for this App session.',
    select: 'Open Conversation',
    opening: 'Opening the current Conversation…',
    retry: 'Retry',
    reload: 'Reload current Agents',
    composerPlaceholder: 'Message this Agent…',
    send: 'Send message',
    playVoice: 'Play voice',
    attachImage: 'Attach image',
    recordVoice: 'Record voice',
    stopRecording: 'Stop and transcribe',
    removeAttachment: 'Remove attachment',
    pendingAttachment: (name) => `Attached: ${name}`,
    stopTurn: 'Stop current turn',
    transcriptLoading: 'Loading committed messages…',
    transcriptEmptyEyebrow: 'Conversation',
    transcriptEmptyTitle: 'Start a conversation',
    transcriptEmptyDescription: 'Send a message below to get started.',
    requestIdUnavailable: 'This App session cannot create a Conversation request identifier.',
    reuseInput: 'Edit the failed input',
    preserveDraft: 'Your new draft is kept. Clear it first to reuse the earlier input.',
    conversationSettings: 'Review conversation settings in Nimi',
    conversationSettingsUnavailable: 'Could not open Nimi. Check that Home is running. No context was changed.',
    controlNotSaved:'No changes were saved.',
    regenerateExplanation: 'Regenerate explanation',
    chatCopy: {},
  }),
  zh: Object.freeze<AppConversationEntryCopy>({
    title: '伙伴对话',
    description: '选择一位伙伴，接着之前的话题聊，或发一条消息开始。',
    back: '全部伙伴',
    loadingReferences: '正在加载伙伴…',
    empty: '当前应用没有可对话的伙伴。',
    select: '打开对话',
    opening: '正在打开当前对话…',
    retry: '重试',
    reload: '重新加载当前 Agent',
    composerPlaceholder: '输入消息…',
    send: '发送消息',
    playVoice: '播放语音',
    attachImage: '添加图片',
    recordVoice: '录制语音',
    stopRecording: '停止并转写',
    removeAttachment: '移除附件',
    pendingAttachment: (name) => `已添加：${name}`,
    stopTurn: '停止当前回合',
    transcriptLoading: '正在加载已提交消息…',
    transcriptEmptyEyebrow: '对话',
    transcriptEmptyTitle: '开始对话',
    transcriptEmptyDescription: '在下方输入一条消息。',
    requestIdUnavailable: '当前 App session 无法创建 Conversation request identifier。',
    reuseInput: '取回失败输入并编辑',
    preserveDraft: '已保留新草稿。如需取回之前的输入，请先清空当前草稿。',
    conversationSettings: '在 Nimi 中查看对话设置',
    conversationSettingsUnavailable: '未能打开 Nimi。请确认 Home 正在运行。当前上下文未做修改。',
    controlNotSaved:'没有保存更改。',
    regenerateExplanation: '重新生成说明',
    chatCopy: {
      characterRailBackLabel: '返回 Agent 列表',
      characterRailOpenProfileLabel: '打开资料',
      characterRailPresenceMovingCloserLabel: '正在靠近…',
      characterRailPresenceSpeakingLabel: '正在说话…',
      characterRailPresenceThinkingLabel: '正在思考…',
      characterRailPresenceListeningLabel: '正在倾听…',
      characterRailPresenceOfflineLabel: '离线',
      characterRailPresenceOnlineLabel: '在线',
      typingAgentRoleLabel: 'Agent 正在响应',
      typingThinkingLabel: '正在思考…',
      typingStopLabel: '停止生成',
      stageMomentEyebrow: '当前片段',
      stageBeatsInFocusLabel: (beats) => `当前 ${beats} 条消息`,
      stageBeginHintLabel: '发送消息以开始',
      stageEmptyTitle: '等待第一次交流',
      stageEmptyDescription: '第一个已提交回合会显示在这里。',
      bubbleVoicePlayingLabel: '正在播放语音',
      bubbleVoiceMessageLabel: '语音消息',
      bubbleImagePreviewTitle: '图片预览',
      bubbleOpenImagePreviewLabel: '打开图片预览',
      bubbleCloseImagePreviewLabel: '关闭图片预览',
      bubbleImageLabel: '图片',
      bubbleImageUnavailableLabel: '图片暂不可用',
      bubbleStreamingLabel: '正在生成…',
      bubbleUserLabel: '你',
      bubbleAssistantLabel: 'Agent',
      shellDismissOverlayLabel: '关闭浮层',
      composerCancelLabel: '取消',
    },
  }),
});

function resolveEntryCopy(language: string | null | undefined): AppConversationEntryCopy {
  return language?.trim().toLowerCase().startsWith('zh')
    ? APP_CONVERSATION_ENTRY_COPY.zh
    : APP_CONVERSATION_ENTRY_COPY.en;
}

function createRequestId(kind: 'send' | 'voice' | 'regenerate', copy: AppConversationEntryCopy): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error(copy.requestIdUnavailable);
  }
  return `kit-app-conversation-${kind}-${globalThis.crypto.randomUUID()}`;
}

function SessionStatusSurface(props: {
  copy: AppConversationEntryCopy;
  state: AppConversationEntryState | null;
  onRetry: () => void;
}) {
  const { copy, state } = props;
  const loading = !state || state.status === 'idle' || state.status === 'loading-references';
  const opening = state?.status === 'opening';
  return (
    <Surface tone="panel" className="space-y-3 p-4" data-nimi-app-conversation-status={state?.status ?? 'loading-references'}>
      <div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">{copy.title}</h1>
      </div>
      {loading || opening ? (
        <LoadingSkeleton lines={2} label={opening ? copy.opening : copy.loadingReferences} />
      ) : null}
      {state?.error ? <InlineAlert tone="warning">{state.error}</InlineAlert> : null}
      {state?.status === 'select-reference' && state.references.length === 0
        ? <InlineAlert tone="warning">{copy.empty}</InlineAlert>
        : null}
      {state && (state.status === 'failed' || state.status === 'stale') ? (
        <Button size="sm" tone="secondary" onClick={props.onRetry}>
          {state.selectedReference ? copy.reload : copy.retry}
        </Button>
      ) : null}
    </Surface>
  );
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
export function AppConversationEntry(props: AppConversationEntryProps) {
  const copy = useMemo(() => resolveEntryCopy(props.language), [props.language]);
  const sessionRef = useRef<AppConversationEntrySession | null>(null);
  const [state, setState] = useState<AppConversationEntryState | null>(null);
  const [composerText, setComposerText] = useState('');
  const [submittedInput, setSubmittedInput] = useState<{ turnId: string; text: string } | null>(null);
  const [settingsOpenFailed, setSettingsOpenFailed] = useState(false);
  const settingsRequest = useRef<object | null>(null);

  useEffect(() => {
    const session = createAppConversationEntrySession({
      client: props.client,
      hostPort: props.hostPort,
    });
    sessionRef.current = session;
    const removeObserver = session.observe(setState);
    void session.loadReferences();
    return () => {
      removeObserver();
      if (sessionRef.current === session) sessionRef.current = null;
      settingsRequest.current = null;
      void session.dispose();
    };
  }, [props.client, props.hostPort]);

  useEffect(() => {
    setComposerText('');
    setSubmittedInput(null);
    setSettingsOpenFailed(false);
    settingsRequest.current = null;
  }, [state?.conversationAnchorId]);

  const composerAdapter = useMemo(() => ({
    submit: async ({ text }: { text: string; attachments: readonly never[] }) => {
      const session = sessionRef.current;
      if (!session) throw new Error(copy.requestIdUnavailable);
      const current = session.getState();
      const parts = [];
      if (text.trim()) parts.push({ kind: 'text' as const, text });
      if (current.pendingAttachment) {
        parts.push({ kind: 'artifact-ref' as const, artifactId: current.pendingAttachment.artifactId });
      }
      const accepted = await session.send({
        requestId: createRequestId('send', copy),
        parts,
      });
      if (sessionRef.current !== session) return;
      setSubmittedInput({ turnId: accepted.turnId, text });
      setComposerText((currentText) => currentText === text ? '' : currentText);
    },
  }), [copy]);

  const retry = () => {
    void sessionRef.current?.loadReferences();
  };

  if (!state
    || state.status === 'idle'
    || state.status === 'loading-references'
    || state.status === 'opening'
    || state.status === 'failed'
    || state.status === 'stale') {
    return (
      <div className={props.className} data-nimi-app-conversation-entry="true">
        <SessionStatusSurface copy={copy} state={state} onRetry={retry} />
      </div>
    );
  }

  if (state.status === 'select-reference') {
    return (
      <div className={props.className} data-nimi-app-conversation-entry="true">
        <div className="space-y-5">
          <header className="flex items-start gap-4 py-2">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
              <MessagesSquare className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-2xl font-semibold tracking-tight">{copy.title}</h1>
              <p className="m-0 mt-1 text-sm leading-relaxed text-[var(--nimi-text-secondary)]">{copy.description}</p>
            </div>
          </header>
          {state.references.length === 0 ? <InlineAlert tone="warning">{copy.empty}</InlineAlert> : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-2" data-nimi-app-conversation-selector="true">
            {state.references.map((reference) => (
              <Button
                key={reference.agentHandle}
                tone="secondary"
                aria-label={`${reference.displayName} · ${copy.select}`}
                title={reference.displayName}
                className="min-h-14 min-w-0 justify-start px-3 text-left [&>span]:w-full [&>span]:justify-start"
                onClick={() => {
                  void sessionRef.current?.selectReference(reference.agentHandle);
                }}
                data-nimi-app-conversation-agent-handle={reference.agentHandle}
              >
                <Avatar
                  size="md"
                  src={reference.avatarUrl || undefined}
                  alt=""
                  fallback={reference.displayName.slice(0, 1)}
                />
                <span className="min-w-0 flex-1 truncate">{reference.displayName}</span>
                <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.status !== 'ready' || !state.selectedReference || !state.conversationAnchorId) {
    return null;
  }

  const reference = state.selectedReference;
  const playVoice = (message: ConversationCanonicalMessage) => {
    const session = sessionRef.current;
    if (!session) return;
    void session.playVoice({
      messageId: message.id,
      requestId: createRequestId('voice', copy),
    }).catch(() => {});
  };
  const interrupt = () => {
    void sessionRef.current?.interrupt().catch(() => {});
  };
  const pickAttachment = () => {
    void sessionRef.current?.pickAttachment().catch(() => {});
  };
  const recordVoice = () => {
    const session = sessionRef.current;
    if (!session) return;
    void session.recordAndTranscribe({
      requestId: createRequestId('voice', copy),
    }).then((result) => {
      if (result.status === 'transcribed') setComposerText(result.text);
    }).catch(() => {});
  };
  const voiceMessage = [...state.messages].reverse().find((message) => message.role === 'assistant') ?? null;
  const openSettings = () => {
    const session = sessionRef.current;
    const anchor = state.conversationAnchorId;
    const request = {};
    settingsRequest.current = request;
    setSettingsOpenFailed(false);
    const finish = (failed: boolean) => {
      if (settingsRequest.current === request && sessionRef.current === session
        && session?.getState().conversationAnchorId === anchor) setSettingsOpenFailed(failed);
    };
    void openDesktopIntent({ intent: { kind: 'open-agent-center', conversationAnchorId: anchor } })
      .then(result => finish(result.status !== 'accepted')).catch(() => finish(true));
  };

  return (
    <div className={cn('h-full min-h-[28rem]', props.className)} data-nimi-app-conversation-entry="true">
      <Surface tone="panel" className="flex h-full min-h-[inherit] min-w-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--nimi-border-subtle)] px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button size="sm" tone="ghost" onClick={() => { void sessionRef.current?.clearSelection(); }}>
              <ArrowLeft className="size-4" aria-hidden="true" />{copy.back}
            </Button>
            <Avatar size="md" src={reference.avatarUrl || undefined} alt="" fallback={reference.displayName.slice(0, 1)} />
            <h1 className="m-0 min-w-0 text-base font-semibold break-words">{reference.displayName}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" tone="ghost" onClick={openSettings}>{copy.conversationSettings}</Button>
            {voiceMessage ? (
              <Button size="sm" tone="ghost" onClick={() => playVoice(voiceMessage)} data-nimi-app-conversation-play-voice={voiceMessage.id}>
                {copy.playVoice}
              </Button>
            ) : null}
          </div>
        </header>
        {settingsOpenFailed || state.actionError || (submittedInput?.text && state.lastTurnFailure?.turnId === submittedInput.turnId) ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">
            {settingsOpenFailed ? <InlineAlert tone="warning">{copy.conversationSettingsUnavailable}</InlineAlert> : null}
            {state.actionError ? <InlineAlert tone="warning">{state.actionError}</InlineAlert> : null}
            {submittedInput?.text && state.lastTurnFailure?.turnId === submittedInput.turnId ? <div className="text-sm">
              <Button size="sm" tone="secondary" disabled={composerText.length > 0} onClick={() => {
                if (!composerText) setComposerText(submittedInput.text);
              }}>{copy.reuseInput}</Button>
              {composerText ? <p className="mt-1 text-[var(--nimi-text-secondary)]">{copy.preserveDraft}</p> : null}
            </div> : null}
          </div>
        ) : null}
        <CanonicalTranscriptView
          messages={state.messages}
          copy={copy.chatCopy}
          activeConversationId={state.conversationAnchorId}
          agentAvatarUrl={reference.avatarUrl}
          agentName={reference.displayName}
          pendingFirstBeat={state.activeTurnId !== null}
          emptyEyebrow={copy.transcriptEmptyEyebrow}
          emptyTitle={copy.transcriptEmptyTitle}
          emptyDescription={copy.transcriptEmptyDescription}
          pendingStopLabel={copy.stopTurn}
          onStopGenerating={interrupt}
          widthClassName="w-full max-w-[52rem]"
          contentPaddingBottomClassName="pb-4"
        />
        <div className="shrink-0 border-t border-[var(--nimi-border-subtle)]">
          <CanonicalComposer
            adapter={composerAdapter}
            text={composerText}
            onTextChange={setComposerText}
            placeholder={copy.composerPlaceholder}
            sendLabel={copy.send}
            widthClassName="w-full max-w-[52rem]"
            layout="stacked"
            toolbarSlot={(
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" tone="ghost" onClick={pickAttachment}>
                  {copy.attachImage}
                </Button>
                <Button size="sm" tone="ghost" onClick={recordVoice}>
                  {state.recording ? copy.stopRecording : copy.recordVoice}
                </Button>
                {state.pendingAttachment ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--nimi-text-secondary)]">
                    {copy.pendingAttachment(state.pendingAttachment.displayName || state.pendingAttachment.artifactId)}
                    <Button size="sm" tone="ghost" onClick={() => sessionRef.current?.clearAttachment()}>
                      {copy.removeAttachment}
                    </Button>
                  </span>
                ) : null}
              </div>
            )}
          />
        </div>
      </Surface>
    </div>
  );
}
