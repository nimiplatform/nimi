import { type ReactNode } from 'react';
import { cn } from '../design-tokens.js';

export type DataListEntry = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
};

export type DataListProps = {
  items: DataListEntry[];
  ariaLabel: string;
  empty?: ReactNode;
  className?: string;
};

export function DataList({ items, ariaLabel, empty, className }: DataListProps) {
  if (items.length === 0) {
    return (
      <div className={cn('nimi-data-list nimi-data-list--empty rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 text-sm text-[var(--nimi-text-secondary)]', className)}>
        {empty ?? 'No rows'}
      </div>
    );
  }

  return (
    <ul className={cn('nimi-data-list overflow-hidden rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]', className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.id} className="nimi-data-list__item grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--nimi-border-subtle)] p-3 last:border-b-0">
          {item.leading ? <span className="nimi-data-list__leading inline-flex shrink-0 items-center justify-center">{item.leading}</span> : <span aria-hidden="true" />}
          <span className="nimi-data-list__body grid min-w-0 gap-1">
            <span className="nimi-data-list__title truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{item.title}</span>
            {item.description ? <span className="nimi-data-list__description truncate text-xs text-[var(--nimi-text-secondary)]">{item.description}</span> : null}
            {item.meta ? <span className="nimi-data-list__meta text-xs text-[var(--nimi-text-muted)]">{item.meta}</span> : null}
          </span>
          <span className="nimi-data-list__aside inline-flex shrink-0 items-center gap-2">
            {item.trailing}
            {item.actions}
          </span>
        </li>
      ))}
    </ul>
  );
}
