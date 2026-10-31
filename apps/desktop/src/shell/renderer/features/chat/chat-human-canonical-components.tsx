import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  type CanonicalStagePanelProps,
} from '@nimiplatform/kit/features/chat/components/canonical-stage-panel';
import {
  CanonicalStagePanel,
} from '@nimiplatform/kit/features/chat/components/canonical-stage-panel';
import {
  CanonicalTranscriptView,
  type CanonicalTranscriptViewProps,
} from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';
import {
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/components/chat-stream-status';
import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';
import {
  type CanonicalMessageAccessorySlot,
  type CanonicalMessageAvatarSlot,
  type ConversationCharacterData,
} from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { CHAT_CONTENT_WIDTH_CLASS, CHAT_CONTENT_POSITION_CLASS, CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS, CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS, CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS } from './chat-shared-content-layout';
import type { StreamState } from '../turns/stream-controller';
import { useStreamController } from '../turns/stream-controller-context.js';
import { RelationshipActionsMenu } from '../relationship/relationship-actions-menu.js';
import { ReportUserDialog } from '../relationship/report-user-dialog.js';
import {
  useHumanTimelineModel,
  type HumanRealmChatTimelineDisplay,
  type HumanTimelineModel,
} from './chat-human-timeline-model';
import {
  HumanVoiceInspectSidebar,
  useHumanVoiceUiState,
  type HumanVoiceUiState,
} from './chat-human-voice-ui';
export { HumanCanonicalComposer, HumanCanonicalProfileDrawer } from './chat-human-canonical-composer-profile';

export function HumanReadMarker({ messageId, onVisible }: { messageId: string; onVisible: (id: string) => Promise<void> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let intersects = false;
    const acknowledgeVisible = () => {
      if (intersects && document.visibilityState === 'visible') void onVisible(messageId);
    };
    const observer = new IntersectionObserver(entries => {
      intersects = entries.some(entry => entry.isIntersecting);
      acknowledgeVisible();
    }, { threshold: 1 });
    observer.observe(node);
    document.addEventListener('visibilitychange', acknowledgeVisible);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', acknowledgeVisible);
    };
  }, [messageId, onVisible]);
  return <span ref={ref} aria-hidden="true" className="block h-px w-px" />;
}

