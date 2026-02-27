import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import type { ChatViewDto } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';

function getChatTitle(chat: ChatViewDto): string {
  const record = chat as unknown as Record<string, unknown>;
  const otherUser =
    record.otherUser && typeof record.otherUser === 'object'
      ? (record.otherUser as Record<string, unknown>)
      : null;
  const displayName = String(otherUser?.displayName || '').trim();
  const handle = String(otherUser?.handle || '').trim();
  return displayName || handle || String(record.id || 'unknown');
}

function getChatPreview(chat: ChatViewDto, noMessagesFallback = 'No messages yet'): string {
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

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function formatChatTime(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ChatList() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);

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

  useEffect(() => {
    if (!selectedChatId && allChatsSorted.length > 0) {
      setSelectedChatId(allChatsSorted[0]?.id || null);
    }
  }, [allChatsSorted, selectedChatId, setSelectedChatId]);

  if (chatsQuery.isPending) {
    return <div className="p-4 text-sm text-gray-500">{t('Chat.loading')}</div>;
  }

  if (chatsQuery.isError) {
    return <div className="p-4 text-sm text-red-600">{t('Chat.loadError')}</div>;
  }

  return (
    <div className="flex h-full flex-col bg-[#F8F9FB]">
      {/* Top row: search only */}
      <div className="flex h-16 shrink-0 items-center px-4">
        <div className="flex h-10 w-full items-center rounded-full bg-white px-4 shadow-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="ml-2 min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
            placeholder="Search chats..."
            aria-label={t('Chat.searchPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {chats.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-500">{t('Chat.noChats')}</p>
        ) : (
          chats.map((chat) => {
            const active = chat.id === selectedChatId;
            const title = getChatTitle(chat);
            const unread = Number((chat as unknown as Record<string, unknown>).unreadCount || 0);
            const timeLabel = formatChatTime(chat.lastMessageAt);
            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => setSelectedChatId(chat.id)}
                className={`flex w-full gap-3 rounded-lg p-3 text-left transition-all ${
                  active 
                    ? 'bg-mint-50 shadow-sm' 
                    : 'hover:bg-mint-50/50'
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  {getAvatarUrl(chat) ? (
                    <img
                      src={getAvatarUrl(chat)!}
                      alt={title}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-gray-100 to-gray-200 text-sm font-medium text-gray-600">
                      {getInitial(title)}
                    </div>
                  )}
                  {unread > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#34C759] px-1.5 text-[11px] font-semibold text-white shadow-sm">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </div>
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className={`truncate text-[15px] ${active ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>{title}</p>
                    {timeLabel ? (
                      <span className="shrink-0 text-[12px] text-gray-400">{timeLabel}</span>
                    ) : null}
                  </div>
                  <p className={`mt-0.5 truncate text-[14px] leading-5 ${unread > 0 ? 'font-medium text-gray-700' : 'text-gray-500'}`}>
                    {getChatPreview(chat, t('Chat.noMessages'))}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
