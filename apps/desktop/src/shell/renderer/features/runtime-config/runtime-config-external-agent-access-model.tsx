import type { ReactNode } from 'react';
import { Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import type { ExternalAgentTokenRecord } from '@runtime/external-agent';

export type TokenMode = 'delegated' | 'autonomous';
export type TokenFilter = 'all' | 'active' | 'revoked';
export type TokenStatus = 'active' | 'expired' | 'revoked';

export const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
export const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
export const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
export const TOKEN_PANEL_CARD = 'rounded-2xl';

export type StateTone = 'success' | 'warning' | 'danger' | 'neutral';

export const STATUS_TONE: Record<TokenStatus, StateTone> = {
  active: 'success',
  expired: 'warning',
  revoked: 'neutral',
};

export function StatusDot({ tone, pulse }: { tone: 'success' | 'warning' | 'danger' | 'muted'; pulse?: boolean }) {
  const colorMap = {
    success: 'bg-[var(--nimi-status-success)]',
    warning: 'bg-[var(--nimi-status-warning)]',
    danger: 'bg-[var(--nimi-status-danger)]',
    muted: 'bg-[var(--nimi-text-muted)]',
  } as const;
  return (
    <span className="relative inline-flex h-2 w-2 items-center justify-center">
      {pulse ? (
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', colorMap[tone])} aria-hidden />
      ) : null}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', colorMap[tone])} />
    </span>
  );
}

export function IconButton({
  icon,
  title,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'animate-spin' : ''}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
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

export function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('transition-transform duration-200', expanded ? 'rotate-180' : 'rotate-0')}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function ServiceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <line x1="6" y1="7" x2="6.01" y2="7" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
    </svg>
  );
}

export function relativeFromNow(iso: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!iso) return '—';
  const targetMs = new Date(iso).getTime();
  if (!Number.isFinite(targetMs)) return '—';
  const diffMs = targetMs - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let value: number;
  let unit: 's' | 'm' | 'h' | 'd';
  if (abs < minute) {
    value = Math.max(1, Math.round(abs / 1000));
    unit = 's';
  } else if (abs < hour) {
    value = Math.max(1, Math.round(abs / minute));
    unit = 'm';
  } else if (abs < day) {
    value = Math.max(1, Math.round(abs / hour));
    unit = 'h';
  } else {
    value = Math.max(1, Math.round(abs / day));
    unit = 'd';
  }
  const unitLabel = {
    s: t('runtimeConfig.eaa.unitSecond', { defaultValue: 's' }),
    m: t('runtimeConfig.eaa.unitMinute', { defaultValue: 'm' }),
    h: t('runtimeConfig.eaa.unitHour', { defaultValue: 'h' }),
    d: t('runtimeConfig.eaa.unitDay', { defaultValue: 'd' }),
  }[unit];
  return past
    ? t('runtimeConfig.eaa.agoPattern', { defaultValue: '{{value}}{{unit}} ago', value, unit: unitLabel })
    : t('runtimeConfig.eaa.inPattern', { defaultValue: 'in {{value}}{{unit}}', value, unit: unitLabel });
}

export function resolveTokenStatus(token: ExternalAgentTokenRecord): TokenStatus {
  if (token.revokedAt) return 'revoked';
  const expiresMs = new Date(token.expiresAt).getTime();
  if (Number.isFinite(expiresMs) && expiresMs < Date.now()) return 'expired';
  return 'active';
}

export type GatewayStatusParsed = {
  enabled: boolean;
  loading: boolean;
  bindAddress: string;
  issuer: string;
  actionCount: number | null;
  errored: boolean;
};
