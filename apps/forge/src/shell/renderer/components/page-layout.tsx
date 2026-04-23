/**
 * Forge Page Layout Primitives — consistent page chrome across all Forge pages.
 */

import type { ReactNode } from 'react';
import { ScrollArea, Surface, Button, cn } from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  ForgePage — scrollable page with max-width container               */
/* ------------------------------------------------------------------ */

export function ForgePage({
  children,
  className,
  maxWidth = 'max-w-5xl',
}: {
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <ScrollArea className="h-full flex-1" viewportClassName="bg-transparent">
      <div
        className={cn(
          'mx-auto w-full space-y-6 px-4 py-4 md:px-6 md:py-5',
          maxWidth,
          className,
        )}
      >
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
    <Surface
      tone="hero"
      material="glass-regular"
      elevation="raised"
      padding="lg"
      className="overflow-hidden"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--nimi-accent-text)]">
            Forge Studio
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--nimi-text-primary)] md:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--nimi-text-muted)]">
              {subtitle}
            </p>
          )}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </Surface>
  );
}

export function ForgeSection({
  children,
  className,
  material = 'glass-thin',
}: {
  children: ReactNode;
  className?: string;
  material?: 'solid' | 'glass-thin' | 'glass-regular' | 'glass-thick' | 'glass-chrome';
}) {
  return (
    <Surface
      tone="card"
      material={material}
      elevation="base"
      padding="md"
      className={className}
    >
      {children}
    </Surface>
  );
}

export function ForgeSectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nimi-text-muted)]">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">{description}</p>
        )}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
    <Surface tone="card" material="glass-thin" padding="lg" className="text-center">
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
    <Surface
      tone="card"
      material="glass-thin"
      elevation="raised"
      padding="md"
      className={cn('min-h-[132px] justify-between', className)}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--nimi-text-muted)]">{label}</p>
      <p className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-[var(--nimi-text-primary)]">{value}</p>
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
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--nimi-border-subtle)] border-t-[var(--nimi-accent-text)]" />
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
    <Surface
      tone="card"
      material="glass-thin"
      padding="sm"
      className={cn('border-[var(--nimi-status-danger)]', className)}
    >
      <p className="text-sm text-[var(--nimi-status-danger)]">{message}</p>
    </Surface>
  );
}

export function ForgeFullscreenState({
  title,
  message,
  action,
  onAction,
  loading = false,
}: {
  title: string;
  message?: string;
  action?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center p-6">
      <Surface
        tone="hero"
        material="glass-regular"
        elevation="floating"
        padding="lg"
        className="w-full max-w-xl text-center"
      >
        {loading ? <ForgeLoadingSpinner /> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--nimi-text-primary)]">
          {title}
        </h1>
        {message ? (
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--nimi-text-muted)]">
            {message}
          </p>
        ) : null}
        {action && onAction ? (
          <Button tone="secondary" onClick={onAction} className="mt-6">
            {action}
          </Button>
        ) : null}
      </Surface>
    </div>
  );
}
