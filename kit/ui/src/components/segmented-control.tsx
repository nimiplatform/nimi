import React, { useRef, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

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

// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-018
export function SegmentedControl({
  items,
  value,
  onValueChange,
  ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const enabledItems = items.filter(item => !item.disabled);
  const tabStop = enabledItems.find(item => item.value === value)?.value ?? enabledItems[0]?.value;
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
            ref={node => {
              if (node) buttons.current.set(item.value, node);
              else buttons.current.delete(item.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={item.value === tabStop ? 0 : -1}
            disabled={item.disabled}
            className={cn(
              'nimi-segmented-control__item inline-flex min-w-0 items-center justify-center gap-2 rounded-[var(--nimi-radius-sm)] border border-transparent text-[var(--nimi-text-secondary)] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
              FOCUS_RING_CLASS_NAME,
              size === 'sm' ? 'min-h-7 px-2 text-[length:var(--nimi-type-body-sm-size)]' : 'min-h-8 px-3 text-[length:var(--nimi-type-label-size)]',
              selected && 'nimi-segmented-control__item--selected bg-[var(--nimi-surface-active)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]',
            )}
            onClick={() => {
              if (!item.disabled) onValueChange(item.value);
            }}
            onKeyDown={event => {
              if (item.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.key === ' ') {
                event.preventDefault();
                if (!selected) onValueChange(item.value);
                return;
              }
              const index = enabledItems.findIndex(candidate => candidate.value === item.value);
              let nextIndex: number;
              switch (event.key) {
                case 'ArrowRight':
                case 'ArrowDown': nextIndex = (index + 1) % enabledItems.length; break;
                case 'ArrowLeft':
                case 'ArrowUp': nextIndex = (index + enabledItems.length - 1) % enabledItems.length; break;
                case 'Home': nextIndex = 0; break;
                case 'End': nextIndex = enabledItems.length - 1; break;
                default: return;
              }
              event.preventDefault();
              const next = enabledItems[nextIndex]!;
              buttons.current.get(next.value)?.focus();
              if (next.value !== value) onValueChange(next.value);
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
