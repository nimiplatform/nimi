import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CanonicalDrawerSection,
  CanonicalStagePanel,
  type CanonicalStagePanelProps,
  CanonicalTranscriptView,
  type CanonicalTranscriptViewProps,
  type CanonicalMessageAccessorySlot,
  type CanonicalMessageAvatarSlot,
  type CanonicalMessageContentSlot,
  type ConversationCanonicalMessage,
  ChatStreamStatus,
  type ConversationCharacterData,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  getRealmChatTimelineDisplayModel,
  useRealmMessageTimeline,
  type RealmChatOutboxEntryLike,
} from '@nimiplatform/nimi-kit/features/chat/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { GiftMessageBubble, type GiftMessagePayload } from '@renderer/features/economy/gift-message-bubble.js';
import type { HumanChatViewDto } from './chat-human-thread-model';
import { useChatUploadPlaceholders } from '../turns/chat-upload-placeholder-store';
import {
  resolveCanonicalChatAttachmentPreviewText,
  resolveCanonicalChatAttachmentUrl,
} from '../turns/chat-attachment-contract.js';
import { cancelStream, getStreamState, subscribeStream, type StreamState } from '../turns/stream-controller';
export { HumanCanonicalComposer, HumanCanonicalProfileDrawer } from './chat-human-canonical-composer-profile';

type MessageViewDto = RealmModel<'MessageViewDto'>;

function resolveAttachmentDisplayKind(payload: unknown): string {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const attachment = record?.attachment && typeof record.attachment === 'object' && !Array.isArray(record.attachment)
    ? record.attachment as Record<string, unknown>
    : null;
  const preview = attachment?.preview && typeof attachment.preview === 'object' && !Array.isArray(attachment.preview)
    ? attachment.preview as Record<string, unknown>
    : null;
  return String(preview?.displayKind || attachment?.displayKind || '').trim().toUpperCase();
}

function useHumanStreamState(chatId: string | null): StreamState | null {
  const [state, setState] = useState<StreamState | null>(() => (chatId ? getStreamState(chatId) : null));

  useEffect(() => {
    if (!chatId) {
      setState(null);
      return;
    }
    setState(getStreamState(chatId));
    return subscribeStream((updated) => {
      if (updated.chatId === chatId) {
        setState({ ...updated });
      }
    });
  }, [chatId]);

  return state;
}

