import type { MouseEventHandler } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type ChatComposerResizeHandleProps = {
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  ariaLabel?: string;
  className?: string;
  /** When true, shows a subtle divider line. Default: false. */
  showDivider?: boolean;
};

export function ChatComposerResizeHandle({
  onMouseDown,
  ariaLabel = 'Resize input area',
  className,
  showDivider = false,
}: ChatComposerResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      className={cn('relative h-2 shrink-0 cursor-row-resize bg-transparent', className)}
    >
      {showDivider ? (
        <div className="absolute left-0 right-0 top-1/2 h-[0.5px] -translate-y-1/2 bg-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)]" />
      ) : null}
    </div>
  );
}
