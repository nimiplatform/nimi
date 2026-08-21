import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, EmptyState, Surface, TextareaField, cn } from '@nimiplatform/kit/ui';
import type {
  AppAiChatSessionMessage,
  UseAppAiChatSessionResult,
} from '../runtime.js';
import {
  CHAT_BUBBLE_MAX_WIDTH_CLASSNAME,
  chatBubbleShapeStyle,
} from '../bubble-styles.js';

export type AppAiChatPanelProps = {
  session: UseAppAiChatSessionResult;
  className?: string;
  messagesClassName?: string;
  composerClassName?: string;
  placeholder?: string;
  sendLabel?: string;
  streamingLabel?: string;
  cancelLabel?: string;
  resetLabel?: string;
  emptyState?: ReactNode;
  /** Title used by the default empty state when `emptyState` is not provided. */
  emptyStateLabel?: string;
  actions?: ReactNode;
  onReset?: () => void;
  showMessageStatus?: boolean;
  formatMessageStatus?: (message: AppAiChatSessionMessage) => string | null;
  messageListClassName?: string;
  messageRowClassName?: string;
  userMessageRowClassName?: string;
  assistantMessageRowClassName?: string;
  messageBubbleClassName?: string;
  userMessageBubbleClassName?: string;
  assistantMessageBubbleClassName?: string;
  messageStatusClassName?: string;
  renderMessage?: (message: AppAiChatSessionMessage, index: number) => ReactNode;
};

function defaultFormatMessageStatus(message: AppAiChatSessionMessage): string | null {
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

export function AppAiChatPanel({
  session,
  className,
  messagesClassName,
  composerClassName,
  placeholder = 'Type a message...',
  sendLabel = 'Send',
  streamingLabel = 'Streaming...',
  cancelLabel = 'Cancel',
  resetLabel = 'Reset',
  emptyState,
  emptyStateLabel = 'No messages yet',
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
}: AppAiChatPanelProps) {
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
        {messages.length === 0 ? (emptyState ?? <EmptyState title={emptyStateLabel} />) : (
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
                  <div className={CHAT_BUBBLE_MAX_WIDTH_CLASSNAME}>
                    <div
                      className={cn(
                        'px-3 py-2 text-sm',
                        message.role === 'user'
                          ? 'bg-[color:var(--nimi-action-primary-bg)] text-[color:var(--nimi-action-primary-text)]'
                          : 'bg-[color:var(--nimi-surface-card)] text-[color:var(--nimi-text-primary)]',
                        messageBubbleClassName,
                        message.role === 'user'
                          ? userMessageBubbleClassName
                          : assistantMessageBubbleClassName,
                      )}
                      style={chatBubbleShapeStyle(message.role === 'user' ? 'user' : 'agent')}
                    >
                      {message.content}
                    </div>
                    {statusText ? (
                      <div
                        className={cn(
                          'mt-1 px-1 text-[length:var(--nimi-type-overline-size)] text-[color:var(--nimi-text-muted)]',
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
