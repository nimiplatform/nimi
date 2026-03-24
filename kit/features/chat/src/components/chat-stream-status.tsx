import type { ReactNode } from 'react';

export type ChatStreamStatusProps = {
  partialText?: string | null;
  mode: 'streaming' | 'interrupted';
  avatar?: ReactNode;
  className?: string;
  bubbleClassName?: string;
  actions?: ReactNode;
  errorMessage?: string | null;
  loadingIndicator?: ReactNode;
  emptyStreamingFallback?: ReactNode;
  interruptedSuffix?: ReactNode;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function DefaultLoadingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-gray-400">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

export function ChatStreamStatus({
  partialText,
  mode,
  avatar,
  className,
  bubbleClassName,
  actions,
  errorMessage,
  loadingIndicator = <DefaultLoadingIndicator />,
  emptyStreamingFallback,
  interruptedSuffix,
}: ChatStreamStatusProps) {
  const resolvedEmptyStreamingFallback = emptyStreamingFallback ?? loadingIndicator;
  const resolvedInterruptedSuffix = interruptedSuffix ?? (
    <span className="ml-1 text-xs text-red-400">[Interrupted]</span>
  );

  return (
    <div className={cn('flex gap-2', className)}>
      {avatar}
      <div className="max-w-[75%]">
        <div className={cn('inline-block rounded-[18px] bg-[#F2F2F7] px-4 py-2.5 text-[15px] leading-snug text-gray-900', bubbleClassName)}>
          {mode === 'streaming'
            ? (partialText || resolvedEmptyStreamingFallback)
            : (
              <>
                {partialText}
                {resolvedInterruptedSuffix}
              </>
            )}
        </div>
        {actions ? <div className="mt-1">{actions}</div> : null}
        {mode === 'interrupted' && errorMessage ? (
          <p className="mt-1 text-xs text-red-400">{errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
