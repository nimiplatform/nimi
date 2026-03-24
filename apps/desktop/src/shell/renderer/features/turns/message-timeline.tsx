import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  useRealmMessageTimeline,
  type RealmChatOutboxEntryLike,
  type RealmChatTimelineMessage,
} from '@nimiplatform/nimi-kit/features/chat/realm';
import {
  ChatComposerResizeHandle,
  ChatComposerShell,
  ChatPanelState,
  ChatStreamStatus,
  ChatThreadHeader,
  RealmChatTimeline,
} from '@nimiplatform/nimi-kit/features/chat/ui';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import nimiLogo from '@renderer/assets/logo-gray.png';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal.js';
import { GiftMessageBubble, type GiftMessagePayload } from '@renderer/features/economy/gift-message-bubble.js';
import { toProfileData } from '@renderer/features/profile/profile-model';
import { ChatProfileCard } from './message-timeline-profile-card.js';
import { TurnInput } from './turn-input';
import {
  toChatProfileSummary,
} from './message-timeline-utils.js';

type MessageViewDto = RealmModel<'MessageViewDto'>;
type ChatViewDto = RealmModel<'ChatViewDto'>;
import { useChatUploadPlaceholders } from './chat-upload-placeholder-store';
import { type StreamState, getStreamState, subscribeStream, cancelStream } from './stream-controller';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type ProfilePanelTarget = 'self' | 'other' | null;