function useHumanTimelineModel(selectedChatId: string | null, selectedChat: HumanChatViewDto | null) {
  const authStatus = useAppStore((state) => state.auth.status);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const currentUserAvatarUrl = typeof currentUser?.avatarUrl === 'string' ? currentUser.avatarUrl : null;
  const uploadPlaceholders = useChatUploadPlaceholders(selectedChatId);
  const streamState = useHumanStreamState(selectedChatId);
  const isStreaming = streamState?.phase === 'waiting' || streamState?.phase === 'streaming';
  const otherUser = selectedChat?.otherUser;
  const contactName = String(otherUser?.displayName || otherUser?.handle || 'Chat').trim();
  const contactAvatarUrl = otherUser?.avatarUrl || null;
  const messagesQuery = useQuery({
    queryKey: ['messages', selectedChatId],
    queryFn: async () => {
      if (!selectedChatId) {
        return null;
      }
      return await dataSync.loadMessages(selectedChatId);
    },
    enabled: authStatus === 'authenticated' && Boolean(selectedChatId),
  });

  const timelineMessages = useRealmMessageTimeline({
    messagesData: messagesQuery.data as { items?: readonly MessageViewDto[]; offlineOutbox?: readonly RealmChatOutboxEntryLike[] } | undefined,
    currentUserId,
    uploadPlaceholders,
  });

  const canonicalMessages = useMemo(
    () => timelineMessages.map((message) => {
      const display = getRealmChatTimelineDisplayModel(message, currentUserId);
      const attachmentDisplayKind = resolveAttachmentDisplayKind(message.payload);
      const mediaUrl = display.isMediaMessage
        ? resolveCanonicalChatAttachmentUrl(message.payload, realmBaseUrl) || display.localPreviewUrl || null
        : null;
      const mediaLabel = display.isMediaMessage
        ? resolveCanonicalChatAttachmentPreviewText(message.payload)
        : '';
      return {
        id: String(message.id || message.clientMessageId || ''),
        sessionId: String(selectedChatId || ''),
        targetId: String(selectedChat?.otherUser?.id || selectedChatId),
        source: 'human' as const,
        role: display.isMe ? 'human' as const : 'assistant' as const,
        text: display.resolvedText || '',
        createdAt: String(message.createdAt || ''),
        updatedAt: String(message.editedAt || message.createdAt || ''),
        status: display.deliveryState === 'pending'
          ? 'pending' as const
          : display.deliveryState === 'failed'
            ? 'error' as const
            : 'complete' as const,
        error: display.deliveryError,
        kind: display.isGiftMessage
          ? 'gift' as const
          : attachmentDisplayKind === 'AUDIO'
            ? 'voice' as const
          : display.isImageMessage
            ? (display.isUploadingMedia ? 'image-pending' as const : 'image' as const)
            : display.isVideoMessage
              ? (display.isUploadingMedia ? 'video-pending' as const : 'video' as const)
              : 'text' as const,
        senderName: display.isMe ? 'You' : contactName,
        senderAvatarUrl: display.isMe ? currentUserAvatarUrl : contactAvatarUrl,
        senderHandle: display.isMe ? null : String(selectedChat?.otherUser?.handle || '').trim() || null,
        senderKind: 'human' as const,
        metadata: {
          realmMessage: message,
          display,
          mediaUrl,
          mediaLabel,
          voiceUrl: attachmentDisplayKind === 'AUDIO'
            ? resolveCanonicalChatAttachmentUrl(message.payload, realmBaseUrl) || display.localPreviewUrl || null
            : null,
          voiceTranscript: display.resolvedText || '',
          mediaWidth: (message as unknown as { width?: number }).width,
          mediaHeight: (message as unknown as { height?: number }).height,
        },
      };
    }),
    [contactAvatarUrl, contactName, currentUserAvatarUrl, currentUserId, realmBaseUrl, selectedChat?.otherUser?.handle, selectedChat?.otherUser?.id, selectedChatId, timelineMessages],
  );

  return {
    authStatus,
    realmBaseUrl,
    currentUserId,
    currentUserAvatarUrl,
    contactName,
    contactAvatarUrl,
    messagesQuery,
    timelineMessages,
    canonicalMessages,
    streamState,
    isStreaming,
  };
}

