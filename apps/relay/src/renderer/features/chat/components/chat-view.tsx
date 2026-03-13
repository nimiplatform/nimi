import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../hooks/use-agent-chat.js';

interface ChatViewProps {
  messages: ChatMessage[];
}

export function ChatView({ messages }: ChatViewProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages or streaming updates
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="text-center text-gray-500 mt-8">
          <p className="text-sm">{t('chat.startConversation')}</p>
        </div>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[70%] rounded-lg px-4 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-200'
            }`}
          >
            <p className="whitespace-pre-wrap">{msg.text}</p>
            {msg.streaming && (
              <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
