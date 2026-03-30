// RL-PIPE-005 — Beat-aware chat transcript view
// Per design.md §5: user bubbles right-aligned, AI messages left-aligned with markdown

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import type { ChatMessage } from '../../../app-shell/providers/chat-store.js';
import type { TurnSendPhase } from '../../../app-shell/providers/chat-store.js';
import { MarkdownRenderer } from './markdown-renderer.js';
import { MessageActionBar } from './message-action-bar.js';

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
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-[720px] mx-auto px-6 py-6">
        {messages.map((msg, i) => {
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const sameRole = prevMsg?.role === msg.role;
          const gap = sameRole ? 'mt-2' : 'mt-6';
          const isFirst = i === 0;

          return (
            <div key={msg.id} className={isFirst ? '' : gap}>
              {msg.role === 'user' ? (
                <UserMessage message={msg} />
              ) : (
                <AssistantMessage message={msg} showHeader={!sameRole} />
              )}
            </div>
          );
        })}

        {/* Awaiting first beat indicator */}
        {sendPhase === 'awaiting-first-beat' && (
          <div className="mt-6 flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-bg-elevated flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot size={14} className="text-text-secondary" />
            </div>
            <div className="flex gap-1.5 pt-2">
              <span className="w-2 h-2 bg-text-secondary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-text-secondary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-text-secondary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] bg-bg-user-msg rounded-[18px] px-5 py-4"
        style={{ fontSize: '15px', lineHeight: '1.7' }}
      >
        {message.content && (
          <p className="whitespace-pre-wrap text-text-primary">{message.content}</p>
        )}
        {renderMedia(message)}
      </div>
    </div>
  );
}

function AssistantMessage({ message, showHeader }: { message: ChatMessage; showHeader: boolean }) {
  return (
    <div className="group">
      {/* Header — model icon + name */}
      {showHeader && (
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-bg-elevated flex items-center justify-center flex-shrink-0">
            <Bot size={14} className="text-text-secondary" />
          </div>
          <span className="text-[13px] font-medium text-text-secondary">AI</span>
        </div>
      )}

      {/* Content */}
      <div className="pl-9">
        {message.content && (
          message.kind === 'streaming' ? (
            <div style={{ fontSize: '15px', lineHeight: '1.7' }}>
              <MarkdownRenderer content={message.content} />
              {/* Streaming cursor */}
              <span
                className="ml-0.5 inline-block h-[20px] w-[2px] animate-pulse bg-accent align-text-bottom"
                style={{ height: '20px' }}
              />
            </div>
          ) : (
            <MarkdownRenderer content={message.content} />
          )
        )}

        {renderMedia(message)}

        {/* Voice indicator */}
        {message.kind === 'voice' && (
          <div className="flex items-center gap-2 mt-1 text-text-secondary">
            <span className="text-[12px]">Voice message</span>
          </div>
        )}

        {/* Beat metadata (debug) */}
        {message.meta?.beatIndex !== undefined && message.meta.beatCount !== undefined && (
          <div className="mt-1.5 text-[10px] text-text-placeholder flex gap-2">
            <span>{`beat ${Number(message.meta.beatIndex) + 1}/${String(message.meta.beatCount)}`}</span>
            {typeof message.meta.turnMode === 'string' && <span>{message.meta.turnMode}</span>}
            {typeof message.meta.beatModality === 'string' && message.meta.beatModality !== 'text' && (
              <span>{message.meta.beatModality}</span>
            )}
          </div>
        )}

        {/* Action bar — visible on hover */}
        {message.kind !== 'streaming' && message.content && (
          <MessageActionBar content={message.content} />
        )}
      </div>
    </div>
  );
}

function renderMedia(message: ChatMessage) {
  return (
    <>
      {message.kind === 'image' && message.media?.uri && (
        <img
          src={message.media.uri}
          alt=""
          className="rounded-xl mt-3 max-w-full"
          style={{ maxHeight: 300 }}
        />
      )}
      {message.kind === 'video' && message.media?.uri && (
        <video
          src={message.media.uri}
          controls
          className="rounded-xl mt-3 max-w-full"
          style={{ maxHeight: 300 }}
        />
      )}
      {(message.kind === 'image-pending' || message.kind === 'video-pending') && (
        <div className="flex items-center gap-2 mt-3 text-[12px] text-text-secondary">
          <span className="w-3 h-3 border-2 border-text-secondary border-t-transparent rounded-full animate-spin" />
          <span>{message.kind === 'image-pending' ? 'Generating image...' : 'Generating video...'}</span>
        </div>
      )}
    </>
  );
}
