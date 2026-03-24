import { useRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { FriendInfo, ChatMessage } from '@renderer/app-shell/app-store.js';
import { FriendList } from './friend-list.js';
import { generateId } from '@renderer/infra/ulid.js';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  listRealmChatMessages,
  markRealmChatRead,
  sendRealmChatMessage,
  startRealmChat,
  type RealmChatTimelineMessage,
} from '@nimiplatform/nimi-kit/features/chat/realm';
import { useChatComposer } from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  ChatPanelState,
  ChatThreadHeader,
  RealmChatTimeline,
} from '@nimiplatform/nimi-kit/features/chat';

type StartChatResult = RealmServiceResult<'HumanChatsService', 'startChat'>;
type ListMessagesResult = RealmServiceResult<'HumanChatsService', 'listMessages'>;

type HumanChatPanelProps = Record<string, never>;

export function HumanChatPanel(_props: HumanChatPanelProps) {
  const { t } = useTranslation();
  const humanChats = useAppStore((s) => s.humanChats);
  const activeHumanChat = useAppStore((s) => s.activeHumanChat);
  const setHumanChat = useAppStore((s) => s.setHumanChat);
  const setActiveHumanChat = useAppStore((s) => s.setActiveHumanChat);
  const appendHumanChatMessage = useAppStore((s) => s.appendHumanChatMessage);
  const currentUserId = String(useAppStore((s) => s.auth.user?.id || '')).trim();
  const [panelError, setPanelError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeMessages = activeHumanChat?.messages ?? [];
  const activeHumanChatState = activeHumanChat
    ? humanChats[activeHumanChat.chatId]
    : undefined;
  const timelineMessages: readonly RealmChatTimelineMessage[] = activeHumanChat
    ? activeMessages.map((message) => ({
      id: message.id,
      chatId: activeHumanChat.chatId,
      senderId: message.role === 'user'
        ? currentUserId || 'user'
        : activeHumanChatState?.friendUserId || 'friend',
      type: 'TEXT',
      text: message.content,
      payload: { content: message.content } as unknown as Record<string, never>,
      createdAt: new Date(message.timestamp).toISOString(),
      isRead: true,
      deliveryState: 'sent',
      deliveryError: null,
      localPreviewUrl: null,
      localUploadState: null,
    }))
    : [];

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length]);

  const composer = useChatComposer({
    disabled: !activeHumanChat?.chatId,
    adapter: {
      submit: async ({ text }) => {
        const chatId = String(activeHumanChat?.chatId || '').trim();
        const trimmedText = String(text || '').trim();
        if (!chatId) {
          throw new Error(t('humanChat.openFailed'));
        }
        if (!trimmedText) {
          return;
        }

        const clientMessageId = generateId();
        const tempMsg: ChatMessage = {
          id: clientMessageId,
          role: 'user',
          content: trimmedText,
          timestamp: Date.now(),
        };
        appendHumanChatMessage(chatId, tempMsg);

        await sendRealmChatMessage(chatId, {
          type: 'TEXT',
          text: trimmedText,
          clientMessageId,
          payload: { content: trimmedText } as unknown as Record<string, never>,
        });
      },
    },
  });

  const handleSelectFriend = useCallback(
    async (friend: FriendInfo) => {
      setPanelError(null);

      try {
        // Set loading state
        setActiveHumanChat({
          chatId: '',
          friendName: friend.displayName,
          messages: [],
          loading: true,
        });

        // Start or get existing chat session
        const data: StartChatResult = await startRealmChat({
          targetAccountId: friend.userId,
        });

        const chatId = String(data.chatId || '');
        if (!chatId) {
          setPanelError(t('humanChat.openFailed'));
          setActiveHumanChat(null);
          return;
        }

        // Initialize chat state if not exists
        if (!humanChats[chatId]) {
          setHumanChat(chatId, {
            chatId,
            friendUserId: friend.userId,
            messages: [],
          });
        }

        // Load existing messages
        const messagesData: ListMessagesResult = await listRealmChatMessages(chatId, 50);

        const items = (messagesData.items ?? []) as Record<string, unknown>[];
        const messages: ChatMessage[] = items.map((m) => ({
          id: String(m.id || m.eventId || `m-${Date.now()}-${Math.random()}`),
          role: String(m.senderId || '') === useAppStore.getState().auth.user?.id ? 'user' as const : 'assistant' as const,
          content: String(m.content || m.text || ''),
          timestamp: new Date(String(m.createdAt || '')).getTime() || Date.now(),
        }));

        const sortedMessages = messages.reverse();

        setHumanChat(chatId, {
          chatId,
          friendUserId: friend.userId,
          messages: sortedMessages,
        });

        setActiveHumanChat({
          chatId,
          friendName: friend.displayName,
          messages: sortedMessages,
          loading: false,
        });

        // Mark as read
        void markRealmChatRead(chatId).catch(() => { /* read receipt is non-critical */ });
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('humanChat.openFailed');
        setPanelError(msg);
        setActiveHumanChat(null);
      }
    },
    [humanChats, setHumanChat, setActiveHumanChat, t],
  );

  // No active chat — show friend list
  if (!activeHumanChat) {
    return (
      <div className="flex flex-col h-full">
        <ChatThreadHeader
          title={t('viewer.tabPeople')}
          className="border-b border-neutral-800 bg-transparent px-3 py-2"
          titleClassName="text-sm font-medium text-neutral-300"
        />
        {panelError && (
          <div className="px-3 py-2 text-xs text-red-400">{panelError}</div>
        )}
        <div className="flex-1 overflow-auto p-2">
          <FriendList
            onSelectFriend={(f) => void handleSelectFriend(f)}
            activeFriendUserId={null}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ChatThreadHeader
        title={activeHumanChat.friendName}
        className="border-b border-neutral-800 bg-transparent px-3 py-2"
        titleClassName="truncate text-sm font-medium text-neutral-200"
        actions={(
          <button
            type="button"
            onClick={() => setActiveHumanChat(null)}
            className="text-sm text-neutral-400 transition hover:text-white"
          >
            &larr;
          </button>
        )}
      />

      {activeHumanChat.loading && (
        <ChatPanelState
          activeChatId={activeHumanChat.chatId}
          className="py-8 text-inherit"
        >
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </ChatPanelState>
      )}

      {panelError && (
        <div className="px-3 py-2 text-xs text-red-400">{panelError}</div>
      )}

      {!activeHumanChat.loading && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          <RealmChatTimeline
            messages={timelineMessages}
            currentUserId={currentUserId}
            emptyState={<p className="py-8 text-center text-sm text-neutral-500">{t('humanChat.emptyState')}</p>}
            emptyMessageLabel={t('humanChat.emptyState')}
            queuedLocallyLabel={t('humanChat.send')}
            sendFailedLabel={t('humanChat.sendFailed')}
            bubbleClassName="whitespace-pre-wrap text-sm"
            userBubbleClassName="rounded-lg bg-blue-600 text-white"
            otherBubbleClassName="rounded-lg bg-neutral-800 text-neutral-200"
          />
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <div className="border-t border-neutral-800 p-3">
        <div className="flex gap-2">
          <textarea
            ref={composer.textareaRef}
            value={composer.text}
            onChange={composer.handleTextChange}
            onKeyDown={composer.handleKeyDown}
            placeholder={t('humanChat.placeholder')}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white focus:outline-none"
          />
          <button
            onClick={() => void composer.handleSubmit()}
            disabled={!composer.canSubmit}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
          >
            {t('humanChat.send')}
          </button>
        </div>
        {composer.error ? (
          <div className="px-1 pt-2 text-xs text-red-400">{composer.error}</div>
        ) : null}
      </div>
    </div>
  );
}
