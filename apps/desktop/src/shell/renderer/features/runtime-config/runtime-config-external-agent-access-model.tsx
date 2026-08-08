import { cn } from '@nimiplatform/kit/ui';
import type { NimiExternalAgentTokenLedgerRecord } from '@nimiplatform/sdk/runtime';

export type TokenMode = 'delegated' | 'autonomous';
export type TokenFilter = 'all' | 'active' | 'revoked';
export type TokenStatus = 'active' | 'expired' | 'revoked';

export interface ExternalAgentTokenActionPlaneState {
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly loading: boolean;
  readonly actionCount: number | null | undefined;
}

export function isExternalAgentTokenActionPlaneAvailable(state: ExternalAgentTokenActionPlaneState): boolean {
  return !state.busy
    && state.enabled
    && !state.loading
    && (state.actionCount ?? 0) > 0;
}

// Shared composition-layer re-exports: token constants, status dot, icon
// button, and the icon set all delegate to runtime-config-runtime-page-ui so
// this module keeps a single source of truth for visuals.
export {
  CheckIcon,
  ClockIcon,
  CopyIcon,
  IconButton,
  PlusIcon,
  RefreshIcon,
  StatusDot,
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
} from './runtime-config-runtime-page-ui';

export type StateTone = 'success' | 'warning' | 'danger' | 'neutral';

export const STATUS_TONE: Record<TokenStatus, StateTone> = {
  active: 'success',
  expired: 'warning',
  revoked: 'neutral',
};

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

export function relativeFromNow(
  iso: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  nowMs: number,
): string {
  if (!iso) return '—';
  const targetMs = new Date(iso).getTime();
  if (!Number.isFinite(targetMs)) return '—';
  const diffMs = targetMs - nowMs;
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

export function resolveTokenStatus(
  token: NimiExternalAgentTokenLedgerRecord,
  nowMs: number,
): TokenStatus {
  if (token.revokedAt) return 'revoked';
  const expiresMs = new Date(token.expiresAt).getTime();
  if (Number.isFinite(expiresMs) && expiresMs < nowMs) return 'expired';
  return 'active';
}

export type GatewayStatusParsed = {
  enabled: boolean;
  loading: boolean;
  bindAddress: string;
  issuer: string;
  actionCount: number | null;
  status?: string;
  reasonCode?: string;
  errored: boolean;
};