function HumanStreamFooter(props: {
  selectedChatId: string | null;
  contactName: string;
  contactAvatarUrl: string | null;
  streamState: StreamState | null;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();
  const streamController = useStreamController();

  if (props.streamState && props.isStreaming) {
    return (
      <ChatStreamStatus
        mode="streaming"
        partialText={props.streamState.partialText}
        avatar={(
          <EntityAvatar
            imageUrl={props.contactAvatarUrl}
            name={props.contactName}
            kind="human"
            sizeClassName="mt-1 h-8 w-8 shrink-0"
            textClassName="text-xs font-medium"
          />
        )}
        actions={(
          <button
            type="button"
            onClick={() => {
              if (props.selectedChatId) {
                streamController.cancelStream(props.selectedChatId);
              }
            }}
            className="rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-xs text-[var(--nimi-text-muted)] transition hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-secondary)]"
          >
            {t('ChatTimeline.stopGenerating', 'Stop generating')}
          </button>
        )}
      />
    );
  }

  if (props.streamState && (props.streamState.phase === 'error' || props.streamState.phase === 'cancelled') && props.streamState.interrupted) {
    return (
      <ChatStreamStatus
        mode="interrupted"
        partialText={props.streamState.partialText}
        errorMessage={props.streamState.errorMessage}
        avatar={(
          <EntityAvatar
            imageUrl={props.contactAvatarUrl}
            name={props.contactName}
            kind="human"
            sizeClassName="mt-1 h-8 w-8 shrink-0"
            textClassName="text-xs font-medium"
          />
        )}
        interruptedSuffix={<span className="ml-1 text-xs text-[var(--nimi-status-danger)]">[{t('ChatTimeline.streamInterrupted', 'Response interrupted')}]</span>}
      />
    );
  }

  return null;
}

function useHumanMessageRenderers(input: {
  selectedChatId: string | null;
  model: HumanTimelineModel;
}) {
  const { t } = useTranslation();
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const [reportMessage, setReportMessage] = useState<Parameters<CanonicalMessageAccessorySlot>[0] | null>(null);
  useEffect(() => { setReportMessage(null); }, [input.selectedChatId, input.model.currentUserId]);

  const toggleProfilePanel = useCallback((target: 'self' | 'other') => {
    setProfilePanelTarget(profilePanelTarget === target ? null : target);
  }, [profilePanelTarget, setProfilePanelTarget]);

  const renderMessageAvatar = useCallback<CanonicalMessageAvatarSlot>((message) => {
    const isMe = message.role === 'human' || message.role === 'user';
    const senderName = isMe ? t('ChatTimeline.you') : input.model.contactName;
    const messageProfileTarget: 'self' | 'other' = isMe ? 'self' : 'other';
    const display = (message.metadata as Record<string, unknown> | undefined)?.display as HumanRealmChatTimelineDisplay | undefined;
    return (
      <button
        type="button"
        onClick={() => toggleProfilePanel(messageProfileTarget)}
        className={`${display?.isMediaMessage ? 'mt-0' : 'mt-1'} shrink-0`}
        aria-label={profilePanelTarget === messageProfileTarget
          ? (isMe ? t('ChatTimeline.collapseMyProfile') : t('ChatTimeline.collapseUserProfile'))
          : (isMe ? t('ChatTimeline.viewMyProfile') : t('ChatTimeline.viewUserProfile'))}
      >
        <EntityAvatar
          imageUrl={isMe ? input.model.currentUserAvatarUrl : input.model.contactAvatarUrl}
          name={senderName}
          kind="human"
          sizeClassName="h-8 w-8"
          textClassName="text-xs font-medium"
          fallbackClassName={isMe ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : undefined}
        />
      </button>
    );
  }, [input.model.contactAvatarUrl, input.model.contactName, input.model.currentUserAvatarUrl, profilePanelTarget, t, toggleProfilePanel]);

  const renderMessageAccessory = useCallback<CanonicalMessageAccessorySlot>((message) => {
    const realmMessage = message.metadata?.realmMessage as { type?: string } | undefined;
    if (!message.error && message.status !== 'pending') {
      return <>
        {message.id === input.model.newestMessageId ? <HumanReadMarker messageId={message.id} onVisible={input.model.acknowledgeRead} /> : null}
        {message.role !== 'human' && message.role !== 'user' && realmMessage?.type !== 'RECALL' ? <RelationshipActionsMenu label={t('Chat.rail.messageActions')}
          items={[{ id: 'report', label: t('Relationship.report.action'), onSelect: () => setReportMessage(message) }]} /> : null}
      </>;
    }
    return (
      <div className={`mt-1 text-[10px] ${message.error ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-muted)]'} ${message.role === 'human' || message.role === 'user' ? 'text-right' : 'text-left'}`}>
        {message.error || t('ChatTimeline.awaitingConfirmation', { defaultValue: 'Send not confirmed. Retry from the composer.' })}
      </div>
    );
  }, [t, input.model.newestMessageId, input.model.acknowledgeRead]);

  const footerContent = (
    <>
    <HumanStreamFooter
      selectedChatId={input.selectedChatId}
      contactName={input.model.contactName}
      contactAvatarUrl={input.model.contactAvatarUrl}
      streamState={input.model.streamState}
      isStreaming={input.model.isStreaming}
    />
    {reportMessage ? <ReportUserDialog target={{ id: reportMessage.targetId,
      displayName: reportMessage.senderName || input.model.contactName }}
      message={{ chatId: reportMessage.sessionId, messageId: reportMessage.id, previewText: reportMessage.text }}
      onClose={() => setReportMessage(null)} /> : null}
    </>
  );

  return {
    renderMessageAvatar,
    renderMessageAccessory,
    footerContent,
  };
}

export function HumanCanonicalTranscriptSurface(props: {
  selectedChatId: string;
  selectedChat: RealmChatViewDto | null;
}) {
  const transcriptProps = useHumanCanonicalTranscriptProps(props);
  return (
    <CanonicalTranscriptView {...transcriptProps} />
  );
}

export function HumanCanonicalStageSurface(props: {
  selectedChatId: string;
  selectedChat: RealmChatViewDto | null;
  characterData: ConversationCharacterData;
  stageAnchorViewportRef?: RefObject<HTMLDivElement | null>;
  stageCardAnchorOffsetPx?: number | null;
  onIntentOpenHistory?: () => void;
}) {
  const stagePanelProps = useHumanCanonicalStagePanelProps(props);
  return <CanonicalStagePanel {...stagePanelProps} />;
}

export function useHumanCanonicalTranscriptProps(props: {
  selectedChatId: string | null;
  selectedChat: RealmChatViewDto | null;
  voiceUi?: HumanVoiceUiState;
}): CanonicalTranscriptViewProps {
  const { t, i18n } = useTranslation();
  const model = useHumanTimelineModel(props.selectedChatId, props.selectedChat);
  const renderers = useHumanMessageRenderers({
    selectedChatId: props.selectedChatId,
    model,
  });
  return createHumanCanonicalTranscriptProps({
    model,
    t,
    locale: i18n.language,
    voiceUi: props.voiceUi,
    renderers,
  });
}

function createHumanCanonicalTranscriptProps(input: {
  locale: string;
  model: HumanTimelineModel;
  t: ReturnType<typeof useTranslation>['t'];
  voiceUi?: HumanVoiceUiState;
  renderers: ReturnType<typeof useHumanMessageRenderers>;
}): CanonicalTranscriptViewProps {
  return {
    messages: input.model.canonicalMessages,
    dataTestId: E2E_IDS.messageTimeline,
    activeConversationId: input.model.selectedChatId,
    loading: input.model.messagesQuery.isPending,
    loadingLabel: input.t('MessagePane.loadingConversation', { defaultValue: 'Loading conversation…' }),
    error: input.model.messagesQuery.isError && !input.model.canonicalMessages.length ? input.t('ChatTimeline.messageLoadError') : null,
    errorAction: <button type="button" onClick={() => void input.model.messagesQuery.refetch()}>{input.t('Common.retry')}</button>,
    bannerContent: <div className="flex items-center justify-center gap-3 p-2 text-sm">
      {input.model.hasOlderMessages || input.model.olderMessagesError ? <button type="button" disabled={input.model.loadingOlderMessages}
        onClick={() => void input.model.loadOlderMessages()}>{input.model.olderMessagesError ? input.t('Common.retry') : input.t('Chat.loadEarlierMessages', { defaultValue: 'Load earlier messages' })}</button> : null}
      {input.model.readError ? <button type="button" onClick={() => void input.model.acknowledgeRead(input.model.readError!)}>{input.t('Chat.retryReadReceipt', { defaultValue: 'Retry read acknowledgement' })}</button> : null}
    </div>,
    emptyEyebrow: input.model.deletedPeer ? '' : input.t('MessagePane.welcomeEyebrow', { defaultValue: 'Welcome' }),
    emptyTitle: input.model.deletedPeer ? input.t('Relationship.contacts.deletedUser') : input.t('MessagePane.welcomeTitle', {
      name: input.model.contactName,
      defaultValue: `Say hi to ${input.model.contactName}`,
    }),
    emptyDescription: input.model.deletedPeer ? input.t('Relationship.contacts.deletedChatHistory') : input.t('MessagePane.welcomeDescription', {
      name: input.model.contactName,
      defaultValue: `Start chatting with ${input.model.contactName}.`,
    }),
    formatDateLabel: ({ date, diffDays }) => {
      if (diffDays === 0) return input.t('Chat.today');
      if (diffDays === 1) return input.t('Chat.yesterday');
      return date.toLocaleDateString(input.locale);
    },
    historyIntro: input.model.hasOlderMessages ? input.t('MessagePane.historyIntro', { defaultValue: 'Earlier messages' }) : null,
    pendingFirstBeat: input.model.isStreaming && input.model.canonicalMessages.length === 0,
    agentAvatarUrl: input.model.contactAvatarUrl,
    agentName: input.model.contactName,
    renderMessageAvatar: input.renderers.renderMessageAvatar,
    renderMessageAccessory: input.renderers.renderMessageAccessory,
    voicePlayingMessageId: input.voiceUi?.playingVoiceMessageId || null,
    isVoiceTranscriptVisible: input.voiceUi?.isVoiceTranscriptVisible,
    onPlayVoiceMessage: input.voiceUi?.onPlayVoiceMessage,
    onVoiceContextMenu: input.voiceUi?.onVoiceContextMenu,
    footerContent: input.renderers.footerContent,
    widthClassName: CHAT_CONTENT_WIDTH_CLASS,
    widthPositionClassName: CHAT_CONTENT_POSITION_CLASS,
    scrollViewportWidthClassName: CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS,
    scrollViewportPositionClassName: CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS,
    contentPaddingBottomClassName: CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
  };
}

export function useHumanCanonicalStagePanelProps(props: {
  selectedChatId: string | null;
  selectedChat: RealmChatViewDto | null;
  characterData: ConversationCharacterData;
  stageAnchorViewportRef?: RefObject<HTMLDivElement | null>;
  stageCardAnchorOffsetPx?: number | null;
  onIntentOpenHistory?: () => void;
  voiceUi?: HumanVoiceUiState;
}): CanonicalStagePanelProps {
  const model = useHumanTimelineModel(props.selectedChatId, props.selectedChat);
  const renderers = useHumanMessageRenderers({
    selectedChatId: props.selectedChatId,
    model,
  });
  return createHumanCanonicalStagePanelProps({
    model,
    characterData: props.characterData,
    stageAnchorViewportRef: props.stageAnchorViewportRef,
    stageCardAnchorOffsetPx: props.stageCardAnchorOffsetPx,
    onIntentOpenHistory: props.onIntentOpenHistory,
    voiceUi: props.voiceUi,
    renderers,
  });
}

function createHumanCanonicalStagePanelProps(input: {
  model: HumanTimelineModel;
  characterData: ConversationCharacterData;
  stageAnchorViewportRef?: RefObject<HTMLDivElement | null>;
  stageCardAnchorOffsetPx?: number | null;
  onIntentOpenHistory?: () => void;
  voiceUi?: HumanVoiceUiState;
  renderers: ReturnType<typeof useHumanMessageRenderers>;
}): CanonicalStagePanelProps {
  return {
    characterData: input.characterData,
    messages: input.model.canonicalMessages,
    pendingFirstBeat: input.model.isStreaming && input.model.canonicalMessages.length === 0,
    anchorViewportRef: input.stageAnchorViewportRef,
    cardAnchorOffsetPx: input.stageCardAnchorOffsetPx,
    onIntentOpenHistory: input.onIntentOpenHistory,
    agentAvatarUrl: input.model.contactAvatarUrl,
    agentName: input.model.contactName,
    voicePlayingMessageId: input.voiceUi?.playingVoiceMessageId || null,
    isVoiceTranscriptVisible: input.voiceUi?.isVoiceTranscriptVisible,
    onPlayVoiceMessage: input.voiceUi?.onPlayVoiceMessage,
    onVoiceContextMenu: input.voiceUi?.onVoiceContextMenu,
    renderMessageAvatar: input.renderers.renderMessageAvatar,
    renderMessageAccessory: input.renderers.renderMessageAccessory,
    footerContent: input.renderers.footerContent,
  };
}

export function useHumanCanonicalConversationSurface(props: {
  selectedChatId: string | null;
  selectedChat: RealmChatViewDto | null;
  characterData: ConversationCharacterData;
}) {
  const model = useHumanTimelineModel(props.selectedChatId, props.selectedChat);
  const { t, i18n } = useTranslation();
  const voiceUi = useHumanVoiceUiState();
  const renderers = useHumanMessageRenderers({
    selectedChatId: props.selectedChatId,
    model,
  });
  const transcriptProps = createHumanCanonicalTranscriptProps({
    model,
    t,
    locale: i18n.language,
    voiceUi,
    renderers,
  });
  const stagePanelProps = createHumanCanonicalStagePanelProps({
    model,
    characterData: props.characterData,
    voiceUi,
    renderers,
  });
  const selectedVoiceMessage = voiceUi.selectedVoiceMessageId
    ? model.canonicalMessages.find((message) => message.id === voiceUi.selectedVoiceMessageId) || null
    : null;
  const rightSidebarContent = selectedVoiceMessage ? (
    <HumanVoiceInspectSidebar
      message={selectedVoiceMessage}
      playing={voiceUi.playingVoiceMessageId === selectedVoiceMessage.id}
      transcriptVisible={voiceUi.isVoiceTranscriptVisible(selectedVoiceMessage)}
      onPlay={voiceUi.onPlayVoiceMessage}
      onToggleTranscript={voiceUi.toggleVoiceTranscript}
    />
  ) : null;

  return {
    messages: model.canonicalMessages,
    transcriptProps,
    stagePanelProps,
    rightSidebarContent,
    diagnosticsSummary: {
      messageCount: model.canonicalMessages.length,
      isStreaming: model.isStreaming,
    },
    rightSidebarAutoOpenKey: selectedVoiceMessage?.id || null,
    rightSidebarOverlayMenu: voiceUi.rightSidebarOverlayMenu,
  };
}
