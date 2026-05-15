import React, { type ReactNode } from 'react';
import { cn } from '../design-tokens.js';

export type NimiTabItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type NimiTabsProps = {
  items: NimiTabItem[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
};

export function NimiTabs({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: NimiTabsProps) {
  return (
    <div className={cn('nimi-tabs flex min-w-0 items-center gap-1 border-b border-[var(--nimi-border-subtle)]', className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={item.disabled}
            className={cn(
              'nimi-tabs__tab relative inline-flex min-h-9 min-w-0 items-center justify-center px-3 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-muted)] transition-colors duration-[var(--nimi-motion-fast)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
              selected && 'nimi-tabs__tab--active text-[var(--nimi-text-primary)] after:absolute after:right-2 after:bottom-0 after:left-2 after:h-[2px] after:rounded-full after:bg-[var(--nimi-action-primary-bg)]',
            )}
            onClick={() => {
              if (!item.disabled) onValueChange(item.value);
            }}
          >
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
