import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import type { MessageViewDto } from '@nimiplatform/sdk/realm';
import type { ChatViewDto } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import nimiLogo from '@renderer/assets/logo-gray.png';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ProfileData } from '@renderer/features/profile/profile-model';
import { toProfileData, formatProfileDate } from '@renderer/features/profile/profile-model';
import { PostsTab } from '@renderer/features/profile/components/posts-tab';
import { TurnInput } from './turn-input';
import { type StreamState, getStreamState, subscribeStream, cancelStream } from './stream-controller';

function resolveMessageText(message: MessageViewDto): string {
  const text = String(message.text || '').trim();
  if (text) return text;

  const payload = message.payload as Record<string, unknown> | null;
  const payloadText = String(payload?.content || payload?.text || '').trim();
  if (payloadText) return payloadText;

  return '';
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveMediaUrl(
  payload: Record<string, unknown> | null,
  realmBaseUrl: string,
  keys: string[],
): string {
  if (!payload) {
    return '';
  }
  for (const key of keys) {
    const value = String(payload[key] || '').trim();
    if (!value) {
      continue;
    }
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    if (value.startsWith('/')) {
      return `${realmBaseUrl}${value}`;
    }
  }
  return '';
}

function resolveImageMessageUrl(message: MessageViewDto, realmBaseUrl: string): string {
  const payload = toRecord(message.payload);
  const directUrl = resolveMediaUrl(
    payload,
    realmBaseUrl,
    ['url', 'imageUrl', 'imageURL', 'src', 'mediaUrl', 'mediaURL'],
  );
  if (directUrl) {
    return directUrl;
  }
  const imageId = String(payload?.imageId || payload?.id || '').trim();
  if (!imageId || !realmBaseUrl) {
    return '';
  }
  return `${realmBaseUrl}/api/media/images/${encodeURIComponent(imageId)}`;
}

function resolveVideoMessageUrl(message: MessageViewDto, realmBaseUrl: string): string {
  const payload = toRecord(message.payload);
  const directUrl = resolveMediaUrl(
    payload,
    realmBaseUrl,
    ['url', 'videoUrl', 'videoURL', 'streamUrl', 'streamURL', 'mediaUrl', 'mediaURL'],
  );
  if (directUrl) {
    return directUrl;
  }
  const videoId = String(payload?.videoId || payload?.uid || payload?.id || '').trim();
  if (!videoId || !realmBaseUrl) {
    return '';
  }
  return `${realmBaseUrl}/api/media/videos/${encodeURIComponent(videoId)}`;
}

function ChatMessageImage(input: {
  src: string;
  alt: string;
  realmBaseUrl: string;
  authToken: string;
}) {
  const [resolvedSrc, setResolvedSrc] = useState(input.src);

  useEffect(() => {
    setResolvedSrc(input.src);
    const normalizedSrc = String(input.src || '').trim();
    const normalizedBase = String(input.realmBaseUrl || '').trim().replace(/\/$/, '');
    const token = String(input.authToken || '').trim();
    if (!normalizedSrc || !normalizedBase || !token || !normalizedSrc.startsWith(`${normalizedBase}/`)) {
      return;
    }

    let revokedUrl = '';
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch(normalizedSrc, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          return;
        }
        const blob = await response.blob();
        if (cancelled) {
          return;
        }
        revokedUrl = URL.createObjectURL(blob);
        setResolvedSrc(revokedUrl);
      } catch {
        // Keep original URL fallback when authenticated fetch is unavailable.
      }
    };
    void run();

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [input.src, input.realmBaseUrl, input.authToken]);

  return (
    <img
      src={resolvedSrc}
      alt={input.alt}
      className="max-h-[320px] max-w-[260px] rounded-xl object-contain"
    />
  );
}