function useHumanVoiceUiState() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoiceMessageId, setPlayingVoiceMessageId] = useState<string | null>(null);
  const [voiceTranscriptVisibleById, setVoiceTranscriptVisibleById] = useState<Record<string, boolean>>({});
  const [voiceContextMenu, setVoiceContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [selectedVoiceMessageId, setSelectedVoiceMessageId] = useState<string | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    if (!voiceContextMenu) {
      return undefined;
    }
    const handlePointerDown = () => {
      setVoiceContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVoiceContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [voiceContextMenu]);

  const onPlayVoiceMessage = useCallback((message: ConversationCanonicalMessage) => {
    const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
    const voiceUrl = String(metadata.voiceUrl || '').trim();
    if (!voiceUrl || typeof Audio === 'undefined') {
      return;
    }
    setSelectedVoiceMessageId(message.id);
    if (playingVoiceMessageId === message.id && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingVoiceMessageId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(voiceUrl);
    audioRef.current = audio;
    audio.addEventListener('ended', () => {
      if (audioRef.current === audio) {
        setPlayingVoiceMessageId(null);
      }
    });
    audio.addEventListener('pause', () => {
      if (audioRef.current === audio && audio.ended === false) {
        setPlayingVoiceMessageId(null);
      }
    });
    audio.addEventListener('error', () => {
      if (audioRef.current === audio) {
        setPlayingVoiceMessageId(null);
      }
    });
    void audio.play().then(() => {
      setPlayingVoiceMessageId(message.id);
    }).catch(() => {
      if (audioRef.current === audio) {
        setPlayingVoiceMessageId(null);
      }
    });
  }, [playingVoiceMessageId]);

  const onVoiceContextMenu = useCallback((message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedVoiceMessageId(message.id);
    setVoiceContextMenu({
      messageId: message.id,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const toggleVoiceTranscript = useCallback((messageId: string) => {
    setVoiceTranscriptVisibleById((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
    setVoiceContextMenu(null);
  }, []);

  const rightSidebarOverlayMenu: ReactNode = voiceContextMenu ? (
    <div
      className="fixed z-50 min-w-[160px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl"
      style={{ left: `${voiceContextMenu.x}px`, top: `${voiceContextMenu.y}px`, animation: 'panel-scale-in 0.15s ease-out both' }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100"
        onClick={() => toggleVoiceTranscript(voiceContextMenu.messageId)}
      >
        {voiceTranscriptVisibleById[voiceContextMenu.messageId]
          ? t('Chat.voiceCollapseTranscript', { defaultValue: 'Collapse transcript' })
          : t('Chat.voiceTranscribe', { defaultValue: 'Transcribe voice' })}
      </button>
    </div>
  ) : null;

  return {
    playingVoiceMessageId,
    selectedVoiceMessageId,
    isVoiceTranscriptVisible: (message: ConversationCanonicalMessage) => Boolean(voiceTranscriptVisibleById[message.id]),
    onPlayVoiceMessage,
    onVoiceContextMenu,
    toggleVoiceTranscript,
    rightSidebarOverlayMenu,
  };
}

function HumanMediaMessageCard(props: {
  message: ConversationCanonicalMessage;
  imageLabel: string;
  videoLabel: string;
  uploadingLabel: string;
}) {
  const metadata = props.message.metadata as Record<string, unknown> | undefined;
  const display = metadata?.display as ReturnType<typeof getRealmChatTimelineDisplayModel> | undefined;
  const mediaUrl = typeof metadata?.mediaUrl === 'string' ? metadata.mediaUrl : '';
  const mediaLabel = typeof metadata?.mediaLabel === 'string' && metadata.mediaLabel
    ? metadata.mediaLabel
    : props.message.kind === 'video'
      ? props.videoLabel
      : props.imageLabel;
  const isUser = props.message.role === 'human' || props.message.role === 'user';

  return (
    <div className={`overflow-hidden rounded-[24px] border shadow-[0_8px_22px_rgba(15,23,42,0.08)] ${isUser ? 'border-emerald-300/60 bg-white/96' : 'border-white/80 bg-white/95'}`}>
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
        <div className="flex h-52 w-[min(22rem,72vw)] items-center justify-center bg-slate-100 text-sm text-slate-500">
          {mediaLabel}
        </div>
      )}
      <div className="space-y-1 px-4 py-3">
        <p className="text-sm font-medium text-slate-900">{mediaLabel}</p>
        {display?.isUploadingMedia ? (
          <p className="text-xs text-slate-500">{props.uploadingLabel}</p>
        ) : null}
        {props.message.error ? (
          <p className="text-xs text-red-500">{props.message.error}</p>
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
                cancelStream(props.selectedChatId);
              }
            }}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
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
        interruptedSuffix={<span className="ml-1 text-xs text-red-400">[{t('ChatTimeline.streamInterrupted', 'Response interrupted')}]</span>}
      />
    );
  }

  return null;
}

function HumanVoiceInspectSidebar(props: {
  message: ConversationCanonicalMessage;
  playing: boolean;
  transcriptVisible: boolean;
  onPlay: (message: ConversationCanonicalMessage) => void;
  onToggleTranscript: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const metadata = (props.message.metadata as Record<string, unknown> | undefined) || {};
  const transcript = String(metadata.voiceTranscript || props.message.text || '').trim();
  const senderName = String(props.message.senderName || t('Chat.voiceInspectSender', { defaultValue: 'Voice message' })).trim();

  return (
    <div className="space-y-4">
      <CanonicalDrawerSection
        title={t('Chat.voiceInspectTitle', { defaultValue: 'Voice inspect' })}
        hint={t('Chat.voiceInspectHint', { defaultValue: 'Playback and transcript controls for the selected voice beat.' })}
      >
        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-900">{senderName}</div>
          <div className="text-xs text-slate-500">
            {props.playing
              ? t('Chat.voiceInspectPlaying', { defaultValue: 'Currently playing' })
              : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => props.onPlay(props.message)}
            className="rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.24)] transition hover:-translate-y-px"
          >
            {props.playing
              ? t('Chat.voiceInspectStop', { defaultValue: 'Stop playback' })
              : t('Chat.voiceInspectPlay', { defaultValue: 'Play voice' })}
          </button>
          <button
            type="button"
            onClick={() => props.onToggleTranscript(props.message.id)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {props.transcriptVisible
              ? t('Chat.voiceCollapseTranscript', { defaultValue: 'Collapse transcript' })
              : t('Chat.voiceTranscribe', { defaultValue: 'Transcribe voice' })}
          </button>
        </div>
      </CanonicalDrawerSection>

      <CanonicalDrawerSection
        title={t('Chat.voiceInspectTranscriptTitle', { defaultValue: 'Transcript' })}
        hint={t('Chat.voiceInspectTranscriptHint', { defaultValue: 'Voice transcripts stay hidden until you explicitly reveal them.' })}
      >
        {props.transcriptVisible ? (
          <p className="text-sm leading-6 text-slate-700">
            {transcript || t('Chat.voiceInspectTranscriptUnavailable', { defaultValue: 'No transcript available for this voice beat.' })}
          </p>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
            {t('Chat.voiceInspectTranscriptHidden', { defaultValue: 'Transcript is hidden until you reveal it.' })}
          </div>
        )}
      </CanonicalDrawerSection>
    </div>
  );
}

function useHumanMessageRenderers(input: {
  selectedChatId: string | null;
  model: ReturnType<typeof useHumanTimelineModel>;
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
    const display = (message.metadata as Record<string, unknown> | undefined)?.display as ReturnType<typeof getRealmChatTimelineDisplayModel> | undefined;
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
          fallbackClassName={isMe ? 'bg-[#0066CC] text-white' : undefined}
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
      <div className={`mt-1 text-[10px] ${message.error ? 'text-red-500' : 'text-slate-400'} ${message.role === 'human' || message.role === 'user' ? 'text-right' : 'text-left'}`}>
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
  selectedChat: HumanChatViewDto | null;
}) {
  const transcriptProps = useHumanCanonicalTranscriptProps(props);
  return (
    <CanonicalTranscriptView {...transcriptProps} />
  );
}

export function HumanCanonicalStageSurface(props: {
  selectedChatId: string;
  selectedChat: HumanChatViewDto | null;
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
  selectedChat: HumanChatViewDto | null;
  voiceUi?: ReturnType<typeof useHumanVoiceUiState>;
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
  model: ReturnType<typeof useHumanTimelineModel>;
  t: ReturnType<typeof useTranslation>['t'];
  voiceUi?: ReturnType<typeof useHumanVoiceUiState>;
  renderers: ReturnType<typeof useHumanMessageRenderers>;
}): CanonicalTranscriptViewProps {
  return {
    messages: input.model.canonicalMessages,
    loading: input.model.messagesQuery.isPending,
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
  };
}

export function useHumanCanonicalStagePanelProps(props: {
  selectedChatId: string | null;
  selectedChat: HumanChatViewDto | null;
  characterData: ConversationCharacterData;
  stageAnchorViewportRef?: RefObject<HTMLDivElement | null>;
  stageCardAnchorOffsetPx?: number | null;
  onIntentOpenHistory?: () => void;
  voiceUi?: ReturnType<typeof useHumanVoiceUiState>;
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
  model: ReturnType<typeof useHumanTimelineModel>;
  characterData: ConversationCharacterData;
  stageAnchorViewportRef?: RefObject<HTMLDivElement | null>;
  stageCardAnchorOffsetPx?: number | null;
  onIntentOpenHistory?: () => void;
  voiceUi?: ReturnType<typeof useHumanVoiceUiState>;
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
  selectedChat: HumanChatViewDto | null;
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
