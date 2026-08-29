import { useEffect, useMemo, useRef, useState } from 'react';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/kit/core/sdk-contract';
import { Avatar, Button, InlineAlert, LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
import type { ChatCopy } from '../copy.js';
import type { ConversationCanonicalMessage, ConversationViewMode } from '../types.js';
import {
  createAppConversationEntrySession,
  type AppConversationEntryClient,
  type AppConversationEntrySession,
  type AppConversationEntryState,
  type AppConversationHostPort,
} from '../headless/app-conversation-entry-session.js';
import { CanonicalComposer } from './canonical-composer.js';
import { CanonicalConversationShell } from './canonical-conversation-shell.js';

export type AppConversationEntryProps = Readonly<{
  client: AppConversationEntryClient;
  hostPort: AppConversationHostPort;
  language?: string | null;
  className?: string;
}>;

type AppConversationEntryCopy = Readonly<{
  title: string;
  description: string;
  loadingReferences: string;
  empty: string;
  select: string;
  opening: string;
  retry: string;
  reload: string;
  composerPlaceholder: string;
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
  chatCopy: ChatCopy;
}>;

export const APP_CONVERSATION_ENTRY_COPY = Object.freeze({
  en: Object.freeze<AppConversationEntryCopy>({
    title: 'Agent Conversation',
    description: 'Choose a current Agent explicitly to open its canonical Conversation.',
    loadingReferences: 'Loading current Agents…',
    empty: 'No current Agent is available for this App session.',
    select: 'Open Conversation',
    opening: 'Opening the current Conversation…',
    retry: 'Retry',
    reload: 'Reload current Agents',
    composerPlaceholder: 'Message this Agent…',
    playVoice: 'Play voice',
    attachImage: 'Attach image',
    recordVoice: 'Record voice',
    stopRecording: 'Stop and transcribe',
    removeAttachment: 'Remove attachment',
    pendingAttachment: (name) => `Attached: ${name}`,
    stopTurn: 'Stop current turn',
    transcriptLoading: 'Loading committed messages…',
    transcriptEmptyEyebrow: 'Conversation',
    transcriptEmptyTitle: 'Start the first turn',
    transcriptEmptyDescription: 'Only committed Conversation messages appear here.',
    requestIdUnavailable: 'This App session cannot create a Conversation request identifier.',
    chatCopy: {},
  }),
  zh: Object.freeze<AppConversationEntryCopy>({
    title: 'Agent 对话',
    description: '请明确选择当前 Agent，以打开其规范 Conversation。',
    loadingReferences: '正在加载当前 Agent…',
    empty: '当前 App session 没有可用 Agent。',
    select: '打开对话',
    opening: '正在打开当前对话…',
    retry: '重试',
    reload: '重新加载当前 Agent',
    composerPlaceholder: '给这个 Agent 发消息…',
    playVoice: '播放语音',
    attachImage: '添加图片',
    recordVoice: '录制语音',
    stopRecording: '停止并转写',
    removeAttachment: '移除附件',
    pendingAttachment: (name) => `已添加：${name}`,
    stopTurn: '停止当前回合',
    transcriptLoading: '正在加载已提交消息…',
    transcriptEmptyEyebrow: '对话',
    transcriptEmptyTitle: '开始第一个回合',
    transcriptEmptyDescription: '这里只显示已经提交的 Conversation 消息。',
    requestIdUnavailable: '当前 App session 无法创建 Conversation request identifier。',
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

function createRequestId(kind: 'send' | 'voice', copy: AppConversationEntryCopy): string {
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
        <h2 className="m-0 text-[length:var(--nimi-type-section-title-size)] font-semibold text-[var(--nimi-text-primary)]">
          {copy.title}
        </h2>
        <p className="m-0 mt-1 text-sm text-[var(--nimi-text-secondary)]">{copy.description}</p>
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
  const [viewMode, setViewMode] = useState<ConversationViewMode>('stage');
  const [composerText, setComposerText] = useState('');

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
      void session.dispose();
    };
  }, [props.client, props.hostPort]);

  useEffect(() => {
    setViewMode('stage');
    setComposerText('');
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
      await session.send({
        requestId: createRequestId('send', copy),
        parts,
      });
      setComposerText('');
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
        <Surface tone="panel" className="space-y-3 p-4">
          <div>
            <h2 className="m-0 text-[length:var(--nimi-type-section-title-size)] font-semibold text-[var(--nimi-text-primary)]">
              {copy.title}
            </h2>
            <p className="m-0 mt-1 text-sm text-[var(--nimi-text-secondary)]">{copy.description}</p>
          </div>
          {state.references.length === 0 ? <InlineAlert tone="warning">{copy.empty}</InlineAlert> : null}
          <div className="grid gap-2" data-nimi-app-conversation-selector="true">
            {state.references.map((reference) => (
              <Button
                key={reference.agentHandle}
                tone="secondary"
                onClick={() => {
                  void sessionRef.current?.selectReference(reference.agentHandle);
                }}
                data-nimi-app-conversation-agent-handle={reference.agentHandle}
              >
                <Avatar
                  size="sm"
                  src={reference.avatarUrl || undefined}
                  alt={reference.displayName}
                  fallback={reference.displayName.slice(0, 1)}
                />
                <span>{reference.displayName}</span>
                <span className="text-xs opacity-70">{copy.select}</span>
              </Button>
            ))}
          </div>
        </Surface>
      </div>
    );
  }

  if (state.status !== 'ready' || !state.selectedReference || !state.conversationAnchorId) {
    return null;
  }

  const reference = state.selectedReference;
  const target = {
    id: reference.agentHandle,
    source: 'agent' as const,
    canonicalSessionId: state.conversationAnchorId,
    title: reference.displayName,
    avatarUrl: reference.avatarUrl,
    avatarFallback: reference.displayName.slice(0, 1),
    isOnline: true,
  };
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

  return (
    <div className={props.className} data-nimi-app-conversation-entry="true">
      <CanonicalConversationShell
        chrome="card"
        copy={copy.chatCopy}
        sourceFilter="agent"
        availableSources={['agent']}
        targets={[target]}
        selectedTargetId={target.id}
        selectedTarget={target}
        onSelectTarget={(targetId) => {
          if (targetId === null) void sessionRef.current?.clearSelection();
        }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        setupState={{ mode: 'agent', status: 'ready', issues: [], primaryAction: null }}
        characterData={{
          name: reference.displayName,
          avatarUrl: reference.avatarUrl,
          avatarFallback: reference.displayName.slice(0, 1),
        }}
        messages={state.messages}
        pendingFirstBeat={state.activeTurnId !== null}
        topContent={state.actionError || voiceMessage ? (
          <div className="flex items-center gap-2 px-5 pt-3">
            {state.actionError ? <InlineAlert tone="warning">{state.actionError}</InlineAlert> : null}
            {voiceMessage ? (
              <Button
                size="sm"
                tone="ghost"
                onClick={() => playVoice(voiceMessage)}
                data-nimi-app-conversation-play-voice={voiceMessage.id}
              >
                {copy.playVoice}
              </Button>
            ) : null}
          </div>
        ) : null}
        transcriptProps={{
          loading: false,
          loadingLabel: copy.transcriptLoading,
          emptyEyebrow: copy.transcriptEmptyEyebrow,
          emptyTitle: copy.transcriptEmptyTitle,
          emptyDescription: copy.transcriptEmptyDescription,
          pendingStopLabel: copy.stopTurn,
          onStopGenerating: interrupt,
        }}
        composer={(
          <CanonicalComposer
            adapter={composerAdapter}
            mode={viewMode}
            text={composerText}
            onTextChange={setComposerText}
            placeholder={copy.composerPlaceholder}
            disabled={state.status !== 'ready'}
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
        )}
      />
    </div>
  );
}
