/**
 * Forge Card Components — list cards and action cards using kit Surface.
 */

import type { ReactNode } from 'react';
import { Surface, Button, Avatar } from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  ForgeListCard — interactive list row with actions                   */
/* ------------------------------------------------------------------ */

export function ForgeListCard({
  leading,
  title,
  subtitle,
  badges,
  actions,
  onClick,
  className,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Surface
      tone="card"
      padding="none"
      interactive={!!onClick}
      className={`flex items-center justify-between px-4 py-3 ${className ?? ''}`}
      onClick={onClick}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{title}</p>
            {badges}
          </div>
          {subtitle && (
            <p className="truncate text-xs text-[var(--nimi-text-muted)]">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="ml-3 flex shrink-0 items-center gap-1">{actions}</div>}
    </Surface>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgeActionCard — navigable card with icon + title + description   */
/* ------------------------------------------------------------------ */

export function ForgeActionCard({
  icon,
  title,
  description,
  onClick,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Surface
      tone="card"
      padding="md"
      interactive
      className={`flex items-start gap-3 ${className ?? ''}`}
      onClick={onClick}
    >
      {icon && (
        <span className="mt-0.5 shrink-0 text-[var(--nimi-text-muted)]">{icon}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{description}</p>
        )}
      </div>
    </Surface>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgeEntityAvatar — avatar placeholder for agents/worlds           */
/* ------------------------------------------------------------------ */

export function ForgeEntityAvatar({
  src,
  name,
  size = 'md',
}: {
  src?: string | null;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Avatar
      src={src}
      alt={name || '?'}
      size={size}
      shape="circle"
      tone="neutral"
    />
  );
}
