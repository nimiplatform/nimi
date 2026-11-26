import React, { useRef, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

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
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const enabledItems = items.filter((item) => !item.disabled);
  const tabStop = enabledItems.find((item) => item.value === value)?.value ?? enabledItems[0]?.value;

  return (
    <div className={cn('nimi-tabs flex min-w-0 items-center gap-1 border-b border-[var(--nimi-border-subtle)]', className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node) buttons.current.set(item.value, node);
              else buttons.current.delete(item.value);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={item.value === tabStop ? 0 : -1}
            disabled={item.disabled}
            className={cn(
              'nimi-tabs__tab relative inline-flex min-h-9 min-w-0 items-center justify-center px-3 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-muted)] transition-[color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:text-[var(--nimi-text-primary)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
              FOCUS_RING_CLASS_NAME,
              selected && 'nimi-tabs__tab--active text-[var(--nimi-text-primary)] after:absolute after:right-2 after:bottom-0 after:left-2 after:h-[2px] after:rounded-full after:bg-[var(--nimi-action-primary-bg)]',
            )}
            onClick={() => {
              if (!item.disabled) onValueChange(item.value);
            }}
            onKeyDown={(event) => {
              if (item.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
              const index = enabledItems.findIndex((candidate) => candidate.value === item.value);
              let nextIndex: number;
              switch (event.key) {
                case 'ArrowRight':
                  nextIndex = (index + 1) % enabledItems.length;
                  break;
                case 'ArrowLeft':
                  nextIndex = (index + enabledItems.length - 1) % enabledItems.length;
                  break;
                case 'Home':
                  nextIndex = 0;
                  break;
                case 'End':
                  nextIndex = enabledItems.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              const next = enabledItems[nextIndex]!;
              buttons.current.get(next.value)?.focus();
              if (next.value !== value) onValueChange(next.value);
            }}
          >
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
