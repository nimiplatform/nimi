import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { SidebarAffordanceBadge, SidebarHeader, SidebarItem, SidebarSearch, SidebarShell } from '@renderer/components/sidebar.js';
import { i18n } from '@renderer/i18n';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  compareHumanChatsByRecency,
  formatHumanChatTime,
  getHumanChatPreview,
  getHumanChatTitle,
  type HumanChatViewDto,
} from '@renderer/features/chat/chat-human-thread-model';

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

function getAvatarUrl(chat: HumanChatViewDto): string | null {
  return chat.otherUser?.avatarUrl || null;
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

  const allChats = (chatsQuery.data?.items || []) as HumanChatViewDto[];
  const allChatsSorted = useMemo(
    () => [...allChats].sort(compareHumanChatsByRecency),
    [allChats],
  );
  const [searchText, setSearchText] = useState('');
  const avatarClickedRef = useRef(false);

  const chats = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return allChatsSorted;
    return allChatsSorted.filter((chat) => {
      const title = getHumanChatTitle(chat).toLowerCase();
      const preview = getHumanChatPreview(chat).toLowerCase();
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
            const title = getHumanChatTitle(chat);
            const unread = Number(chat.unreadCount || 0);
            const timeLabel = formatHumanChatTime(chat.lastMessageAt);
            return (
              <SidebarItem
                key={chat.id}
                kind="entity-row"
                data-testid={E2E_IDS.chatRow(String(chat.id))}
                active={active}
                className="mb-2 items-start py-3"
                label={title}
                description={getHumanChatPreview(chat, t('Chat.noMessages'))}
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
