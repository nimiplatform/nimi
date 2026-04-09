/**
 * Forge Segment Control — button group for filter/option toggles.
 *
 * Replaces 12+ instances of the inline flex + rounded-lg + border + overflow-hidden
 * button group pattern across Forge pages.
 */

import { cn } from '@nimiplatform/nimi-kit/ui';

export type SegmentOption<T extends string = string> = {
  value: T;
  label: string;
};

export function ForgeSegmentControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const paddingClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <div className={cn('inline-flex overflow-hidden rounded-[var(--nimi-radius-action)] border border-[var(--nimi-border-subtle)]', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            paddingClass,
            'font-medium transition-colors',
            value === option.value
              ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
              : 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
