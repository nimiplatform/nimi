import type { ReactNode } from 'react';
import { Tooltip, cn } from '@nimiplatform/kit/ui';

export const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
export const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
export const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
export const TOKEN_PANEL_CARD = 'rounded-2xl';

export type RuntimeTone = 'neutral' | 'success' | 'warning' | 'danger';

export const TONE_STYLES: Record<RuntimeTone, {
  surface: string;
  subtleText: string;
  badge: 'neutral' | 'success' | 'warning' | 'danger';
}> = {
  neutral: {
    surface: 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]',
    subtleText: 'text-[var(--nimi-text-secondary)]',
    badge: 'neutral',
  },
  success: {
    surface: 'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))]',
    subtleText: 'text-[var(--nimi-status-success)]',
    badge: 'success',
  },
  warning: {
    surface: 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))]',
    subtleText: 'text-[var(--nimi-status-warning)]',
    badge: 'warning',
  },
  danger: {
    surface: 'border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))]',
    subtleText: 'text-[var(--nimi-status-danger)]',
    badge: 'danger',
  },
};

type StatusDotTone = 'success' | 'warning' | 'danger' | 'muted';

export function StatusDot({ tone }: { tone: StatusDotTone; pulse?: boolean }) {
  // pulse motion removed per Nimi design density rule (no decorative pulse/spin
  // on compact operational surfaces); the prop is still accepted for callers.
  const colorMap: Record<StatusDotTone, string> = {
    success: 'bg-[var(--nimi-status-success)]',
    warning: 'bg-[var(--nimi-status-warning)]',
    danger: 'bg-[var(--nimi-status-danger)]',
    muted: 'bg-[var(--nimi-text-muted)]',
  };
  return (
    <span className={cn('inline-flex h-2 w-2 rounded-full', colorMap[tone])} />
  );
}

export function IconButton({
  icon,
  title,
  disabled,
  onClick,
  tone = 'default',
  size = 'sm',
}: {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className={cn(
          'flex items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
          tone === 'danger'
            ? 'hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] hover:text-[var(--nimi-status-danger)]'
            : 'hover:bg-[var(--nimi-surface-panel)]',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function EyeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