function toMessageTimestamp(message: MessageViewDto): number {
  const parsed = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Format timestamp according to WeChat-style rules:
 * - Same day: "12:20" (24h format)
 * - Yesterday: "Yesterday 12:07"
 * - Within 7 days: "Monday 13:48" (weekday)
 * - Within current year: "Feb 14, 10:30" (month + day)
 * - Previous years: "Dec 25, 2025, 18:00" (full date with year)
 */
function formatDateSeparator(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
  const sameYear = date.getFullYear() === now.getFullYear();
  
  // Format time in 24h format
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
  
  if (diffDays === 0) {
    // Same day: "12:20"
    return timeStr;
  }
  
  if (diffDays === 1) {
    // Yesterday: "Yesterday 12:07"
    return `Yesterday ${timeStr}`;
  }
  
  if (diffDays < 7) {
    // Within 7 days: "Monday 13:48"
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    return `${weekday} ${timeStr}`;
  }
  
  if (sameYear) {
    // Within current year: "Feb 14, 10:30"
    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${monthDay}, ${timeStr}`;
  }
  
  // Previous years: "Dec 25, 2025, 18:00"
  const fullDate = date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
  return `${fullDate}, ${timeStr}`;
}

/**
 * Check if we should show a timestamp between two messages.
 * Returns true if:
 * 1. It's the first message (prevMessage is null)
 * 2. Date changed between messages
 * 3. Time gap is more than 5 minutes (300 seconds)
 */
function shouldShowTimestamp(currentMessage: MessageViewDto, prevMessage: MessageViewDto | null): boolean {
  if (!prevMessage) return true;
  
  const currentTime = toMessageTimestamp(currentMessage);
  const prevTime = toMessageTimestamp(prevMessage);
  
  // Check if date changed
  const currentDateKey = getDateKey(currentMessage.createdAt);
  const prevDateKey = getDateKey(prevMessage.createdAt);
  if (currentDateKey !== prevDateKey) return true;
  
  // Check if time gap is more than 5 minutes (300 seconds = 300000 ms)
  const timeGap = currentTime - prevTime;
  return timeGap > 300000;
}

function getDateKey(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

type ChatMessageDiagnostics = {
  interactionKind: string;
  reasonCode: string;
  actionHint: string;
  turnAudit: Array<{ key: string; value: string }>;
};

type UnknownRecord = Record<string, unknown>;

function readRecordField(input: UnknownRecord | null, key: string): UnknownRecord | null {
  if (!input) {
    return null;
  }
  const value = input[key];
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UnknownRecord;
}

function readStringField(input: UnknownRecord | null, key: string): string {
  if (!input) {
    return '';
  }
  const value = input[key];
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function extractMessageDiagnostics(message: MessageViewDto): ChatMessageDiagnostics {
  const payload =
    message.payload && typeof message.payload === 'object'
      ? (message.payload as Record<string, unknown>)
      : null;
  const diagnostics = readRecordField(payload, 'diagnostics');
  const interaction = readRecordField(payload, 'interaction');

  const interactionKindRaw =
    (interaction?.['kind'] as string | undefined)
    || (interaction?.['type'] as string | undefined)
    || (interaction?.['eventKind'] as string | undefined);
  const interactionKind =
    typeof interactionKindRaw === 'string' && interactionKindRaw.trim().length > 0
      ? interactionKindRaw.trim().toLowerCase().replace('interaction.', '')
      : '';

  const reasonCode =
    readStringField(diagnostics, 'reasonCode')
    || readStringField(payload, 'reasonCode');
  const actionHint =
    readStringField(diagnostics, 'actionHint')
    || readStringField(payload, 'actionHint');

  const turnAuditRecord =
    readRecordField(diagnostics, 'turnAudit')
    || readRecordField(payload, 'turnAudit');
  const turnAudit = turnAuditRecord
    ? Object.entries(turnAuditRecord)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
      .map(([key, value]) => ({
        key,
        value: String(value),
      }))
    : [];

  return {
    interactionKind,
    reasonCode,
    actionHint,
    turnAudit,
  };
}

type ChatProfileSummary = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  isAgent: boolean;
  isOnline: boolean;
  bio: string;
  presenceText: string;
  createdAt: string;
};

function toChatProfileSummary(input: {
  fallback?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
}): ChatProfileSummary {
  const source = (input.profile && Object.keys(input.profile).length > 0 ? input.profile : input.fallback) || {};
  const fallback = input.fallback || {};
  const displayName = String(source.displayName || fallback.displayName || source.handle || fallback.handle || 'Unknown').trim();
  const handleValue = String(source.handle || fallback.handle || '').trim();
  return {
    id: String(source.id || fallback.id || '').trim(),
    displayName: displayName || 'Unknown',
    handle: handleValue ? (handleValue.startsWith('@') ? handleValue : `@${handleValue}`) : '@unknown',
    avatarUrl: typeof source.avatarUrl === 'string'
      ? source.avatarUrl
      : typeof fallback.avatarUrl === 'string'
        ? String(fallback.avatarUrl)
        : null,
    isAgent: source.isAgent === true || fallback.isAgent === true || String(source.handle || fallback.handle || '').startsWith('~'),
    isOnline: source.isOnline === true || fallback.isOnline === true,
    bio: String(source.bio || '').trim(),
    presenceText: String(source.presenceText || fallback.presenceText || '').trim(),
    createdAt: typeof source.createdAt === 'string'
      ? source.createdAt
      : typeof fallback.createdAt === 'string'
        ? String(fallback.createdAt)
        : '',
  };
}

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
    enabled: false,
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
    const items = ((messagesQuery.data?.items || []) as MessageViewDto[]).slice();
    items.sort((left, right) => {
      const timeDiff = toMessageTimestamp(left) - toMessageTimestamp(right);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return String(left.id || '').localeCompare(String(right.id || ''));
    });
    return items;
  }, [messagesQuery.data?.items]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.id, selectedChatId]);

  useEffect(() => {
    setProfilePanelTarget(null);
    setExpandedDiagnosticsMessageId(null);
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

  const profilePanelTitle = profilePanelTarget === 'self'
    ? t('ChatTimeline.myProfile')
    : t('ChatTimeline.userProfile');
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
        <div className="flex-1 space-y-4 overflow-y-auto bg-white px-4 py-4">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-gray-500">{t('Chat.noMessages')}</p>
          ) : (
            messages.map((message, index) => {
              const isMe = message.senderId === currentUserId;
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
                <div key={message.id}>
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
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-[#F0F4F8]">
          <div className="flex h-14 shrink-0 items-center justify-between bg-white/70 px-4 backdrop-blur-xl">
            <h3 className="text-sm font-semibold text-gray-800">{profilePanelTitle}</h3>
            <button
              type="button"
              onClick={() => setProfilePanelTarget(null)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label={t('ChatTimeline.closeProfileSidebar')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Scrollable Content - Single scrollbar */}
          <div className="flex-1 overflow-y-auto">
            {/* Upper: Profile Card */}
            <div className="p-4">
              <ChatProfileCard 
                profileData={toProfileData(profileQuery.data || profileSummary)}
                onViewFullProfile={() => {
                  if (!profileSummary.id) return;
                  navigateToProfile(profileSummary.id, profileSummary.isAgent ? 'agent-detail' : 'profile');
                }}
                viewFullProfileLabel={profileActionLabel}
              />
            </div>
            {/* Lower: Posts */}
            {profileSummary.id ? (
              <div className="border-t border-gray-200/60 px-4 pb-4">
                <h3 className="py-3 text-xs font-semibold text-gray-800">{t('ProfileView.posts')}</h3>
                <PostsTab profileId={profileSummary.id} />
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </section>
  );
}


// Chat Profile Card Component - Styled like Profile page sidebar
type ChatProfileCardProps = {
  profileData: ProfileData;
  onViewFullProfile: () => void;
  viewFullProfileLabel: string;
};

function ChatProfileCard({ profileData, onViewFullProfile, viewFullProfileLabel }: ChatProfileCardProps) {
  const { t } = useTranslation();
  const friendCount = profileData.stats?.friendsCount ?? 0;
  const postCount = profileData.stats?.postsCount ?? 0;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#F0F4F8] p-5">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
      
      <div className="relative flex flex-col items-center">
        <div className="relative">
          <EntityAvatar
            imageUrl={profileData.avatarUrl}
            name={profileData.displayName}
            kind={profileData.isAgent ? 'agent' : 'human'}
            sizeClassName="h-20 w-20"
            className={profileData.isAgent ? undefined : 'ring-2 ring-white/70'}
            fallbackClassName={profileData.isAgent ? undefined : 'bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] text-[#4ECCA3]'}
            textClassName="text-2xl font-bold"
          />
          {profileData.isOnline && (
            <span className="absolute right-0.5 bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#4ECCA3] shadow-sm" />
          )}
        </div>

        {/* Name */}
        <h2 className="mt-3 text-base font-semibold tracking-tight text-gray-800">
          {profileData.displayName}
        </h2>
        <p className="text-xs text-gray-500">{profileData.handle}</p>

        {/* Type Badge */}
        <span className="mt-2 inline-flex items-center rounded-full bg-[#4ECCA3]/10 px-2.5 py-0.5 text-xs font-medium text-[#2A9D8F]">
          {profileData.isAgent ? t('ChatTimeline.agent') : t('ChatTimeline.human')}
        </span>

        {/* Bio */}
        {profileData.bio && (
          <p className="mt-2 text-center text-xs text-gray-600 leading-relaxed line-clamp-3">{profileData.bio}</p>
        )}

        {/* Stats */}
        <div className="mt-3 flex items-center gap-6">
          <div className="text-center">
            <p className="text-base font-bold text-gray-800">{friendCount}</p>
            <p className="text-[11px] text-gray-500">{t('ProfileView.friends')}</p>
          </div>
          <div className="text-center">
            <p className="text-base font-bold text-gray-800">{postCount}</p>
            <p className="text-[11px] text-gray-500">{t('ProfileView.posts')}</p>
          </div>
        </div>

        {/* View Full Profile Button */}
        <button
          type="button"
          onClick={onViewFullProfile}
          className="mt-4 w-full rounded-xl bg-[#4ECCA3] px-4 py-2 text-xs font-medium text-white shadow-[0_4px_14px_rgba(78,204,163,0.35)] transition-all hover:bg-[#3DBA92] hover:shadow-[0_6px_20px_rgba(78,204,163,0.45)] active:scale-95"
        >
          {viewFullProfileLabel}
        </button>

        {/* Divider */}
        <div className="my-4 w-full border-t border-white/60" />

        {/* About Section */}
        <div className="w-full">
          <h3 className="text-xs font-semibold text-gray-800">{t('ChatProfile.about')}</h3>
          
          <div className="mt-3 space-y-2">
            <AboutRow 
              icon={<CalendarIcon className="h-3.5 w-3.5" />}
              label={profileData.createdAt ? `Joined ${formatProfileDate(profileData.createdAt)}` : '-'}
            />
            <AboutRow 
              icon={<LocationIcon className="h-3.5 w-3.5" />}
              label={profileData.city && profileData.countryCode 
                ? `${profileData.city}, ${profileData.countryCode.toUpperCase()}`
                : profileData.city || profileData.countryCode?.toUpperCase() || '-'
              }
            />
            <AboutRow 
              icon={<UserIcon className="h-3.5 w-3.5" />}
              label={profileData.gender || '-'}
            />
            <AboutRow 
              icon={<LanguageIcon className="h-3.5 w-3.5" />}
              label={profileData.languages.join(', ') || '-'}
            />
          </div>

          {/* Tags */}
          {profileData.tags.length > 0 && (
            <div className="mt-4 pt-3 border-t border-white/60">
              <h3 className="text-xs font-semibold text-gray-800 mb-2">{t('ChatProfile.tags')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {profileData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-lg bg-[#4ECCA3]/15 px-2 py-1 text-[11px] font-medium text-[#2A9D8F] backdrop-blur-sm transition hover:bg-[#4ECCA3]/25"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// About Row Component
function AboutRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4ECCA3]/10 text-[#4ECCA3]">
        {icon}
      </span>
      <span className="text-gray-600 truncate">{label}</span>
    </div>
  );
}

// Icons
function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function LocationIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LanguageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
