import React, { useId, useRef, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';
import { motion, nimiReducedFade, nimiSpring, useNimiReducedMotion } from '../motion/index.js';
import { Surface } from './surface.js';

export type PillTabItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type PillTabsSize = 'sm' | 'md';

type PillTabsProps = {
  items: PillTabItem[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  size?: PillTabsSize;
  className?: string;
};

const SIZE_TAB: Record<PillTabsSize, string> = {
  sm: 'min-h-8 px-4 text-[length:var(--nimi-type-body-sm-size)]',
  md: 'min-h-9 px-5 text-[length:var(--nimi-type-label-size)]',
};

/**
 * Pill-shaped tab selector with a spring-animated active indicator. Uses
 * Motion shared-layout projection (`layoutId`) so the active pill glides on
 * the compositor without animating layout `width` or flying in on mount.
 */
export function PillTabs({
  items,
  value,
  onValueChange,
  ariaLabel,
  size = 'md',
  className,
}: PillTabsProps) {
  const indicatorId = useId();
  const reducedMotion = useNimiReducedMotion();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const enabledItems = items.filter((item) => !item.disabled);
  const tabStop = enabledItems.find((item) => item.value === value)?.value ?? enabledItems[0]?.value;
  const indicatorTransition = reducedMotion ? nimiReducedFade() : nimiSpring('default');

  return (
    <Surface
      tone="card"
      material="glass-regular"
      elevation="base"
      padding="none"
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('nimi-pill-tabs relative inline-flex w-fit rounded-full p-1', className)}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node) tabRefs.current.set(item.value, node);
              else tabRefs.current.delete(item.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={item.value === tabStop ? 0 : -1}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) onValueChange(item.value);
            }}
            onKeyDown={(event) => {
              if (item.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.key === ' ') {
                event.preventDefault();
                if (!selected) onValueChange(item.value);
                return;
              }
              const index = enabledItems.findIndex((candidate) => candidate.value === item.value);
              let nextIndex: number;
              switch (event.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                  nextIndex = (index + 1) % enabledItems.length;
                  break;
                case 'ArrowLeft':
                case 'ArrowUp':
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
              tabRefs.current.get(next.value)?.focus();
              if (next.value !== value) onValueChange(next.value);
            }}
            className={cn(
              'nimi-pill-tabs__tab relative z-[1] inline-flex min-w-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-[color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
              FOCUS_RING_CLASS_NAME,
              SIZE_TAB[size],
              selected
                ? 'nimi-pill-tabs__tab--active text-[var(--nimi-action-primary-text)]'
                : 'text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={indicatorId}
                aria-hidden="true"
                transition={indicatorTransition}
                className="nimi-pill-tabs__indicator pointer-events-none absolute inset-0 -z-[1] rounded-full bg-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]"
              />
            ) : null}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </Surface>
  );
}
