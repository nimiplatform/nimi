/**
 * Forge Page Layout Primitives — consistent page chrome across all Forge pages.
 */

import type { ReactNode } from 'react';
import { ScrollArea, Surface, Button } from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  ForgePage — scrollable page with max-width container               */
/* ------------------------------------------------------------------ */

export function ForgePage({
  children,
  className,
  maxWidth = 'max-w-4xl',
}: {
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <ScrollArea className="h-full flex-1">
      <div className={`mx-auto ${maxWidth} space-y-6 p-6 ${className ?? ''}`}>
        {children}
      </div>
    </ScrollArea>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgePageHeader — title + subtitle + optional trailing actions     */
/* ------------------------------------------------------------------ */

export function ForgePageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-[var(--nimi-text-primary)]">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">{subtitle}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgeEmptyState — centered empty-state message                     */
/* ------------------------------------------------------------------ */

export function ForgeEmptyState({
  message,
  action,
  onAction,
}: {
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Surface tone="card" padding="lg" className="text-center">
      <p className="text-sm text-[var(--nimi-text-muted)]">{message}</p>
      {action && onAction && (
        <Button tone="secondary" size="sm" onClick={onAction} className="mt-4">
          {action}
        </Button>
      )}
    </Surface>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgeStatCard — KPI / stat display card                            */
/* ------------------------------------------------------------------ */

export function ForgeStatCard({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string | number;
  detail?: string;
  className?: string;
}) {
  return (
    <Surface tone="card" padding="md" className={className}>
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--nimi-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--nimi-text-primary)]">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{detail}</p>}
    </Surface>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgeLoadingSpinner — consistent loading indicator                 */
/* ------------------------------------------------------------------ */

export function ForgeLoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--nimi-border-subtle)] border-t-[var(--nimi-text-primary)]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ForgeErrorBanner — inline error display                            */
/* ------------------------------------------------------------------ */

export function ForgeErrorBanner({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <Surface tone="card" padding="sm" className={`border-[var(--nimi-status-danger)] ${className ?? ''}`}>
      <p className="text-sm text-[var(--nimi-status-danger)]">{message}</p>
    </Surface>
  );
}
