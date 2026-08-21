import React, { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { Surface } from './surface.js';

// HTMLAttributes.title is `string`; Omit it so the `title` slot keeps its
// intended ReactNode width instead of narrowing to string.
type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <Surface tone="card" material="glass-thin" padding="lg" className={cn('nimi-empty-state flex min-w-0 flex-col items-center justify-center gap-3 text-center', className)} {...rest}>
      {icon ? <div className="nimi-empty-state__icon inline-flex h-10 w-10 items-center justify-center rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] text-[var(--nimi-text-muted)]">{icon}</div> : null}
      <div className="min-w-0">
        <div className="nimi-empty-state__title text-[length:var(--nimi-type-label-size)] font-[var(--nimi-type-label-weight)] text-[var(--nimi-text-primary)]">{title}</div>
        {description ? <div className="nimi-empty-state__description mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">{description}</div> : null}
      </div>
      {action ? <div className="nimi-empty-state__action">{action}</div> : null}
    </Surface>
  );
}
