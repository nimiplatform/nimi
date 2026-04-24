import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationMode } from '../types.js';

export type ConversationModeOption = {
  mode: ConversationMode;
  label: string;
  disabled?: boolean;
  countBadge?: string | number | null;
};

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

export function ConversationModeSwitcher({
  modes,
  activeMode,
  onModeChange,
  className,
}: ConversationModeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeOption = modes.find((m) => m.mode === activeMode);

  const close = useCallback(() => setOpen(false), []);

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

  if (modes.length <= 1) {
    return null;
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-full',
          'border border-slate-200/80 bg-white/90 text-slate-700',
          'shadow-[0_2px_8px_rgba(15,23,42,0.05)]',
          'transition-all duration-150',
          'hover:-translate-y-px hover:border-emerald-300 hover:text-teal-700 hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)]',
          'active:scale-[0.985]',
        )}
        aria-label={`Current mode: ${activeOption?.label || activeMode}`}
      >
        {MODE_ICONS[activeMode]}
      </button>

      {/* dropdown */}
      {open ? (
        <div
          className={cn(
            'absolute left-0 top-full z-50 mt-2 min-w-[180px]',
            'rounded-xl border border-slate-200/60 bg-white/95 py-1.5',
            'shadow-[0_12px_36px_rgba(15,23,42,0.1)] backdrop-blur-lg',
            'conv-animate-fade-in',
          )}
        >
          {modes.map((option) => {
            const active = option.mode === activeMode;
            return (
              <button
                key={option.mode}
                type="button"
                disabled={option.disabled}
                onClick={() => {
                  onModeChange?.(option.mode);
                  close();
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors',
                  active
                    ? 'bg-emerald-50/80 font-semibold text-emerald-800'
                    : 'text-slate-700 hover:bg-slate-50',
                  option.disabled && 'pointer-events-none opacity-40',
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center text-current">
                  {MODE_ICONS[option.mode]}
                </span>
                <span className="flex-1">{option.label}</span>
                {option.countBadge != null && option.countBadge !== '' ? (
                  <span className={cn(
                    'inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                    active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
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
