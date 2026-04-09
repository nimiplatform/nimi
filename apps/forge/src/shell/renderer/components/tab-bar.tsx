/**
 * Forge Tab Bar — horizontal tab navigation.
 *
 * Replaces custom tab patterns in workbench panel nav, agent detail tabs, etc.
 */

import { cn } from '@nimiplatform/nimi-kit/ui';

export type ForgeTab<T extends string = string> = {
  value: T;
  label: string;
  badge?: string | number;
};

export function ForgeTabBar<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: ForgeTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1 border-b border-[var(--nimi-border-subtle)]', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative px-4 py-2 text-sm font-medium transition-colors',
            value === tab.value
              ? 'text-[var(--nimi-text-primary)]'
              : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]',
          )}
        >
          <span className="flex items-center gap-1.5">
            {tab.label}
            {tab.badge != null && (
              <span className="rounded-full bg-[var(--nimi-action-primary-bg)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--nimi-action-primary-text)]">
                {tab.badge}
              </span>
            )}
          </span>
          {value === tab.value && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--nimi-action-primary-bg)]" />
          )}
        </button>
      ))}
    </div>
  );
}
