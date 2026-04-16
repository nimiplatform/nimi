import type { RefObject } from 'react';
import {
  CanonicalMessageBubble,
  CanonicalTypingBubble,
} from '@nimiplatform/nimi-kit/features/chat/ui';
import type { ConversationCanonicalMessage } from '@nimiplatform/nimi-kit/features/chat';
import type { AiMessageRow } from '../../bridge/sqlite-bridge.js';

type StreamingState = 'idle' | 'streaming';

function toCanonicalMessage(msg: AiMessageRow): ConversationCanonicalMessage {
  return {
    id: msg.messageId,
    sessionId: 'advisor',
    targetId: 'advisor',
    source: 'ai',
    role: msg.role === 'user' ? 'user' : 'assistant',
    text: msg.content,
    createdAt: msg.createdAt,
    kind: 'text',
    senderName: msg.role === 'user' ? '你' : '成长顾问',
    senderKind: msg.role === 'user' ? 'human' : 'ai',
  };
}

function toStreamingMessage(content: string): ConversationCanonicalMessage {
  return {
    id: '__streaming__',
    sessionId: 'advisor',
    targetId: 'advisor',
    source: 'ai',
    role: 'assistant',
    text: content,
    createdAt: new Date().toISOString(),
    kind: 'streaming',
    senderName: '成长顾问',
    senderKind: 'ai',
  };
}

export type AdvisorTranscriptProps = {
  messages: AiMessageRow[];
  streamingState: StreamingState;
  streamingContent: string;
  onStopGenerating: () => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
};

/**
 * Animation styles scoped under `.conversation-root` — subset of
 * kit's ConversationAnimationStyles (which is not publicly exported).
 */
function AdvisorAnimationStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.conversation-root {
  --conv-slide-up-duration: 0.32s;
  --conv-drift-in-duration: 0.38s;
}
@keyframes chat-slide-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes chat-drift-in {
  from { opacity: 0; transform: translate(8px, 10px); }
  to { opacity: 1; transform: translate(0, 0); }
}
@keyframes typing-dot-bounce {
  0%, 100% { transform: translateY(0); opacity: 0.55; }
  40% { transform: translateY(-3px); opacity: 1; }
}
.conversation-root .lc-typing-bubble {
  position: relative;
  border-radius: 22px;
  border: 1px solid rgba(229,231,235,0.92);
  background: linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.94));
  box-shadow: 0 12px 32px rgba(15,23,42,0.08);
}
.conversation-root .lc-typing-bubble::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(135deg, rgba(167,243,208,0.1), transparent 65%);
}
.conversation-root .lc-typing-label {
  color: #475569;
}
.conversation-root .lc-typing-dot {
  background: linear-gradient(180deg, rgba(16,185,129,0.9), rgba(20,184,166,0.7));
}
@media (prefers-reduced-motion: reduce) {
  .conversation-root .lc-typing-bubble,
  .conversation-root .lc-typing-dot {
    animation: none !important;
  }
}
`,
      }}
    />
  );
}

export function AdvisorTranscript({
  messages,
  streamingState,
  streamingContent,
  onStopGenerating,
  messagesEndRef,
}: AdvisorTranscriptProps) {
  const canonicalMessages = messages.map(toCanonicalMessage);

  return (
    <div className="conversation-root flex-1 overflow-auto">
      <AdvisorAnimationStyles />
      <div className="mx-auto max-w-2xl space-y-3 px-6 pb-4 pt-5">
        {canonicalMessages.map((msg) => (
          <CanonicalMessageBubble
            key={msg.id}
            message={msg}
            showTimestamp={false}
            showAvatar={false}
          />
        ))}

        {/* Streaming with content — show streaming bubble */}
        {streamingState === 'streaming' && streamingContent && (
          <CanonicalMessageBubble
            message={toStreamingMessage(streamingContent)}
            showTimestamp={false}
            showAvatar={false}
          />
        )}

        {/* Streaming without content — show thinking indicator */}
        {streamingState === 'streaming' && !streamingContent && (
          <CanonicalTypingBubble
            agentName="成长顾问"
            thinkingLabel="AI 正在思考..."
            stopLabel="停止"
            onStop={onStopGenerating}
          />
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
