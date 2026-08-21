import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import type { ConversationMode } from '../types.js';

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; mode entry is owned by the canonical target pane and shell.
 */
export type ConversationModeOption = {
  mode: ConversationMode;
  label: string;
  disabled?: boolean;
  countBadge?: string | number | null;
};

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; mode entry is owned by the canonical target pane and shell.
 */
export type ConversationModeSwitcherProps = {
  modes: readonly ConversationModeOption[];
  activeMode: ConversationMode;
  onModeChange?: (mode: ConversationMode) => void;
  className?: string;
};

const MODE_ICONS: Record<ConversationMode, React.ReactNode> = {
  ai: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5a1 1 0 0 1 1 1V3h2.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H7V2.5a1 1 0 0 1 1-1ZM6 7.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="currentColor" />
    </svg>
  ),
  human: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5" r="3" fill="currentColor" />
      <path d="M2.5 14a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  agent: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1l2.35 4.76L15 6.5l-3.5 3.41.83 4.84L8 12.5l-4.33 2.25.83-4.84L1 6.5l4.65-.74L8 1Z" fill="currentColor" />
    </svg>
  ),
  group: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="5.5" cy="5" r="2.5" fill="currentColor" />
      <circle cx="10.5" cy="5" r="2.5" fill="currentColor" />
      <path d="M1 14a4.5 4.5 0 0 1 9 0M6 14a4.5 4.5 0 0 1 9 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
};

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; mode entry is owned by the canonical target pane and shell.
 */
export function ConversationModeSwitcher({
  modes,
  activeMode,
  onModeChange,
  className,
}: ConversationModeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeOption = modes.find((m) => m.mode === activeMode);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Move focus into the menu when it opens.
  useEffect(() => {
    if (!open) return;
    const firstEnabledIndex = modes.findIndex((option) => !option.disabled);
    if (firstEnabledIndex >= 0) {
      itemRefs.current[firstEnabledIndex]?.focus();
    }
  }, [open, modes]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const enabledIndexes = modes
        .map((option, index) => (option.disabled ? -1 : index))
        .filter((index) => index >= 0);
      if (enabledIndexes.length === 0) return;
      const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);
      const currentPosition = enabledIndexes.indexOf(currentIndex);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextPosition = currentPosition === -1
        ? (delta === 1 ? 0 : enabledIndexes.length - 1)
        : (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length;
      itemRefs.current[enabledIndexes[nextPosition]!]?.focus();
    }
  }, [open, modes, close]);

  if (modes.length <= 1) {
    return null;
  }

  return (
    <div ref={ref} className={cn('relative', className)} onKeyDown={handleKeyDown}>
      {/* trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-full',
          'border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] text-[var(--nimi-text-secondary)]',
          'shadow-[var(--nimi-elevation-base)]',
          'transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
          'hover:border-[var(--nimi-action-primary-bg)]/50 hover:text-[var(--nimi-action-primary-bg)] hover:shadow-[var(--nimi-elevation-raised)]',
          'active:scale-[var(--nimi-motion-pressed-scale)]',
        )}
        aria-label={`Current mode: ${activeOption?.label || activeMode}`}
      >
        {MODE_ICONS[activeMode]}
      </button>

      {/* dropdown */}
      {open ? (
        <div
          role="menu"
          aria-orientation="vertical"
          className={cn(
            'absolute left-0 top-full z-[var(--nimi-z-popover)] mt-2 min-w-[180px]',
            'rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] py-1.5',
            'shadow-[var(--nimi-elevation-floating)]',
            'conv-animate-fade-in',
          )}
        >
          {modes.map((option, index) => {
            const active = option.mode === activeMode;
            return (
              <button
                key={option.mode}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                disabled={option.disabled}
                onClick={() => {
                  onModeChange?.(option.mode);
                  close(true);
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[length:var(--nimi-type-body-sm-size)] transition-colors',
                  active
                    ? 'bg-[var(--nimi-surface-active)] font-semibold text-[var(--nimi-action-primary-bg)]'
                    : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-panel)]',
                  option.disabled && 'pointer-events-none opacity-40',
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center text-current">
                  {MODE_ICONS[option.mode]}
                </span>
                <span className="flex-1">{option.label}</span>
                {option.countBadge != null && option.countBadge !== '' ? (
                  <span className={cn(
                    'inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[length:var(--nimi-type-overline-size)] font-semibold',
                    active ? 'bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]' : 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]',
                  )}>
                    {option.countBadge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
