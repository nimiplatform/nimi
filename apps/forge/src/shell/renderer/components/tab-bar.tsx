/**
 * Forge Tab Bar — horizontal tab navigation.
 *
 * Replaces custom tab patterns in workbench panel nav, agent detail tabs, etc.
 */

import { Surface, cn } from '@nimiplatform/nimi-kit/ui';

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
    <Surface
      tone="card"
      material="glass-thin"
      padding="none"
      className={cn('flex gap-1 p-1', className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative rounded-[var(--nimi-radius-action)] px-4 py-2 text-sm font-medium transition-colors',
            value === tab.value
              ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
              : 'text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-secondary)]',
          )}
        >
          <span className="flex items-center gap-1.5">
            {tab.label}
            {tab.badge != null && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                  value === tab.value
                    ? 'bg-white/18 text-white'
                    : 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]',
                )}
              >
                {tab.badge}
              </span>
            )}
          </span>
        </button>
      ))}
    </Surface>
  );
}
