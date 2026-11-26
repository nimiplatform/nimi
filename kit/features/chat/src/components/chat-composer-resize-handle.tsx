import type { KeyboardEvent, MouseEventHandler, PointerEventHandler } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';

export type ChatComposerResizeHandleProps = {
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  onKeyboardResize?: (deltaPx: number) => void;
  ariaLabel?: string;
  className?: string;
  /** When true, shows a subtle divider line. Default: false. */
  showDivider?: boolean;
};

export function ChatComposerResizeHandle({
  onPointerDown,
  onMouseDown,
  onKeyboardResize,
  ariaLabel = 'Resize input area',
  className,
  showDivider = false,
}: ChatComposerResizeHandleProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onKeyboardResize) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onKeyboardResize(16);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onKeyboardResize(-16);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative h-2.5 shrink-0 cursor-row-resize touch-none rounded-sm bg-transparent',
        FOCUS_RING_CLASS_NAME,
        className,
      )}
    >
      {showDivider ? (
        <div className="absolute left-0 right-0 top-1/2 h-[0.5px] -translate-y-1/2 bg-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)]" />
      ) : null}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--nimi-border-strong)] opacity-0 transition-opacity duration-[var(--nimi-motion-fast)] group-hover:opacity-80 group-focus-visible:opacity-100 group-active:opacity-100"
      />
    </div>
  );
}
