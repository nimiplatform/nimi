import React, { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

export type NimiMenuItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: () => void;
};

export type ActionMenuProps = {
  items: NimiMenuItem[];
  ariaLabel: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  /** Logical open request; exiting popovers can retain this component. */
  focusRequestKey?: number;
  onRequestClose?: (reason: 'escape' | 'tab' | 'selection', backward?: boolean) => void;
};

export function ActionMenu({
  items,
  ariaLabel,
  className,
  id,
  autoFocus = true,
  focusRequestKey,
  onRequestClose,
}: ActionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (autoFocus) rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [autoFocus, focusRequestKey]);
  // Chromeless by design: ActionMenu is overlay content composed inside
  // PopoverContent, which already owns the panel boundary, material, and
  // elevation. Rendering a second Surface here produced a panel-in-panel.
  return (
    <div ref={rootRef} id={id} className={cn('nimi-action-menu flex min-w-40 flex-col', className)} role="menu" aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); onRequestClose?.('escape'); return;
        }
        if (event.key === 'Tab') { if (onRequestClose) event.preventDefault(); onRequestClose?.('tab', event.shiftKey); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const enabled = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
        if (!enabled.length) return;
        event.preventDefault(); event.stopPropagation();
        const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % enabled.length : (current - 1 + enabled.length) % enabled.length;
        enabled[next]?.focus();
      }}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          aria-description={item.disabled ? item.disabledReason : undefined}
          title={item.disabled ? item.disabledReason : undefined}
          className={cn(
            'nimi-action-menu__item flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[var(--nimi-radius-sm)] px-3 text-left text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)] transition-[background-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] hover:bg-[var(--nimi-action-ghost-hover)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
            FOCUS_RING_CLASS_NAME,
            item.tone === 'danger' && 'nimi-action-menu__item--danger text-[var(--nimi-status-danger)]',
          )}
          onClick={() => { item.onSelect?.(); onRequestClose?.('selection'); }}
        >
          {item.icon ? <span className="nimi-action-menu__icon inline-flex shrink-0 items-center justify-center">{item.icon}</span> : null}
          <span className="min-w-0 flex-1"><span className="block">{item.label}</span>{item.disabled && item.disabledReason ? <span className="block whitespace-normal text-[length:var(--nimi-type-caption-size)]">{item.disabledReason}</span> : null}</span>
          {item.trailingIcon ? <span className="nimi-action-menu__trailing-icon inline-flex shrink-0 items-center justify-center">{item.trailingIcon}</span> : null}
        </button>
      ))}
    </div>
  );
}
