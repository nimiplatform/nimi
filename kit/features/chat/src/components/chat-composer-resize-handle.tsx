import type { MouseEventHandler } from 'react';

export type ChatComposerResizeHandleProps = {
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  ariaLabel?: string;
  className?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function ChatComposerResizeHandle({
  onMouseDown,
  ariaLabel = 'Resize input area',
  className,
}: ChatComposerResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      className={cn('relative h-2 shrink-0 cursor-row-resize bg-transparent', className)}
    >
      <div className="absolute left-0 right-0 top-1/2 h-[0.5px] -translate-y-1/2 bg-gray-100/80" />
    </div>
  );
}
