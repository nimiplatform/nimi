import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import type { MessageViewDto } from '@nimiplatform/sdk-realm/models/MessageViewDto';
import type { ChatViewDto } from '@nimiplatform/sdk-realm/models/ChatViewDto';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { formatLocaleDate } from '@renderer/i18n';

function resolveMessageText(message: MessageViewDto): string {
  const text = String(message.text || '').trim();
  if (text) return text;

  const payload = message.payload as Record<string, unknown> | null;
  const payloadText = String(payload?.content || payload?.text || '').trim();
  if (payloadText) return payloadText;

  return '';
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function toMessageTimestamp(message: MessageViewDto): number {
  const parsed = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateSeparator(input: {
  isoString: string;
  todayLabel: string;
  yesterdayLabel: string;
}): string {
  const date = new Date(input.isoString);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
  if (diffDays === 0) return input.todayLabel;
  if (diffDays === 1) return input.yesterdayLabel;
  if (diffDays < 7) {
    return formatLocaleDate(date, { weekday: 'long' });
  }
  return formatLocaleDate(date, { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined });
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

export function MessageTimeline() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const currentUserAvatarUrl = typeof currentUser?.avatarUrl === 'string' ? currentUser.avatarUrl : null;
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const [profilePanelTarget, setProfilePanelTarget] = useState<ProfilePanelTarget>(null);
  const [expandedDiagnosticsMessageId, setExpandedDiagnosticsMessageId] = useState<string | null>(null);

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

  const toggleProfilePanel = (target: Exclude<ProfilePanelTarget, null>) => {
    setProfilePanelTarget((previous) => (previous === target ? null : target));
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
  const profileLoadErrorText = profilePanelTarget === 'self'
    ? t('ChatTimeline.myProfileLoadError')
    : t('ChatTimeline.userProfileLoadError');
  const profileActionLabel = profilePanelTarget === 'self'
    ? t('ChatTimeline.openMyProfile')
    : t('ChatTimeline.openUserProfile');

  if (!selectedChatId) {
    return (
      <section className="flex h-full items-center justify-center text-sm text-gray-500">
        {t('ChatTimeline.selectChat')}
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
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Chat header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
          {/* Name - clickable to open profile panel */}
          <button
            type="button"
            onClick={() => toggleProfilePanel('other')}
            className="text-lg font-medium tracking-tight text-[#2f3f33] hover:text-mint-600 transition-colors"
            aria-label={profilePanelTarget === 'other'
              ? t('ChatTimeline.collapseUserProfile')
              : t('ChatTimeline.viewUserProfile')}
          >
            {contactName}
          </button>
          {/* Menu button - also opens profile panel */}
          <button 
            type="button" 
            onClick={() => toggleProfilePanel('other')}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-gray-400 hover:bg-gray-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        </header>

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto bg-white px-5 py-4">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-gray-500">{t('Chat.noMessages')}</p>
          ) : (
            messages.map((message, index) => {
              const isMe = message.senderId === currentUserId;
              const senderName = isMe ? t('ChatTimeline.you') : contactName;
              const messageProfileTarget: Exclude<ProfilePanelTarget, null> = isMe ? 'self' : 'other';
              const currentDateKey = getDateKey(message.createdAt);
              const prevDateKey = index > 0 ? getDateKey(messages[index - 1]!.createdAt) : null;
              const showDateSeparator = currentDateKey !== prevDateKey && currentDateKey !== '';
              const dateLabel = showDateSeparator
                ? formatDateSeparator({
                  isoString: message.createdAt,
                  todayLabel: t('Chat.today'),
                  yesterdayLabel: t('Chat.yesterday'),
                })
                : '';
              const resolvedMessageText = resolveMessageText(message) || t('ChatTimeline.emptyMessage');
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
                  {showDateSeparator && dateLabel ? (
                    <div className="my-3 flex items-center gap-3">
                      <div className="h-px flex-1 bg-gray-100" />
                      <span className="text-[11px] font-medium text-gray-400">{dateLabel}</span>
                      <div className="h-px flex-1 bg-gray-100" />
                    </div>
                  ) : null}
                <div className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                  {/* Avatar */}
                  {isMe && currentUserAvatarUrl ? (
                    <button
                      type="button"
                      onClick={() => toggleProfilePanel(messageProfileTarget)}
                      className="shrink-0 rounded-full transition hover:opacity-90"
                      aria-label={profilePanelTarget === messageProfileTarget
                        ? t('ChatTimeline.collapseMyProfile')
                        : t('ChatTimeline.viewMyProfile')}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d8deea] bg-white p-0.5">
                        <img src={currentUserAvatarUrl} alt="You" className="h-8 w-8 rounded-full object-cover" />
                      </div>
                    </button>
                  ) : !isMe && contactAvatarUrl ? (
                    <button
                      type="button"
                      onClick={() => toggleProfilePanel(messageProfileTarget)}
                      className="shrink-0 rounded-full transition hover:opacity-90"
                      aria-label={profilePanelTarget === messageProfileTarget
                        ? t('ChatTimeline.collapseUserProfile')
                        : t('ChatTimeline.viewUserProfile')}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#dce4d8] bg-white p-0.5">
                        <img src={contactAvatarUrl} alt={contactName} className="h-8 w-8 rounded-full object-cover" />
                      </div>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleProfilePanel(messageProfileTarget)}
                      className="shrink-0 rounded-full transition hover:opacity-90"
                      aria-label={profilePanelTarget === messageProfileTarget
                        ? (isMe ? t('ChatTimeline.collapseMyProfile') : t('ChatTimeline.collapseUserProfile'))
                        : (isMe ? t('ChatTimeline.viewMyProfile') : t('ChatTimeline.viewUserProfile'))}
                    >
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full border bg-white p-0.5 ${
                        isMe ? 'border-[#d8deea]' : 'border-[#dce4d8]'
                      }`}>
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                          isMe ? 'bg-[#ece9f8] text-[#7a7f9e]' : 'bg-[#e5ece1] text-[#6e7f69]'
                        }`}>
                          {getInitial(senderName)}
                        </div>
                      </div>
                    </button>
                  )}
                  {/* Bubble */}
                  <div className={`max-w-[70%] ${isMe ? 'text-right' : ''}`}>
                    <div className={`rounded-[16px] px-4 py-2.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] ${
                      isMe
                        ? 'bg-[#ece9f8] text-[#7a7f9e]'
                        : 'bg-[#e5ece1] text-[#6d7d6f]'
                    }`}>
                      {diagnostics.interactionKind && (
                        <div className={`mb-1 inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                          isMe
                            ? 'border-[#b8b1d6] bg-[#f3f0fc] text-[#69608e]'
                            : 'border-[#bfd0b8] bg-[#f2f7ef] text-[#5d7757]'
                        }`}>
                          interaction: {diagnostics.interactionKind}
                        </div>
                      )}
                      {resolvedMessageText}

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
                    <p className={`mt-1 text-[10px] text-[#97a392] ${isMe ? 'text-right' : ''}`}>
                      {formatLocaleDate(message.createdAt, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {profilePanelTarget ? (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
            <h3 className="text-sm font-semibold text-gray-900">{profilePanelTitle}</h3>
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

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {profileQuery.isPending ? (
              <p className="text-sm text-gray-500">{t('ChatTimeline.loadingProfileDetail')}</p>
            ) : profileQuery.isError ? (
              <p className="text-sm text-red-600">{profileLoadErrorText}</p>
            ) : (
              <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-3">
                  {profileSummary.avatarUrl ? (
                    <img src={profileSummary.avatarUrl} alt={profileSummary.displayName} className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-200 text-base font-medium text-gray-600">
                      {getInitial(profileSummary.displayName)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-gray-900">{profileSummary.displayName}</p>
                    <p className="truncate text-xs text-gray-500">{profileSummary.handle}</p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {profileSummary.isOnline ? t('ChatTimeline.online') : t('ChatTimeline.offline')} · {profileSummary.isAgent ? t('ChatTimeline.agent') : t('ChatTimeline.human')}
                    </p>
                  </div>
                </div>

                {profileSummary.bio ? (
                  <p className="mt-3 text-sm leading-5 text-gray-700">{profileSummary.bio}</p>
                ) : null}

                {profileSummary.presenceText ? (
                  <p className="mt-2 rounded bg-white px-2 py-1.5 text-xs text-gray-600">
                    {t('ChatTimeline.statusPrefix')}: {profileSummary.presenceText}
                  </p>
                ) : null}

                {profileSummary.createdAt ? (
                  <p className="mt-2 text-xs text-gray-500">
                    {t('ChatTimeline.joinedAtPrefix')}: {formatLocaleDate(profileSummary.createdAt, { year: 'numeric', month: 'short', day: '2-digit' })}
                  </p>
                ) : null}

                <button
                  type="button"
                  className="mt-4 w-full rounded-[10px] bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                  onClick={() => {
                    if (!profileSummary.id) {
                      return;
                    }
                    navigateToProfile(profileSummary.id, profileSummary.isAgent ? 'agent-detail' : 'profile');
                  }}
                >
                  {profileActionLabel}
                </button>
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </section>
  );
}
