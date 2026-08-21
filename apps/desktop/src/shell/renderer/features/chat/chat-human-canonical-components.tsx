import {
  useCallback,
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
  type CanonicalMessageContentSlot,
  type ConversationCanonicalMessage,
  type ConversationCharacterData,
} from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { GiftMessageBubble, type GiftMessagePayload } from '../economy/gift-message-bubble.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { CHAT_CONTENT_WIDTH_CLASS, CHAT_CONTENT_POSITION_CLASS, CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS, CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS, CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS } from './chat-shared-content-layout';
import type { StreamState } from '../turns/stream-controller';
import { useStreamController } from '../turns/stream-controller-context.js';
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

function HumanMediaMessageCard(props: {
  message: ConversationCanonicalMessage;
  imageLabel: string;
  videoLabel: string;
  uploadingLabel: string;
}) {
  const metadata = props.message.metadata as Record<string, unknown> | undefined;
  const display = metadata?.display as HumanRealmChatTimelineDisplay | undefined;
  const mediaUrl = typeof metadata?.mediaUrl === 'string' ? metadata.mediaUrl : '';
  const mediaLabel = typeof metadata?.mediaLabel === 'string' && metadata.mediaLabel
    ? metadata.mediaLabel
    : props.message.kind === 'video'
      ? props.videoLabel
      : props.imageLabel;
  const isUser = props.message.role === 'human' || props.message.role === 'user';

  return (
    <div className={`overflow-hidden rounded-[24px] border shadow-[0_8px_22px_rgba(15,23,42,0.08)] ${isUser ? 'border-[var(--nimi-action-primary-bg)]/40 bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,transparent)]' : 'border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_95%,transparent)]'}`}>
      {props.message.kind === 'video' ? (
        <div className="relative h-52 w-[min(22rem,72vw)] overflow-hidden bg-slate-950">
          {mediaUrl ? (
            <video
              src={mediaUrl}
              className="block h-full w-full object-cover"
              controls={!display?.isUploadingMedia}
              muted={display?.isUploadingMedia}
              playsInline
              preload="metadata"
            />
          ) : null}
        </div>
      ) : mediaUrl ? (
        <img
          src={mediaUrl}
          alt={mediaLabel}
          className="block max-h-[22rem] w-[min(22rem,72vw)] object-cover"
        />
      ) : (
        <div className="flex h-52 w-[min(22rem,72vw)] items-center justify-center bg-[var(--nimi-surface-panel)] text-sm text-[var(--nimi-text-muted)]">
          {mediaLabel}
        </div>
      )}
      <div className="space-y-1 px-4 py-3">
        <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{mediaLabel}</p>
        {display?.isUploadingMedia ? (
          <p className="text-xs text-[var(--nimi-text-muted)]">{props.uploadingLabel}</p>
        ) : null}
        {props.message.error ? (
          <p className="text-xs text-[var(--nimi-status-danger)]">{props.message.error}</p>
        ) : null}
      </div>
    </div>
  );
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
        className={`${display?.isMediaMessage || display?.isGiftMessage ? 'mt-0' : 'mt-1'} shrink-0`}
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

  const renderMessageContent = useCallback<CanonicalMessageContentSlot>((message) => {
    const metadata = message.metadata as Record<string, unknown> | undefined;
    const realmMessage = metadata?.realmMessage as { payload?: unknown } | undefined;
    if (message.kind === 'gift') {
      return (
        <GiftMessageBubble
          payload={realmMessage?.payload as GiftMessagePayload}
          isMe={message.role === 'human' || message.role === 'user'}
          currentUserId={input.model.currentUserId}
        />
      );
    }
    if (message.kind === 'image' || message.kind === 'video') {
      return (
        <HumanMediaMessageCard
          message={message}
          imageLabel={t('ChatTimeline.imageMessage', 'Image')}
          videoLabel={t('ChatTimeline.videoMessage', 'Video')}
          uploadingLabel={t('ChatTimeline.uploadingMedia', 'Uploading...')}
        />
      );
    }
    return undefined;
  }, [input.model.currentUserId, t]);

  const renderMessageAccessory = useCallback<CanonicalMessageAccessorySlot>((message) => {
    if (!message.error && message.status !== 'pending') {
      return undefined;
    }
    return (
      <div className={`mt-1 text-[10px] ${message.error ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-muted)]'} ${message.role === 'human' || message.role === 'user' ? 'text-right' : 'text-left'}`}>
        {message.error || t('ChatTimeline.queuedLocally')}
      </div>
    );
  }, [t]);

  const footerContent = (
    <HumanStreamFooter
      selectedChatId={input.selectedChatId}
      contactName={input.model.contactName}
      contactAvatarUrl={input.model.contactAvatarUrl}
      streamState={input.model.streamState}
      isStreaming={input.model.isStreaming}
    />
  );

  return {
    renderMessageAvatar,
    renderMessageContent,
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
  const { t } = useTranslation();
  const model = useHumanTimelineModel(props.selectedChatId, props.selectedChat);
  const renderers = useHumanMessageRenderers({
    selectedChatId: props.selectedChatId,
    model,
  });
  return createHumanCanonicalTranscriptProps({
    model,
    t,
    voiceUi: props.voiceUi,
    renderers,
  });
}

function createHumanCanonicalTranscriptProps(input: {
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
    error: input.model.messagesQuery.isError ? input.t('ChatTimeline.messageLoadError') : null,
    emptyEyebrow: input.t('MessagePane.welcomeEyebrow', { defaultValue: 'Welcome' }),
    emptyTitle: input.t('MessagePane.welcomeTitle', {
      name: input.model.contactName,
      defaultValue: `Say hi to ${input.model.contactName}`,
    }),
    emptyDescription: input.t('MessagePane.welcomeDescription', {
      name: input.model.contactName,
      defaultValue: `Start chatting with ${input.model.contactName}.`,
    }),
    historyIntro: input.model.canonicalMessages.length > 0 ? input.t('MessagePane.historyIntro', { defaultValue: 'Earlier messages' }) : null,
    pendingFirstBeat: input.model.isStreaming && input.model.canonicalMessages.length === 0,
    agentAvatarUrl: input.model.contactAvatarUrl,
    agentName: input.model.contactName,
    renderMessageAvatar: input.renderers.renderMessageAvatar,
    renderMessageContent: input.renderers.renderMessageContent,
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
    renderMessageContent: input.renderers.renderMessageContent,
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
  const { t } = useTranslation();
  const voiceUi = useHumanVoiceUiState();
  const renderers = useHumanMessageRenderers({
    selectedChatId: props.selectedChatId,
    model,
  });
  const transcriptProps = createHumanCanonicalTranscriptProps({
    model,
    t,
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