function useStreamState(chatId: string | null): StreamState | null {
  const [state, setState] = useState<StreamState | null>(() =>
    chatId ? getStreamState(chatId) : null,
  );

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

export function MessageTimeline() {
  const { t } = useTranslation();
  const COMPOSER_MIN_HEIGHT = 132;
  const COMPOSER_MAX_HEIGHT = 340;
  const [composerHeight, setComposerHeight] = useState(176);
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const timelineLayoutRef = useRef<HTMLDivElement>(null);
  const composerResizingRef = useRef(false);
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const authToken = useAppStore((state) => String(state.auth.token || ''));
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const currentUserAvatarUrl = typeof currentUser?.avatarUrl === 'string' ? currentUser.avatarUrl : null;
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const streamState = useStreamState(selectedChatId);
  const isStreaming = streamState?.phase === 'waiting' || streamState?.phase === 'streaming';
  const uploadPlaceholders = useChatUploadPlaceholders(selectedChatId);

  const messagesQuery = useQuery({
    queryKey: ['messages', selectedChatId],
    queryFn: async () => {
      if (!selectedChatId) {
        return { items: [] };
      }
      return dataSync.loadMessages(selectedChatId);
    },
    enabled: authStatus === 'authenticated' && Boolean(selectedChatId),
  });

  const chatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => dataSync.loadChats(),
    enabled: authStatus === 'authenticated',
  });

  const chats = (chatsQuery.data as { items?: ChatViewDto[] })?.items || [];
  const selectedChat = chats.find(
    (c) => c.id === selectedChatId,
  );

  const otherUser = selectedChat?.otherUser;
  const otherUserId = String(otherUser?.id || '').trim();
  const contactName = String(otherUser?.displayName || otherUser?.handle || 'Chat').trim();
  const contactAvatarUrl = otherUser?.avatarUrl || null;

  const messages = useRealmMessageTimeline({
    messagesData: messagesQuery.data as { items?: readonly MessageViewDto[]; offlineOutbox?: readonly RealmChatOutboxEntryLike[] } | undefined,
    currentUserId,
    uploadPlaceholders,
  }) as readonly RealmChatTimelineMessage[];

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.id, selectedChatId]);

  useEffect(() => {
    setProfilePanelTarget(null);
    setGiftModalOpen(false);
  }, [selectedChatId]);

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (!composerResizingRef.current || !timelineLayoutRef.current) {
        return;
      }
      const rect = timelineLayoutRef.current.getBoundingClientRect();
      const nextHeight = Math.min(
        COMPOSER_MAX_HEIGHT,
        Math.max(COMPOSER_MIN_HEIGHT, Math.round(rect.bottom - event.clientY)),
      );
      setComposerHeight(nextHeight);
    };

    const onMouseUp = () => {
      composerResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startComposerResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    composerResizingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const toggleProfilePanel = (target: Exclude<ProfilePanelTarget, null>) => {
    setProfilePanelTarget(profilePanelTarget === target ? null : target);
  };

  const currentUserFallback = currentUser && typeof currentUser === 'object'
    ? (currentUser as unknown as Record<string, unknown>)
    : null;
  const otherUserFallback = (otherUser as unknown as Record<string, unknown>) || null;
  const profileTargetId = profilePanelTarget === 'self' ? currentUserId : otherUserId;

  const profileQuery = useQuery({
    queryKey: ['chat-contact-profile', profilePanelTarget, profileTargetId],
    queryFn: async () => {
      if (!profileTargetId) {
        return null;
      }
      const result = await dataSync.loadUserProfile(profileTargetId);
      return result as Record<string, unknown>;
    },
    enabled: authStatus === 'authenticated' && profilePanelTarget !== null && Boolean(profileTargetId),
  });

  const profileSummary = useMemo(
    () => {
      const fallback = profilePanelTarget === 'self' ? currentUserFallback : otherUserFallback;
      return toChatProfileSummary({
        fallback,
        profile: (profileQuery.data as Record<string, unknown> | undefined) || null,
      });
    },
    [currentUserFallback, otherUserFallback, profilePanelTarget, profileQuery.data],
  );

  const profileActionLabel = profilePanelTarget === 'self'
    ? t('ChatTimeline.openMyProfile')
    : t('ChatTimeline.openUserProfile');

  if (!selectedChatId) {
    return (
      <ChatPanelState
        data-testid={E2E_IDS.messageTimeline}
        activeChatId=""
        className="bg-white text-inherit"
      >
        <img
          src={nimiLogo}
          alt="Nimi"
          className="w-64 h-64 object-contain select-none pointer-events-none"
          draggable={false}
        />
      </ChatPanelState>
    );
  }

  if (messagesQuery.isPending) {
    return (
      <ChatPanelState dataTestId={E2E_IDS.messageTimeline} activeChatId={selectedChatId}>
        {t('ChatTimeline.loadingMessages')}
      </ChatPanelState>
    );
  }

  if (messagesQuery.isError) {
    return (
      <ChatPanelState dataTestId={E2E_IDS.messageTimeline} activeChatId={selectedChatId} tone="error">
        {t('ChatTimeline.messageLoadError')}
      </ChatPanelState>
    );
  }

  return (
    <section data-testid={E2E_IDS.messageTimeline} data-active-chat-id={selectedChatId} className="flex h-full min-w-0">
      <div ref={timelineLayoutRef} className="flex min-w-0 flex-1 flex-col">
        <ChatThreadHeader
          title={contactName}
          onTitleClick={() => toggleProfilePanel('other')}
          titleAriaLabel={profilePanelTarget === 'other'
            ? t('ChatTimeline.collapseUserProfile')
            : t('ChatTimeline.viewUserProfile')}
          titleClassName=""
        />

        {/* Messages */}
        <ScrollShell
          className="flex-1 bg-white"
          viewportClassName="bg-white"
          contentClassName="space-y-4 px-4 py-4"
        >
          <RealmChatTimeline
            messages={messages}
            currentUserId={currentUserId}
            realmBaseUrl={realmBaseUrl}
            authToken={authToken}
            emptyState={<p className="text-center text-sm text-gray-500">{t('Chat.noMessages')}</p>}
            emptyMessageLabel={t('ChatTimeline.emptyMessage')}
            imageMessageLabel={t('ChatTimeline.imageMessage', 'Image')}
            videoMessageLabel={t('ChatTimeline.videoMessage', 'Video')}
            queuedLocallyLabel={t('ChatTimeline.queuedLocally')}
            sendFailedLabel={t('ChatTimeline.sendFailed')}
            uploadingMediaLabel={t('ChatTimeline.uploadingMedia', 'Uploading...')}
            yesterdayLabel={t('Chat.yesterday', { defaultValue: 'Yesterday' })}
            renderAvatar={({ message, display, isMe }) => {
              const senderName = isMe ? t('ChatTimeline.you') : contactName;
              const messageProfileTarget: Exclude<ProfilePanelTarget, null> = isMe ? 'self' : 'other';
              return (
                <button
                  type="button"
                  onClick={() => toggleProfilePanel(messageProfileTarget)}
                  className={`${display.isMediaMessage || display.isGiftMessage ? 'mt-0' : 'mt-1'} shrink-0`}
                  aria-label={profilePanelTarget === messageProfileTarget
                    ? (isMe ? t('ChatTimeline.collapseMyProfile') : t('ChatTimeline.collapseUserProfile'))
                    : (isMe ? t('ChatTimeline.viewMyProfile') : t('ChatTimeline.viewUserProfile'))}
                >
                  <EntityAvatar
                    imageUrl={isMe ? currentUserAvatarUrl : contactAvatarUrl}
                    name={senderName}
                    kind="human"
                    sizeClassName="h-8 w-8"
                    textClassName="text-xs font-medium"
                    fallbackClassName={isMe ? 'bg-[#0066CC] text-white' : undefined}
                  />
                </button>
              );
            }}
            renderGiftMessage={({ message, isMe }) => (
              <GiftMessageBubble
                payload={message.payload as unknown as GiftMessagePayload}
                isMe={isMe}
                currentUserId={currentUserId}
              />
            )}
          />

          {/* Streaming indicator */}
          {streamState && isStreaming && (
            <ChatStreamStatus
              mode="streaming"
              partialText={streamState.partialText}
              avatar={(
                <EntityAvatar
                  imageUrl={contactAvatarUrl}
                  name={contactName}
                  kind="human"
                  sizeClassName="mt-1 h-8 w-8 shrink-0"
                  textClassName="text-xs font-medium"
                />
              )}
              actions={(
                <button
                  type="button"
                  onClick={() => selectedChatId && cancelStream(selectedChatId)}
                  className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
                >
                  {t('ChatTimeline.stopGenerating', 'Stop generating')}
                </button>
              )}
            />
          )}

          {/* Stream interrupted / error indicator */}
          {streamState && (streamState.phase === 'error' || streamState.phase === 'cancelled') && streamState.interrupted && (
            <ChatStreamStatus
              mode="interrupted"
              partialText={streamState.partialText}
              errorMessage={streamState.errorMessage}
              avatar={(
                <EntityAvatar
                  imageUrl={contactAvatarUrl}
                  name={contactName}
                  kind="human"
                  sizeClassName="mt-1 h-8 w-8 shrink-0"
                  textClassName="text-xs font-medium"
                />
              )}
              interruptedSuffix={<span className="ml-1 text-xs text-red-400">[{t('ChatTimeline.streamInterrupted', 'Response interrupted')}]</span>}
            />
          )}

          <div ref={bottomRef} />
        </ScrollShell>
        <ChatComposerResizeHandle
          ariaLabel={t('ChatTimeline.resizeInputArea')}
          onMouseDown={startComposerResize}
        />

        <ChatComposerShell height={composerHeight}>
          <TurnInput
            className="h-full"
            showTopBorder={false}
            onOpenGift={otherUserId ? () => setGiftModalOpen(true) : undefined}
          />
        </ChatComposerShell>
      </div>

      {profilePanelTarget ? (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
          <ScrollShell className="flex-1" contentClassName="px-4 py-4">
            <ChatProfileCard
              profileData={toProfileData(profileQuery.data || profileSummary)}
              onClose={() => setProfilePanelTarget(null)}
              onViewFullProfile={() => {
                if (!profileSummary.id) return;
                navigateToProfile(profileSummary.id, 'profile');
              }}
              viewFullProfileLabel={profileActionLabel}
              onOpenGift={profilePanelTarget === 'other' && profileSummary.id
                ? () => setGiftModalOpen(true)
                : undefined}
            />
          </ScrollShell>
        </aside>
      ) : null}

      <SendGiftModal
        open={giftModalOpen && Boolean(otherUserId)}
        receiverId={otherUserId}
        receiverName={contactName}
        receiverHandle={String(otherUser?.handle || '')}
        receiverIsAgent={otherUser?.isAgent === true}
        receiverAvatarUrl={contactAvatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setStatusBanner({
            kind: 'success',
            message: t('Contacts.giftSentTo', {
              name: contactName,
              defaultValue: 'Gift sent to {{name}}',
            }),
          });
        }}
      />
    </section>
  );
}
