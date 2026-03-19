// RL-PIPE-005 — Beat-aware chat transcript view
// Renders messages with kind-specific UI (text, voice, image, video, streaming, pending)

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../../app-shell/providers/chat-store.js';
import type { TurnSendPhase } from '../../../app-shell/providers/chat-store.js';

interface ChatViewProps {
  messages: ChatMessage[];
  sendPhase: TurnSendPhase;
}

export function ChatView({ messages, sendPhase }: ChatViewProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.length === 0 && (
        <div className="text-center text-gray-500 mt-8">
          <p className="text-sm">{t('chat.startConversation')}</p>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {sendPhase === 'awaiting-first-beat' && (
        <div className="flex justify-start">
          <div className="bg-gray-800 rounded-lg px-4 py-2">
            <span className="flex gap-1">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const meta = message.meta;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-200'
        }`}
      >
        {/* Text content */}
        {message.content && (
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        )}

        {/* Streaming cursor */}
        {message.kind === 'streaming' && (
          <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />
        )}

        {/* Image */}
        {(message.kind === 'image' && message.media?.uri) && (
          <img
            src={message.media.uri}
            alt=""
            className="rounded-lg mt-2 max-w-full"
            style={{ maxHeight: 300 }}
          />
        )}

        {/* Video */}
        {(message.kind === 'video' && message.media?.uri) && (
          <video
            src={message.media.uri}
            controls
            className="rounded-lg mt-2 max-w-full"
            style={{ maxHeight: 300 }}
          />
        )}

        {/* Image/video pending */}
        {(message.kind === 'image-pending' || message.kind === 'video-pending') && (
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
            <span className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            <span>{message.kind === 'image-pending' ? 'Generating image...' : 'Generating video...'}</span>
          </div>
        )}

        {/* Voice indicator */}
        {message.kind === 'voice' && (
          <div className="flex items-center gap-2 mt-1">
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            <span className="text-xs text-gray-400">Voice message</span>
          </div>
        )}

        {/* Beat metadata (debug) */}
        {!isUser && meta?.beatIndex !== undefined && meta.beatCount !== undefined && (
          <div className="mt-1.5 text-[10px] text-gray-600 flex gap-2">
            <span>{`beat ${Number(meta.beatIndex) + 1}/${String(meta.beatCount)}`}</span>
            {typeof meta.turnMode === 'string' && <span>{meta.turnMode}</span>}
            {typeof meta.beatModality === 'string' && meta.beatModality !== 'text' && (
              <span>{meta.beatModality}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
