import React, { type ReactNode } from 'react';
import { cn } from '../design-tokens.js';

export type SegmentedControlItem = {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps = {
  items: SegmentedControlItem[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
};

export function SegmentedControl({
  items,
  value,
  onValueChange,
  ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'nimi-segmented-control inline-flex items-center gap-1 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-1 shadow-[var(--nimi-elevation-base)]',
        size === 'sm' ? 'nimi-segmented-control--size-sm' : 'nimi-segmented-control--size-md',
        className,
      )}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={item.disabled}
            className={cn(
              'nimi-segmented-control__item inline-flex min-w-0 items-center justify-center gap-2 rounded-[var(--nimi-radius-sm)] border border-transparent text-[var(--nimi-text-secondary)] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
              size === 'sm' ? 'min-h-7 px-2 text-[length:var(--nimi-type-body-sm-size)]' : 'min-h-8 px-3 text-[length:var(--nimi-type-label-size)]',
              selected && 'nimi-segmented-control__item--selected bg-[var(--nimi-surface-active)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]',
            )}
            onClick={() => {
              if (!item.disabled) onValueChange(item.value);
            }}
          >
            {item.icon ? <span className="nimi-segmented-control__icon inline-flex shrink-0 items-center justify-center">{item.icon}</span> : null}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
