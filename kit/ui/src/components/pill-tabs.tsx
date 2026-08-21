import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';
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

// Eased slide for the active pill — shared slow duration + standard easing
// motion tokens so the indicator glides rather than snapping between segments.
const INDICATOR_TRANSITION =
  'transform var(--nimi-motion-slow) var(--nimi-motion-ease-standard), width var(--nimi-motion-slow) var(--nimi-motion-ease-standard)';

/**
 * Pill-shaped tab selector with a sliding active indicator. The indicator is
 * an absolutely-positioned pill that animates its translateX + width to track
 * the active tab; geometry is measured from the live DOM (via ResizeObserver)
 * so tabs of unequal label width stay aligned. Use for binary / few-option
 * in-page section toggles — for bordered control clusters use
 * `SegmentedControl`, for underline page navigation use `NimiTabs`.
 */
export function PillTabs({
  items,
  value,
  onValueChange,
  ariaLabel,
  size = 'md',
  className,
}: PillTabsProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const activeTab = tabRefs.current.get(value);
    if (!activeTab) {
      setIndicator(null);
      return;
    }
    const sync = () => {
      setIndicator({ left: activeTab.offsetLeft, width: activeTab.offsetWidth });
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(activeTab);
    const track = activeTab.parentElement;
    if (track) observer.observe(track);
    return () => observer.disconnect();
  }, [value, items]);

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
      <span
        aria-hidden="true"
        className={cn(
          'nimi-pill-tabs__indicator pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]',
          indicator ? 'opacity-100' : 'opacity-0',
        )}
        style={
          indicator
            ? {
                width: indicator.width,
                transform: `translateX(${indicator.left}px)`,
                transition: INDICATOR_TRANSITION,
              }
            : undefined
        }
      />
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
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) onValueChange(item.value);
            }}
            className={cn(
              'nimi-pill-tabs__tab relative z-[1] inline-flex min-w-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-colors duration-[var(--nimi-motion-fast)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
              FOCUS_RING_CLASS_NAME,
              SIZE_TAB[size],
              selected
                ? 'nimi-pill-tabs__tab--active text-[var(--nimi-action-primary-text)]'
                : 'text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]',
            )}
          >
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </Surface>
  );
}
