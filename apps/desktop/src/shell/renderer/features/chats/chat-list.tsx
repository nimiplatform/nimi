import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import type { ChatViewDto } from '@nimiplatform/sdk/realm';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { formatLocaleDate, formatRelativeLocaleTime, i18n } from '@renderer/i18n';

function ChatSkeletonBlock(props: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-slate-200/75 ${props.className}`} />;
}

function ChatListLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col bg-[#F8F9FB]">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <ChatSkeletonBlock className="h-7 w-20 rounded-lg" />
      </div>

      <div className="px-3 pb-3">
        <div className="flex h-10 w-full items-center rounded-full bg-white px-4 shadow-sm">
          <ChatSkeletonBlock className="h-4 w-4 shrink-0" />
          <ChatSkeletonBlock className="ml-3 h-4 w-40 rounded-md" />
        </div>
      </div>

      <ScrollShell
        className="flex-1"
        contentClassName="space-y-2 px-3 py-2 pb-3"
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={`chat-skeleton-row-${index}`} className="flex gap-3 rounded-lg bg-white p-3 shadow-sm">
            <ChatSkeletonBlock className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <ChatSkeletonBlock className="h-4 w-24 rounded-md" />
                <ChatSkeletonBlock className="h-3 w-10 rounded-md" />
              </div>
              <ChatSkeletonBlock className="mt-2 h-3.5 w-5/6 rounded-md" />
            </div>
          </div>
        ))}
      </ScrollShell>
    </div>
  );
}

function getChatTitle(chat: ChatViewDto): string {
  const record = chat as unknown as Record<string, unknown>;
  const otherUser =
    record.otherUser && typeof record.otherUser === 'object'
      ? (record.otherUser as Record<string, unknown>)
      : null;
  const displayName = String(otherUser?.displayName || '').trim();
  const handle = String(otherUser?.handle || '').trim();
  return displayName || handle || String(record.id || i18n.t('Common.unknown', { defaultValue: 'Unknown' }));
}

function getChatPreview(
  chat: ChatViewDto,
  noMessagesFallback = i18n.t('Chat.noMessages', { defaultValue: 'No messages yet' }),
): string {
  const lastMsg = chat.lastMessage;
  if (lastMsg) {
    const text = String(lastMsg.text || '').trim();
    if (text) return text;
    const payload = lastMsg.payload as Record<string, unknown> | null;
    const payloadText = String(payload?.content || payload?.text || '').trim();
    if (payloadText) return payloadText;
  }
  return noMessagesFallback;
}

function getAvatarUrl(chat: ChatViewDto): string | null {
  return chat.otherUser?.avatarUrl || null;
}

function getIsAgent(chat: ChatViewDto): boolean {
  const record = chat as unknown as Record<string, unknown>;
  const otherUser =
    record.otherUser && typeof record.otherUser === 'object'
      ? (record.otherUser as Record<string, unknown>)
      : null;
  if (otherUser?.isAgent === true) {
    return true;
  }
  const handle = String(otherUser?.handle || '').trim();
  return handle.startsWith('~');
}

function resolveChatSortTime(chat: ChatViewDto): number {
  const primary = Date.parse(String(chat.lastMessageAt || ''));
  if (Number.isFinite(primary)) {
    return primary;
  }

  const messageTime = Date.parse(String(chat.lastMessage?.createdAt || ''));
  if (Number.isFinite(messageTime)) {
    return messageTime;
  }

  const createdAt = Date.parse(String((chat as unknown as { createdAt?: string }).createdAt || ''));
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }

  return 0;
}

function compareChatsByRecency(left: ChatViewDto, right: ChatViewDto): number {
  const delta = resolveChatSortTime(right) - resolveChatSortTime(left);
  if (delta !== 0) {
    return delta;
  }
  return String(right.id || '').localeCompare(String(left.id || ''));
}

function formatChatTime(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return formatRelativeLocaleTime(date);
  if (diffMin < 60) return formatRelativeLocaleTime(date);
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return formatRelativeLocaleTime(date);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return formatLocaleDate(date, { weekday: 'short' });
  return formatLocaleDate(date, { month: 'short', day: 'numeric' });
}

export function ChatList() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setChatProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);

  const chatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => dataSync.loadChats(),
    enabled: authStatus === 'authenticated',
  });

  const allChats = (chatsQuery.data?.items || []) as ChatViewDto[];
  const allChatsSorted = useMemo(
    () => [...allChats].sort(compareChatsByRecency),
    [allChats],
  );
  const [searchText, setSearchText] = useState('');
  const avatarClickedRef = useRef(false);

  const chats = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return allChatsSorted;
    return allChatsSorted.filter((c) => {
      const title = getChatTitle(c).toLowerCase();
      const preview = getChatPreview(c).toLowerCase();
      const handle = String(c.otherUser?.handle || '').toLowerCase();
      return title.includes(q) || preview.includes(q) || handle.includes(q);
    });
  }, [allChatsSorted, searchText]);

  // 默认不自动选择第一个聊天，保持空状态

  if (chatsQuery.isPending) {
    return <ChatListLoadingSkeleton />;
  }

  if (chatsQuery.isError) {
    return <div className="p-4 text-sm text-red-600">{t('Chat.loadError')}</div>;
  }

  return (
    <div className="flex h-full flex-col bg-[#F8F9FB]">
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-4 shrink-0">
        <h1 className={`${APP_PAGE_TITLE_CLASS} text-[22px]`}>{t('Chat.title')}</h1>
      </div>

      {/* Top row: search only */}
      <div className="px-3 pb-3">
        <div className="flex h-10 w-full items-center rounded-full bg-white px-4 shadow-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="ml-2 min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
            placeholder={t('Chat.searchPlaceholder', { defaultValue: 'Search chats...' })}
            aria-label={t('Chat.searchPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <ScrollShell
        className="flex-1"
        contentClassName="px-3 py-2 pb-3"
      >
        {chats.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-500">{t('Chat.noChats')}</p>
        ) : (
          chats.map((chat) => {
            const active = chat.id === selectedChatId;
            const title = getChatTitle(chat);
            const unread = Number((chat as unknown as Record<string, unknown>).unreadCount || 0);
            const timeLabel = formatChatTime(chat.lastMessageAt);
            return (
              <div
                key={chat.id}
                className={`flex w-full cursor-pointer gap-3 rounded-lg border p-3 text-left transition-all ${
                  active 
                    ? 'border-transparent bg-mint-50 shadow-sm' 
                    : 'border-transparent hover:bg-mint-50/50'
                }`}
                onClick={() => {
                  // Check if avatar was clicked, if so, don't process this click
                  if (avatarClickedRef.current) {
                    avatarClickedRef.current = false;
                    return;
                  }
                  setSelectedChatId(chat.id);
                  // Close profile panel when clicking main chat item
                  setChatProfilePanelTarget(null);
                }}
              >
                {/* Avatar - clickable to open profile panel */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    avatarClickedRef.current = true;
                    setSelectedChatId(chat.id);
                    setChatProfilePanelTarget('other');
                  }}
                  className="relative shrink-0 cursor-pointer z-10"
                  title={t('ChatTimeline.viewUserProfile', { defaultValue: 'View user profile' })}
                >
                  <EntityAvatar
                    imageUrl={getAvatarUrl(chat)}
                    name={title}
                    kind={getIsAgent(chat) ? 'agent' : 'human'}
                    sizeClassName="h-12 w-12"
                    className="transition-all"
                    textClassName="text-sm font-medium"
                  />
                  {unread > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#34C759] px-1.5 text-[11px] font-semibold text-white shadow-sm">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </div>
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p
                      className={`min-w-0 flex-1 truncate pr-2 text-[15px] ${
                        active ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'
                      }`}
                    >
                      {title}
                    </p>
                    {timeLabel ? (
                      <span className="w-10 shrink-0 text-right text-[12px] text-gray-400">{timeLabel}</span>
                    ) : null}
                  </div>
                  <p className={`mt-0.5 truncate text-[14px] leading-5 ${unread > 0 ? 'font-medium text-gray-700' : 'text-gray-500'}`}>
                    {getChatPreview(chat, t('Chat.noMessages'))}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </ScrollShell>
    </div>
  );
}
