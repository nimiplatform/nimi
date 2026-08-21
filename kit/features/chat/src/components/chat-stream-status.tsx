import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { resolveChatCopy, type ChatCopy } from '../copy.js';
import {
  CHAT_BUBBLE_MAX_WIDTH_CLASSNAME,
  CHAT_BUBBLE_TEXT_CLASSNAME,
  chatBubbleShapeStyle,
} from '../bubble-styles.js';

export type ChatStreamStatusProps = {
  partialText?: string | null;
  reasoningText?: string | null;
  mode: 'streaming' | 'interrupted';
  avatar?: ReactNode;
  className?: string;
  bubbleClassName?: string;
  actions?: ReactNode;
  errorMessage?: string | null;
  loadingIndicator?: ReactNode;
  emptyStreamingFallback?: ReactNode;
  interruptedSuffix?: ReactNode;
  reasoningLabel?: ReactNode;
  /** Optional copy overrides merged over the default English strings. */
  copy?: ChatCopy;
};

function DefaultLoadingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-[var(--nimi-text-muted)]">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--nimi-text-muted)]" style={{ animationDelay: '0ms' }} />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--nimi-text-muted)]" style={{ animationDelay: '150ms' }} />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--nimi-text-muted)]" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

export function ChatStreamStatus({
  partialText,
  reasoningText,
  mode,
  avatar,
  className,
  bubbleClassName,
  actions,
  errorMessage,
  loadingIndicator = <DefaultLoadingIndicator />,
  emptyStreamingFallback,
  interruptedSuffix,
  reasoningLabel = 'Thought process',
  copy,
}: ChatStreamStatusProps) {
  const copyResolved = resolveChatCopy(copy);
  const resolvedEmptyStreamingFallback = emptyStreamingFallback ?? loadingIndicator;
  const resolvedInterruptedSuffix = interruptedSuffix ?? (
    <span className="ml-1 text-xs text-[var(--nimi-status-danger)]">{copyResolved.streamInterruptedLabel}</span>
  );

  return (
    <div className={cn('flex gap-2', className)}>
      {avatar}
      <div className={CHAT_BUBBLE_MAX_WIDTH_CLASSNAME}>
        <div
          className={cn(
            'inline-block bg-[var(--nimi-surface-card)] px-4 py-2.5 text-[var(--nimi-text-primary)]',
            CHAT_BUBBLE_TEXT_CLASSNAME,
            bubbleClassName,
          )}
          style={chatBubbleShapeStyle('agent')}
        >
          {reasoningText ? (
            <details className="mb-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,white)] px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-[var(--nimi-text-muted)]">
                {reasoningLabel}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {reasoningText}
              </pre>
            </details>
          ) : null}
          {mode === 'streaming'
            ? (partialText || resolvedEmptyStreamingFallback)
            : (
              <>
                {partialText}
                {resolvedInterruptedSuffix}
              </>
            )}
          {actions ?? null}
        </div>
        {mode === 'interrupted' && errorMessage ? (
          <p className="mt-1 text-xs text-[var(--nimi-status-danger)]">{errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
