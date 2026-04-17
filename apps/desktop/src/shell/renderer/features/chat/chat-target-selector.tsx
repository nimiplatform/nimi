import { useState, useRef, useEffect, useCallback } from 'react';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import { DesktopFieldTrigger } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { useTranslation } from 'react-i18next';

export type ChatTargetOption = {
  id: string;
  label: string;
  handle?: string | null;
  avatarUrl?: string | null;
};

export type ChatTargetSelectorProps = {
  options: readonly ChatTargetOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function ChatTargetSelector({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: ChatTargetSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) || null;
  const resolvedPlaceholder = placeholder || t('Chat.targetSelectorPlaceholder', {
    defaultValue: 'Select a target',
  });

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

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* trigger */}
      <DesktopFieldTrigger
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="disabled:bg-gray-100 disabled:text-gray-400"
      >
        {selected ? (
          <>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[10px] font-semibold text-white">
              {selected.label.charAt(0).toUpperCase()}
            </div>
            <span className="min-w-0 flex-1 truncate text-gray-900">{selected.label}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-gray-400">{resolvedPlaceholder}</span>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={cn('shrink-0 text-[var(--nimi-text-muted)] transition-transform', open && 'rotate-180')}>
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </DesktopFieldTrigger>

      {/* dropdown */}
      {open ? (
        <DesktopCardSurface kind="operational-solid" as="div" className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden">
          <ScrollArea className="max-h-[240px]" contentClassName="py-1">
            {options.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">
                {t('Chat.targetSelectorEmpty', {
                  defaultValue: 'No targets available',
                })}
              </div>
            ) : (
              options.map((option) => {
                const active = option.id === value;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onChange(option.id);
                      close();
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)]'
                        : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,white)]',
                    )}
                  >
                    <div className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
                      active ? 'bg-[var(--nimi-action-primary-bg)]' : 'bg-gray-400',
                    )}>
                      {option.label.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate text-sm', active ? 'font-semibold text-[var(--nimi-action-primary-bg)]' : 'text-gray-900')}>
                        {option.label}
                      </div>
                      {option.handle ? (
                        <div className="truncate text-[11px] text-gray-400">@{option.handle}</div>
                      ) : null}
                    </div>
                    {active ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-[var(--nimi-action-primary-bg)]">
                        <path d="M11.5 4L5.5 10 2.5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                );
              })
            )}
          </ScrollArea>
        </DesktopCardSurface>
      ) : null}
    </div>
  );
}
