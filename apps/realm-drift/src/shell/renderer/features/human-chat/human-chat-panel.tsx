import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { FriendInfo, ChatMessage } from '@renderer/app-shell/app-store.js';
import { FriendList } from './friend-list.js';
import { getPlatformClient } from '@runtime/platform-client.js';
import { generateId } from '@renderer/infra/ulid.js';

type HumanChatPanelProps = Record<string, never>;

export function HumanChatPanel(_props: HumanChatPanelProps) {
  const { t } = useTranslation();
  const humanChats = useAppStore((s) => s.humanChats);
  const setHumanChat = useAppStore((s) => s.setHumanChat);
  const appendHumanChatMessage = useAppStore((s) => s.appendHumanChatMessage);
  const [activeFriendUserId, setActiveFriendUserId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeMessages = activeChatId ? humanChats[activeChatId]?.messages ?? [] : [];

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length]);

  const handleSelectFriend = useCallback(
    async (friend: FriendInfo) => {
      setActiveFriendUserId(friend.userId);

      try {
        const { realm } = getPlatformClient();
        // Start or get existing chat session
        const data = await realm.raw.request<Record<string, unknown>>({
          method: 'POST',
          path: '/api/human/chats',
          body: { targetUserId: friend.userId },
        });

        const chatId = String(data.chatId || data.id || '');
        if (!chatId) return;

        setActiveChatId(chatId);

        // Initialize chat state if not exists
        if (!humanChats[chatId]) {
          setHumanChat(chatId, {
            chatId,
            friendUserId: friend.userId,
            messages: [],
          });

          // Load existing messages
          const messagesData = await realm.raw.request<Record<string, unknown>>({
            method: 'GET',
            path: `/api/human/chats/${chatId}/messages`,
            query: { limit: 50 },
          });

          const items = ((messagesData.messages ?? messagesData.items ?? []) as Record<string, unknown>[]);
          const messages: ChatMessage[] = items.map((m) => ({
            id: String(m.id || m.eventId || `m-${Date.now()}-${Math.random()}`),
            role: String(m.senderId || '') === useAppStore.getState().auth.user?.id ? 'user' as const : 'assistant' as const,
            content: String(m.content || m.text || ''),
            timestamp: new Date(String(m.createdAt || '')).getTime() || Date.now(),
          }));

          setHumanChat(chatId, {
            chatId,
            friendUserId: friend.userId,
            messages: messages.reverse(),
          });
        }

        // Mark as read
        void realm.raw.request({
          method: 'POST',
          path: `/api/human/chats/${chatId}/read`,
        }).catch(() => { /* non-critical */ });
      } catch {
        // Failed to open chat
      }
    },
    [humanChats, setHumanChat],
  );

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !activeChatId || sending) return;

    setInputText('');
    setSending(true);

    // Optimistic add
    const clientMessageId = generateId();
    const tempMsg: ChatMessage = {
      id: clientMessageId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    appendHumanChatMessage(activeChatId, tempMsg);

    try {
      const { realm } = getPlatformClient();
      await realm.raw.request({
        method: 'POST',
        path: `/api/human/chats/${activeChatId}/messages`,
        body: { content: text, type: 'TEXT', clientMessageId },
      });
    } catch {
      // Message send failed — keep the optimistic message
    } finally {
      setSending(false);
    }
  }, [inputText, activeChatId, sending, appendHumanChatMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // No active chat — show friend list
  if (!activeChatId) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-300">{t('viewer.tabPeople')}</h3>
        </div>
        <div className="flex-1 overflow-auto p-2">
          <FriendList
            onSelectFriend={(f) => void handleSelectFriend(f)}
            activeFriendUserId={activeFriendUserId}
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
          onClick={() => { setActiveChatId(null); setActiveFriendUserId(null); }}
          className="text-neutral-400 hover:text-white text-sm"
        >
          ←
        </button>
        <span className="text-sm font-medium truncate">
          {useAppStore.getState().friendList.find((f) => f.userId === activeFriendUserId)?.displayName ?? 'Chat'}
        </span>
      </div>

      {/* Messages */}
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
