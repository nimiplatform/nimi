import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

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
}: ChatStreamStatusProps) {
  const resolvedEmptyStreamingFallback = emptyStreamingFallback ?? loadingIndicator;
  const resolvedInterruptedSuffix = interruptedSuffix ?? (
    <span className="ml-1 text-xs text-[var(--nimi-status-danger)]">[Interrupted]</span>
  );

  return (
    <div className={cn('flex gap-2', className)}>
      {avatar}
      <div className="max-w-[75%]">
        <div className={cn(
          'inline-block rounded-[18px] bg-[var(--nimi-surface-card)] px-4 py-2.5 text-[15px] leading-snug text-[var(--nimi-text-primary)]',
          bubbleClassName,
        )}
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
