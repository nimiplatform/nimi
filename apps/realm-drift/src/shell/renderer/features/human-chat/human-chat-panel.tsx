import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { FriendInfo, ChatMessage } from '@renderer/app-shell/app-store.js';
import { FriendList } from './friend-list.js';
import { getPlatformClient } from '@runtime/platform-client.js';
import { generateId } from '@renderer/infra/ulid.js';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type StartChatResult = RealmServiceResult<'HumanChatService', 'startChat'>;
type ListMessagesResult = RealmServiceResult<'HumanChatService', 'listMessages'>;

type HumanChatPanelProps = Record<string, never>;

export function HumanChatPanel(_props: HumanChatPanelProps) {
  const { t } = useTranslation();
  const humanChats = useAppStore((s) => s.humanChats);
  const activeHumanChat = useAppStore((s) => s.activeHumanChat);
  const setHumanChat = useAppStore((s) => s.setHumanChat);
  const setActiveHumanChat = useAppStore((s) => s.setActiveHumanChat);
  const appendHumanChatMessage = useAppStore((s) => s.appendHumanChatMessage);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeMessages = activeHumanChat?.messages ?? [];

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length]);

  const handleSelectFriend = useCallback(
    async (friend: FriendInfo) => {
      setError(null);

      try {
        const { realm } = getPlatformClient();

        // Set loading state
        setActiveHumanChat({
          chatId: '',
          friendName: friend.displayName,
          messages: [],
          loading: true,
        });

        // Start or get existing chat session
        const data: StartChatResult = await realm.services.HumanChatService.startChat({
          targetAccountId: friend.userId,
        });

        const chatId = String(data.chatId || data.id || '');
        if (!chatId) {
          setError(t('humanChat.openFailed'));
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
        const messagesData: ListMessagesResult = await realm.services.HumanChatService.listMessages(chatId, 50);

        const items = ((messagesData.messages ?? messagesData.items ?? []) as Record<string, unknown>[]);
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
        void realm.services.HumanChatService.markChatRead(chatId).catch(() => { /* read receipt is non-critical */ });
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('humanChat.openFailed');
        setError(msg);
        setActiveHumanChat(null);
      }
    },
    [humanChats, setHumanChat, setActiveHumanChat, t],
  );

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !activeHumanChat?.chatId || sending) return;

    setInputText('');
    setSending(true);
    setError(null);

    // Optimistic add
    const clientMessageId = generateId();
    const tempMsg: ChatMessage = {
      id: clientMessageId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    appendHumanChatMessage(activeHumanChat.chatId, tempMsg);

    try {
      const { realm } = getPlatformClient();
      await realm.services.HumanChatService.sendMessage(activeHumanChat.chatId, {
        type: 'TEXT',
        text,
        clientMessageId,
        payload: { content: text } as unknown as Record<string, never>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('humanChat.sendFailed');
      setError(msg);
    } finally {
      setSending(false);
    }
  }, [inputText, activeHumanChat?.chatId, sending, appendHumanChatMessage, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // No active chat — show friend list
  if (!activeHumanChat) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-300">{t('viewer.tabPeople')}</h3>
        </div>
        {error && (
          <div className="px-3 py-2 text-xs text-red-400">{error}</div>
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
        <button
          onClick={() => setActiveHumanChat(null)}
          className="text-neutral-400 hover:text-white text-sm"
        >
          &larr;
        </button>
        <span className="text-sm font-medium truncate">
          {activeHumanChat.friendName}
        </span>
      </div>

      {/* Loading state */}
      {activeHumanChat.loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {/* Messages */}
      {!activeHumanChat.loading && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {activeMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <div className="border-t border-neutral-800 p-3">
        <div className="flex gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('humanChat.placeholder')}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white focus:outline-none"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!inputText.trim() || sending}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
          >
            {t('humanChat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
