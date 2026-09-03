import React, { type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';
import { Surface } from './surface.js';

export type NimiMenuItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect?: () => void;
};

type ActionMenuProps = {
  items: NimiMenuItem[];
  ariaLabel: string;
  className?: string;
};

export function ActionMenu({
  items,
  ariaLabel,
  className,
}: ActionMenuProps) {
  return (
    <Surface tone="overlay" material="glass-regular" elevation="floating" padding="sm" className={cn('nimi-action-menu min-w-40', className)} role="menu" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={cn(
            'nimi-action-menu__item flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[var(--nimi-radius-sm)] px-3 text-left text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)] transition-[background-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] hover:bg-[var(--nimi-action-ghost-hover)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
            FOCUS_RING_CLASS_NAME,
            item.tone === 'danger' && 'nimi-action-menu__item--danger text-[var(--nimi-status-danger)]',
          )}
          onClick={item.onSelect}
        >
          {item.icon ? <span className="nimi-action-menu__icon inline-flex shrink-0 items-center justify-center">{item.icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.trailingIcon ? <span className="nimi-action-menu__trailing-icon inline-flex shrink-0 items-center justify-center">{item.trailingIcon}</span> : null}
        </button>
      ))}
    </Surface>
  );
}
