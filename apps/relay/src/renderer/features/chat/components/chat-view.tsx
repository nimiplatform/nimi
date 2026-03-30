// RL-PIPE-005 — Beat-aware chat transcript view
// User bubbles right-aligned with accent background, AI messages left-aligned with markdown

import { useEffect, useRef } from 'react';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type { ChatMessage } from '../../../app-shell/providers/chat-store.js';
import type { TurnSendPhase } from '../../../app-shell/providers/chat-store.js';
import { MarkdownRenderer } from './markdown-renderer.js';
import { MessageActionBar } from './message-action-bar.js';

interface ChatViewProps {
  messages: ChatMessage[];
  sendPhase: TurnSendPhase;
}

export function ChatView({ messages, sendPhase }: ChatViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  return (
    <ScrollArea className="flex-1" viewportRef={viewportRef}>
      <div className="mx-auto max-w-[720px] px-6 py-6">
        {messages.map((msg, i) => {
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const sameRole = prevMsg?.role === msg.role;
          const gap = sameRole ? 'mt-2' : 'mt-5';

          return (
            <div key={msg.id} className={i === 0 ? '' : gap}>
              {msg.role === 'user' ? (
                <UserMessage message={msg} />
              ) : (
                <AssistantMessage message={msg} />
              )}
            </div>
          );
        })}

        {/* Awaiting first beat — typing indicator */}
        {sendPhase === 'awaiting-first-beat' && (
          <div className="mt-5">
            <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-[color:var(--nimi-surface-card)] px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--nimi-text-muted)]" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--nimi-text-muted)]" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--nimi-text-muted)]" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// User message — right-aligned accent bubble
// ---------------------------------------------------------------------------

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-md bg-[var(--nimi-action-primary-bg)] px-4 py-3 text-[15px] leading-relaxed text-[var(--nimi-action-primary-text)] shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
        {message.content && (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
        {renderMedia(message)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant message — left-aligned with avatar + card background
// ---------------------------------------------------------------------------

function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="group">
      {/* Content bubble */}
      <div className="min-w-0 max-w-[85%]">
        <div className="rounded-2xl rounded-tl-md bg-[color:var(--nimi-surface-card)] px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {message.content && (
            message.kind === 'streaming' ? (
              <div className="text-[15px] leading-relaxed text-[color:var(--nimi-text-primary)]">
                <MarkdownRenderer content={message.content} />
                <span className="ml-0.5 inline-block h-[18px] w-[2px] animate-pulse bg-[var(--nimi-action-primary-bg)] align-text-bottom" />
              </div>
            ) : (
              <div className="text-[15px] leading-relaxed text-[color:var(--nimi-text-primary)]">
                <MarkdownRenderer content={message.content} />
              </div>
            )
          )}

          {renderMedia(message)}

          {/* Voice indicator */}
          {message.kind === 'voice' && (
            <p className="mt-1 text-[12px] text-[color:var(--nimi-text-muted)]">Voice message</p>
          )}
        </div>

        {/* Action bar — hover reveal */}
        {message.kind !== 'streaming' && message.content && (
          <MessageActionBar content={message.content} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media rendering
// ---------------------------------------------------------------------------

function renderMedia(message: ChatMessage) {
  return (
    <>
      {message.kind === 'image' && message.media?.uri && (
        <img
          src={message.media.uri}
          alt=""
          className="mt-2 max-w-full rounded-xl"
          style={{ maxHeight: 300 }}
        />
      )}
      {message.kind === 'video' && message.media?.uri && (
        <video
          src={message.media.uri}
          controls
          className="mt-2 max-w-full rounded-xl"
          style={{ maxHeight: 300 }}
        />
      )}
      {(message.kind === 'image-pending' || message.kind === 'video-pending') && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-[color:var(--nimi-text-muted)]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--nimi-text-muted)] border-t-transparent" />
          <span>{message.kind === 'image-pending' ? 'Generating image...' : 'Generating video...'}</span>
        </div>
      )}
    </>
  );
}
