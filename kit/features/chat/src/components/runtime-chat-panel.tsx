import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Surface, TextareaField, cn } from '@nimiplatform/nimi-kit/ui';
import type {
  RuntimeChatSessionMessage,
  UseRuntimeChatSessionResult,
} from '../runtime.js';

export type RuntimeChatPanelProps = {
  session: UseRuntimeChatSessionResult;
  className?: string;
  messagesClassName?: string;
  composerClassName?: string;
  placeholder?: string;
  sendLabel?: string;
  streamingLabel?: string;
  cancelLabel?: string;
  resetLabel?: string;
  emptyState?: ReactNode;
  actions?: ReactNode;
  onReset?: () => void;
  showMessageStatus?: boolean;
  formatMessageStatus?: (message: RuntimeChatSessionMessage) => string | null;
  messageListClassName?: string;
  messageRowClassName?: string;
  userMessageRowClassName?: string;
  assistantMessageRowClassName?: string;
  messageBubbleClassName?: string;
  userMessageBubbleClassName?: string;
  assistantMessageBubbleClassName?: string;
  messageStatusClassName?: string;
  renderMessage?: (message: RuntimeChatSessionMessage, index: number) => ReactNode;
};

function defaultFormatMessageStatus(message: RuntimeChatSessionMessage): string | null {
  if (message.status === 'streaming') {
    return 'Streaming...';
  }
  if (message.status === 'canceled') {
    return 'Canceled';
  }
  if (message.status === 'error') {
    return message.error || 'Error';
  }
  return null;
}

export function RuntimeChatPanel({
  session,
  className,
  messagesClassName,
  composerClassName,
  placeholder = 'Type a message...',
  sendLabel = 'Send',
  streamingLabel = 'Streaming...',
  cancelLabel = 'Cancel',
  resetLabel = 'Reset',
  emptyState = <p className="py-8 text-center text-sm text-[color:var(--nimi-text-muted)]">No messages yet</p>,
  actions,
  onReset,
  showMessageStatus = true,
  formatMessageStatus = defaultFormatMessageStatus,
  messageListClassName,
  messageRowClassName,
  userMessageRowClassName,
  assistantMessageRowClassName,
  messageBubbleClassName,
  userMessageBubbleClassName,
  assistantMessageBubbleClassName,
  messageStatusClassName,
  renderMessage,
}: RuntimeChatPanelProps) {
  const [input, setInput] = useState('');
  const { messages, isStreaming, canCancel, sendPrompt, cancelCurrent, resetMessages } = session;
  const resolvedMessagesClassName = messagesClassName ?? 'h-80';

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || isStreaming) {
      return;
    }
    setInput('');
    await sendPrompt(prompt);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <Surface tone="panel" padding="none" className={`flex flex-col ${className || ''}`.trim()}>
      <div className="flex items-center justify-end gap-2 border-b border-[color:var(--nimi-border-subtle)] px-4 py-3">
        {actions}
        <Button
          tone="ghost"
          size="sm"
          onClick={() => {
            resetMessages([]);
            onReset?.();
          }}
        >
          {resetLabel}
        </Button>
      </div>

      <div className={`overflow-auto p-4 ${resolvedMessagesClassName}`}>
        {messages.length === 0 ? emptyState : (
          <div className={cn('space-y-3', messageListClassName)}>
            {messages.map((message, index) => {
              if (renderMessage) {
                return renderMessage(message, index);
              }

              const statusText = showMessageStatus ? formatMessageStatus(message) : null;
              return (
                <div
                  key={message.id || index}
                  className={cn(
                    'flex',
                    message.role === 'user' ? 'justify-end' : 'justify-start',
                    messageRowClassName,
                    message.role === 'user' ? userMessageRowClassName : assistantMessageRowClassName,
                  )}
                >
                  <div className="max-w-[80%]">
                    <div
                      className={cn(
                        'rounded-2xl px-3 py-2 text-sm',
                        message.role === 'user'
                          ? 'bg-[color:var(--nimi-text-primary)] text-[color:var(--nimi-surface-base)]'
                          : 'bg-[color:var(--nimi-surface-card)] text-[color:var(--nimi-text-primary)]',
                        messageBubbleClassName,
                        message.role === 'user'
                          ? userMessageBubbleClassName
                          : assistantMessageBubbleClassName,
                      )}
                    >
                      {message.content}
                    </div>
                    {statusText ? (
                      <div
                        className={cn(
                          'mt-1 px-1 text-[11px] text-[color:var(--nimi-text-muted)]',
                          message.role === 'user' ? 'text-right' : 'text-left',
                          messageStatusClassName,
                        )}
                      >
                        {statusText}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={`border-t border-[color:var(--nimi-border-subtle)] p-3 ${composerClassName || ''}`}>
        <div className="flex gap-2">
          <TextareaField
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming}
            rows={1}
            tone="quiet"
            className="flex-1"
            textareaClassName="min-h-6 max-h-[200px] resize-none"
          />
          <Button
            tone={canCancel ? 'secondary' : 'primary'}
            onClick={() => {
              if (canCancel) {
                cancelCurrent();
                return;
              }
              void handleSend();
            }}
            disabled={!canCancel && !input.trim()}
            className="rounded-xl"
          >
            {canCancel ? cancelLabel : isStreaming ? streamingLabel : sendLabel}
          </Button>
        </div>
      </div>
    </Surface>
  );
}
