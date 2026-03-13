import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import type { MessageViewDto } from '@nimiplatform/sdk/realm';
import type { ChatViewDto } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import nimiLogo from '@renderer/assets/logo-gray.png';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal.js';
import { toProfileData } from '@renderer/features/profile/profile-model';
import { ChatProfileCard } from './message-timeline-profile-card.js';
import { TurnInput } from './turn-input';
import {
  ChatMessageImage,
  extractMessageDiagnostics,
  formatDateSeparator,
  resolveImageMessageUrl,
  resolveMessageText,
  resolveVideoMessageUrl,
  shouldShowTimestamp,
  toChatProfileSummary,
  toMessageTimestamp,
} from './message-timeline-utils.js';
import {
  sameChatTimelineIdentity,
  toChatTimelineOutboxMessage,
  toChatTimelineRemoteMessage,
  type ChatTimelineMessage,
} from './chat-timeline-message';
import { type StreamState, getStreamState, subscribeStream, cancelStream } from './stream-controller';

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
  const COMPOSER_MIN_HEIGHT = 108;
  const COMPOSER_MAX_HEIGHT = 340;
  const [composerHeight, setComposerHeight] = useState(136);
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
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const [expandedDiagnosticsMessageId, setExpandedDiagnosticsMessageId] = useState<string | null>(null);
  const streamState = useStreamState(selectedChatId);
  const isStreaming = streamState?.phase === 'waiting' || streamState?.phase === 'streaming';

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

  const messages = useMemo(() => {
    const remoteItems = ((messagesQuery.data?.items || []) as MessageViewDto[])
      .map((message) => toChatTimelineRemoteMessage(message));
    const offlineOutbox = Array.isArray((messagesQuery.data as { offlineOutbox?: unknown } | undefined)?.offlineOutbox)
      ? ((messagesQuery.data as { offlineOutbox?: unknown }).offlineOutbox as import('@runtime/offline').PersistentOutboxEntry[])
      : [];
    const merged: ChatTimelineMessage[] = remoteItems.slice();
    for (const entry of offlineOutbox) {
      const placeholder = toChatTimelineOutboxMessage(entry, currentUserId);
      if (merged.some((message) => sameChatTimelineIdentity(message, placeholder))) {
        continue;
      }
      merged.push(placeholder);
    }
    merged.sort((left, right) => {
      const timeDiff = toMessageTimestamp(left) - toMessageTimestamp(right);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return String(left.clientMessageId || left.id || '').localeCompare(String(right.clientMessageId || right.id || ''));
    });
    return merged;
  }, [currentUserId, messagesQuery.data]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.id, selectedChatId]);

  useEffect(() => {
    setProfilePanelTarget(null);
    setExpandedDiagnosticsMessageId(null);
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
      <section className="flex h-full items-center justify-center bg-white">
        <img 
          src={nimiLogo} 
          alt="Nimi" 
          className="w-64 h-64 object-contain"
        />
      </section>
    );
  }

  if (messagesQuery.isPending) {
    return (
      <section className="flex h-full items-center justify-center text-sm text-gray-500">
        {t('ChatTimeline.loadingMessages')}
      </section>
    );
  }

  if (messagesQuery.isError) {
    return (
      <section className="flex h-full items-center justify-center text-sm text-red-600">
        {t('ChatTimeline.messageLoadError')}
      </section>
    );
  }

  return (
    <section className="flex h-full min-w-0">
      <div ref={timelineLayoutRef} className="flex min-w-0 flex-1 flex-col">
        {/* Chat header */}
        <header className="flex h-14 shrink-0 items-center bg-white px-4">
          {/* Name - clickable to open profile panel */}
          <button
            type="button"
            onClick={() => toggleProfilePanel('other')}
            className="text-[15px] font-semibold text-gray-900 hover:text-gray-700 transition-colors"
            aria-label={profilePanelTarget === 'other'
              ? t('ChatTimeline.collapseUserProfile')
              : t('ChatTimeline.viewUserProfile')}
          >
            {contactName}
          </button>
        </header>

        {/* Messages */}
        <div className="app-scroll-shell flex-1 space-y-4 overflow-y-auto bg-white px-4 py-4">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-gray-500">{t('Chat.noMessages')}</p>
          ) : (
            messages.map((message, index) => {
              const isMe = message.deliveryState !== 'sent' || message.senderId === currentUserId;
              const senderName = isMe ? t('ChatTimeline.you') : contactName;
              const messageProfileTarget: Exclude<ProfilePanelTarget, null> = isMe ? 'self' : 'other';
              const showTimestamp = shouldShowTimestamp(message, index > 0 ? (messages[index - 1] ?? null) : null);
              const timestampLabel = showTimestamp ? formatDateSeparator(message.createdAt) : '';
              const isImageMessage = String(message.type || '').toUpperCase() === 'IMAGE';
              const isVideoMessage = String(message.type || '').toUpperCase() === 'VIDEO';
              const isMediaMessage = isImageMessage || isVideoMessage;
              const avatarMarginTopClass = isMediaMessage ? 'mt-0' : 'mt-1';
              const imageUrl = isImageMessage ? resolveImageMessageUrl(message, realmBaseUrl) : '';
              const videoUrl = isVideoMessage ? resolveVideoMessageUrl(message, realmBaseUrl) : '';
              const resolvedMessageText = resolveMessageText(message) || t('ChatTimeline.emptyMessage');
              const messageAvatarKind = !isMe && otherUser?.isAgent ? 'agent' : 'human';
              const diagnostics = extractMessageDiagnostics(message);
              const hasDiagnosticData = Boolean(
                diagnostics.interactionKind
                || diagnostics.reasonCode
                || diagnostics.actionHint
                || diagnostics.turnAudit.length > 0,
              );
              const diagnosticsExpanded = expandedDiagnosticsMessageId === message.id;
              return (
                <div key={message.id || message.clientMessageId}>
                  {showTimestamp && timestampLabel ? (
                    <div className="my-6 flex items-center justify-center">
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-500">{timestampLabel}</span>
                    </div>
                  ) : null}
                <div className={`flex items-start gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                  {/* Avatar */}
                  <button
                    type="button"
                    onClick={() => toggleProfilePanel(messageProfileTarget)}
                    className={`${avatarMarginTopClass} shrink-0`}
                    aria-label={profilePanelTarget === messageProfileTarget
                      ? (isMe ? t('ChatTimeline.collapseMyProfile') : t('ChatTimeline.collapseUserProfile'))
                      : (isMe ? t('ChatTimeline.viewMyProfile') : t('ChatTimeline.viewUserProfile'))}
                  >
                    <EntityAvatar
                      imageUrl={isMe ? currentUserAvatarUrl : contactAvatarUrl}
                      name={senderName}
                      kind={isMe ? 'human' : messageAvatarKind}
                      sizeClassName="h-8 w-8"
                      textClassName="text-xs font-medium"
                      fallbackClassName={isMe ? 'bg-[#0066CC] text-white' : undefined}
                    />
                  </button>
                  {/* Bubble */}
                  <div className={`max-w-[75%] ${isMe ? 'text-right' : ''}`}>
                    <div className={`inline-block rounded-[18px] text-[15px] leading-snug ${
                      isMediaMessage
                        ? 'bg-transparent text-gray-900'
                        : isMe
                        ? 'bg-[#0066CC] text-white'
                        : 'bg-[#F2F2F7] text-gray-900'
                    } ${isMediaMessage ? 'p-0 overflow-hidden' : 'px-4 py-2.5'}`}>
                      {diagnostics.interactionKind && (
                        <div className={`mb-1 inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                          isMe
                            ? 'border-[#b8b1d6] bg-[#f3f0fc] text-[#69608e]'
                            : 'border-[#bfd0b8] bg-[#f2f7ef] text-[#5d7757]'
                        }`}>
                          interaction: {diagnostics.interactionKind}
                        </div>
                      )}
                      {isImageMessage ? (
                        imageUrl ? (
                          <ChatMessageImage
                            src={imageUrl}
                            alt={t('ChatTimeline.imageMessage', 'Image')}
                            realmBaseUrl={realmBaseUrl}
                            authToken={authToken}
                          />
                        ) : (
                          <span>{t('ChatTimeline.imageMessage', 'Image')}</span>
                        )
                      ) : isVideoMessage ? (
                        videoUrl ? (
                          <video
                            src={videoUrl}
                            controls
                            className="max-h-[320px] max-w-[260px] rounded-xl"
                          />
                        ) : (
                          <span>{t('ChatTimeline.videoMessage', 'Video')}</span>
                        )
                      ) : (
                        resolvedMessageText
                      )}

                      {hasDiagnosticData && (
                        <div className={`mt-2 ${isMe ? 'text-right' : 'text-left'}`}>
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedDiagnosticsMessageId((previous) => (
                                previous === message.id ? null : message.id
                              ));
                            }}
                            className={`rounded-md border px-2 py-0.5 text-[10px] ${
                              isMe
                                ? 'border-[#b8b1d6] bg-[#f3f0fc] text-[#69608e]'
                                : 'border-[#bfd0b8] bg-[#f2f7ef] text-[#5d7757]'
                            }`}
                          >
                            details
                          </button>
                          {diagnosticsExpanded && (
                            <div className={`mt-1 rounded-md border px-2 py-1 text-[10px] ${
                              isMe
                                ? 'border-[#b8b1d6] bg-[#f4f1fb] text-[#6d668e]'
                                : 'border-[#bfd0b8] bg-[#f3f8f1] text-[#5f755a]'
                            }`}>
                              {diagnostics.reasonCode && <p>reasonCode: {diagnostics.reasonCode}</p>}
                              {diagnostics.actionHint && <p>actionHint: {diagnostics.actionHint}</p>}
                              {diagnostics.turnAudit.length > 0 && (
                                <div className="mt-1 border-t border-current/20 pt-1">
                                  <p className="font-semibold">{t('ChatTimeline.turnAuditLabel')}</p>
                                  {diagnostics.turnAudit.map((entry) => (
                                    <p key={entry.key}>
                                      {entry.key}: {entry.value}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {message.deliveryState !== 'sent' ? (
                      <div
                        className={`mt-1 px-1 text-[11px] ${
                          isMe ? 'text-right' : 'text-left'
                        } ${
                          message.deliveryState === 'failed'
                            ? 'text-red-500'
                            : 'text-amber-600'
                        }`}
                      >
                        {message.deliveryState === 'failed'
                          ? (message.deliveryError || t('ChatTimeline.sendFailed'))
                          : t('ChatTimeline.queuedLocally')}
                      </div>
                    ) : null}
                  </div>
                </div>
                </div>
              );
            })
          )}

          {/* Streaming indicator */}
          {streamState && isStreaming && (
            <div className="flex gap-2">
              <EntityAvatar
                imageUrl={contactAvatarUrl}
                name={contactName}
                kind={otherUser?.isAgent ? 'agent' : 'human'}
                sizeClassName="mt-1 h-8 w-8 shrink-0"
                textClassName="text-xs font-medium"
              />
              <div className="max-w-[75%]">
                <div className="inline-block rounded-[18px] bg-[#F2F2F7] px-4 py-2.5 text-[15px] leading-snug text-gray-900">
                  {streamState.partialText || (
                    <span className="inline-flex items-center gap-1 text-gray-400">
                      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
                      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => selectedChatId && cancelStream(selectedChatId)}
                    className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
                  >
                    {t('ChatTimeline.stopGenerating', 'Stop generating')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Stream interrupted / error indicator */}
          {streamState && (streamState.phase === 'error' || streamState.phase === 'cancelled') && streamState.interrupted && (
            <div className="flex gap-2">
              <EntityAvatar
                imageUrl={contactAvatarUrl}
                name={contactName}
                kind={otherUser?.isAgent ? 'agent' : 'human'}
                sizeClassName="mt-1 h-8 w-8 shrink-0"
                textClassName="text-xs font-medium"
              />
              <div className="max-w-[75%]">
                <div className="inline-block rounded-[18px] bg-[#F2F2F7] px-4 py-2.5 text-[15px] leading-snug text-gray-900">
                  {streamState.partialText}
                  <span className="ml-1 text-xs text-red-400">[{t('ChatTimeline.streamInterrupted', 'Response interrupted')}]</span>
                </div>
                {streamState.errorMessage && (
                  <p className="mt-1 text-xs text-red-400">{streamState.errorMessage}</p>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('ChatTimeline.resizeInputArea')}
          onMouseDown={startComposerResize}
          className="relative h-2 shrink-0 cursor-row-resize bg-transparent"
        >
          <div className="absolute left-0 right-0 top-1/2 h-[0.5px] -translate-y-1/2 bg-gray-100/80" />
        </div>

        <div className="shrink-0" style={{ height: `${composerHeight}px` }}>
          <TurnInput className="h-full" showTopBorder={false} />
        </div>
      </div>

      {profilePanelTarget ? (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
          <div className="app-scroll-shell flex-1 overflow-y-auto">
            <div className="px-4 py-4">
              <ChatProfileCard 
                profileData={toProfileData(profileQuery.data || profileSummary)}
                onClose={() => setProfilePanelTarget(null)}
                onViewFullProfile={() => {
                  if (!profileSummary.id) return;
                  navigateToProfile(profileSummary.id, profileSummary.isAgent ? 'agent-detail' : 'profile');
                }}
                viewFullProfileLabel={profileActionLabel}
                onOpenGift={profilePanelTarget === 'other' && profileSummary.id
                  ? () => setGiftModalOpen(true)
                  : undefined}
              />
            </div>
          </div>
        </aside>
      ) : null}

      <SendGiftModal
        open={giftModalOpen && profilePanelTarget === 'other' && Boolean(profileSummary.id)}
        receiverId={profileSummary.id}
        receiverName={profileSummary.displayName}
        receiverHandle={profileSummary.handle}
        receiverAvatarUrl={profileSummary.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
      />
    </section>
  );
}
