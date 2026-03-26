import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { resolveRealmMessageText } from '@nimiplatform/nimi-kit/features/chat/realm';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { ScrollArea, SidebarAffordanceBadge, SidebarHeader, SidebarItem, SidebarSearch, SidebarShell, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { formatLocaleDate, formatRelativeLocaleTime, i18n } from '@renderer/i18n';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { resolveCanonicalChatAttachmentPreviewText } from '@renderer/features/turns/chat-attachment-contract.js';

type ChatViewDto = RealmModel<'ChatViewDto'>;

function ChatSkeletonBlock(props: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-slate-200/75 ${props.className}`} />;
}

function ChatListLoadingSkeleton() {
  return (
    <SidebarShell data-testid={E2E_IDS.chatList} className="h-full">
      <SidebarHeader title={<ChatSkeletonBlock className="h-7 w-20 rounded-lg" />} />
      <div className="px-3 pb-3">
        <div className="flex min-h-10 items-center gap-2 px-2">
          <ChatSkeletonBlock className="h-4 w-4 shrink-0" />
          <ChatSkeletonBlock className="ml-3 h-4 w-40 rounded-md" />
        </div>
      </div>
      <ScrollArea
        className="flex-1"
        contentClassName="space-y-2 px-3 py-2 pb-3"
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <Surface key={`chat-skeleton-row-${index}`} tone="card" elevation="base" className="flex gap-3">
            <ChatSkeletonBlock className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <ChatSkeletonBlock className="h-4 w-24 rounded-md" />
                <ChatSkeletonBlock className="h-3 w-10 rounded-md" />
              </div>
              <ChatSkeletonBlock className="mt-2 h-3.5 w-5/6 rounded-md" />
            </div>
          </Surface>
        ))}
      </ScrollArea>
    </SidebarShell>
  );
}

function getChatTitle(chat: ChatViewDto): string {
  const displayName = String(chat.otherUser?.displayName || '').trim();
  const handle = String(chat.otherUser?.handle || '').trim();
  return displayName || handle || String(chat.id || i18n.t('Common.unknown', { defaultValue: 'Unknown' }));
}

function getChatPreview(
  chat: ChatViewDto,
  noMessagesFallback = i18n.t('Chat.noMessages', { defaultValue: 'No messages yet' }),
): string {
  const lastMsg = chat.lastMessage;
  if (lastMsg) {
    const resolvedText = resolveRealmMessageText(lastMsg).trim();
    if (resolvedText) return resolvedText;
    const attachmentText = resolveCanonicalChatAttachmentPreviewText(lastMsg.payload);
    if (attachmentText) return attachmentText;
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

  const createdAt = Date.parse(String(chat.createdAt || ''));
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

function ChatRowAffordance(props: { timeLabel: string; unread: number }) {
  return (
    <div className="flex min-w-[46px] flex-col items-end gap-2">
      {props.timeLabel ? <span className="text-xs text-gray-400">{props.timeLabel}</span> : <span className="h-4" />}
      {props.unread > 0 ? (
        <SidebarAffordanceBadge>
          {props.unread > 99 ? '99+' : props.unread}
        </SidebarAffordanceBadge>
      ) : null}
    </div>
  );
}

function ChatAvatarButton(props: {
  imageUrl: string | null;
  title: string;
  onOpenProfile: () => void;
}) {
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        props.onOpenProfile();
      }}
      className="relative z-10 inline-flex shrink-0 cursor-pointer"
      title={i18n.t('ChatTimeline.viewUserProfile', { defaultValue: 'View user profile' })}
    >
      <EntityAvatar
        imageUrl={props.imageUrl}
        name={props.title}
        kind="human"
        sizeClassName="h-12 w-12"
        className="transition-all"
        textClassName="text-sm font-medium"
      />
    </div>
  );
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
    return allChatsSorted.filter((chat) => {
      const title = getChatTitle(chat).toLowerCase();
      const preview = getChatPreview(chat).toLowerCase();
      const handle = String(chat.otherUser?.handle || '').toLowerCase();
      return title.includes(q) || preview.includes(q) || handle.includes(q);
    });
  }, [allChatsSorted, searchText]);

  useEffect(() => {
    if (!selectedChatId) {
      return;
    }
    const exists = chats.some((chat) => String(chat.id || '') === String(selectedChatId));
    if (!exists) {
      setSelectedChatId(null);
      setChatProfilePanelTarget(null);
    }
  }, [chats, selectedChatId, setChatProfilePanelTarget, setSelectedChatId]);

  if (chatsQuery.isPending) {
    return <ChatListLoadingSkeleton />;
  }

  if (chatsQuery.isError) {
    return <div className="p-4 text-sm text-red-600">{t('Chat.loadError')}</div>;
  }

  return (
    <SidebarShell data-testid={E2E_IDS.chatList} className="h-full">
      <SidebarHeader title={<h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>{t('Chat.title')}</h1>} />
      <SidebarSearch
        value={searchText}
        onChange={setSearchText}
        onClear={() => setSearchText('')}
        clearLabel={t('Home.clear', { defaultValue: 'Clear' })}
        placeholder={t('Chat.searchPlaceholder', { defaultValue: 'Search chats...' })}
      />
      <ScrollArea
        className="flex-1"
        contentClassName="px-3 py-2 pb-3"
      >
        {chats.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-500">{t('Chat.noChats')}</p>
        ) : (
          chats.map((chat) => {
            const active = chat.id === selectedChatId;
            const title = getChatTitle(chat);
            const unread = Number(chat.unreadCount || 0);
            const timeLabel = formatChatTime(chat.lastMessageAt);
            return (
              <SidebarItem
                key={chat.id}
                kind="entity-row"
                data-testid={E2E_IDS.chatRow(String(chat.id))}
                active={active}
                className="mb-2 items-start py-3"
                label={title}
                description={getChatPreview(chat, t('Chat.noMessages'))}
                trailing={<ChatRowAffordance timeLabel={timeLabel} unread={unread} />}
                icon={(
                  <ChatAvatarButton
                    imageUrl={getAvatarUrl(chat)}
                    title={title}
                    onOpenProfile={() => {
                      avatarClickedRef.current = true;
                      setSelectedChatId(chat.id);
                      setChatProfilePanelTarget('other');
                    }}
                  />
                )}
                onClick={() => {
                  if (avatarClickedRef.current) {
                    avatarClickedRef.current = false;
                    return;
                  }
                  setSelectedChatId(chat.id);
                  setChatProfilePanelTarget(null);
                }}
              />
            );
          })
        )}
      </ScrollArea>
    </SidebarShell>
  );
}
