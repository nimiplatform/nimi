import { useTranslation } from 'react-i18next';
import type {
  GetRuntimeHealthResponse,
  AIProviderHealthSnapshot,
} from '@nimiplatform/sdk/runtime';
import { Surface, Tooltip, cn } from '@nimiplatform/kit/ui';
import {
  runtimeHealthStatusLabel,
  formatBytes,
  formatCpuMilli,
  timestampToIso,
  relativeTimeShort,
} from './runtime-config-global-audit-view-model.js';
import { ProviderHealthTable } from './runtime-config-provider-health-table.js';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';

type VitalTone = 'info' | 'success' | 'warning' | 'neutral';

const VITAL_FILL_CLASS: Record<VitalTone, string> = {
  info: 'bg-[var(--nimi-status-info)]',
  success: 'bg-[var(--nimi-status-success)]',
  warning: 'bg-[var(--nimi-status-warning)]',
  neutral: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]',
};

type StateTone = 'success' | 'warning' | 'danger' | 'neutral';

const STATE_BADGE_CLASS: Record<StateTone, { pill: string; dot: string; text: string }> = {
  success: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
    dot: 'bg-[var(--nimi-status-success)]',
    text: 'text-[var(--nimi-status-success)]',
  },
  warning: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
    dot: 'bg-[var(--nimi-status-warning)]',
    text: 'text-[var(--nimi-status-warning)]',
  },
  danger: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
    dot: 'bg-[var(--nimi-status-danger)]',
    text: 'text-[var(--nimi-status-danger)]',
  },
  neutral: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]',
    dot: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_65%,transparent)]',
    text: 'text-[var(--nimi-text-secondary)]',
  },
};

const CPU_MAX_MILLI = 1000; // 1 full core = 100% fill
const RAM_MAX_BYTES = 16 * 1024 ** 3; // 16 GB proxy
const VRAM_MAX_BYTES = 24 * 1024 ** 3; // 24 GB proxy
const QUEUE_MAX = 10;

function IconButton({
  icon,
  title,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
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
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
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

function VitalCard({
  label,
  value,
  percent,
  tone,
}: {
  label: string;
  value: string;
  percent: number;
  tone: VitalTone;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-3">
      <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>{label}</p>
      <p className={cn('mt-1 font-mono text-sm', TOKEN_TEXT_PRIMARY)}>{value}</p>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)]">
        <div
          className={cn('h-full transition-all duration-300 ease-out', VITAL_FILL_CLASS[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function LiveBadge({ connected, stale, hasHealth }: { connected: boolean; stale: boolean; hasHealth: boolean }) {
  const tone: StateTone = connected && !stale ? 'success' : hasHealth ? 'warning' : 'neutral';
  const style = STATE_BADGE_CLASS[tone];
  const label = connected && !stale ? 'Live' : hasHealth ? 'Connecting' : 'Off';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', style.pill)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {label}
    </span>
  );
}

type RuntimeHealthSectionProps = {
  runtimeHealth: GetRuntimeHealthResponse | null;
  providerHealth: AIProviderHealthSnapshot[];
  loading: boolean;
  error: string | null;
  streamConnected: boolean;
  streamError: string | null;
  stale: boolean;
  onRefresh: () => void;
};

export function RuntimeHealthSection({
  runtimeHealth,
  providerHealth,
  loading,
  error,
  streamConnected,
  streamError,
  stale,
  onRefresh,
}: RuntimeHealthSectionProps) {
  const { t } = useTranslation();
  const health = runtimeHealth;

  const cpuPercent = health ? (Number(health.cpuMilli) / CPU_MAX_MILLI) * 100 : 0;
  const ramPercent = health ? (Number(health.memoryBytes) / RAM_MAX_BYTES) * 100 : 0;
  const vramPercent = health ? (Number(health.vramBytes) / VRAM_MAX_BYTES) * 100 : 0;
  const queuePercent = health ? (Number(health.queueDepth) / QUEUE_MAX) * 100 : 0;

  return (
    <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
            {t('runtimeConfig.runtime.runtimeHealth', { defaultValue: 'Runtime Health' })}
          </h3>
          {health ? (
            <span className={cn('text-[11px]', TOKEN_TEXT_MUTED)}>
              {runtimeHealthStatusLabel(health.status)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge connected={streamConnected} stale={stale} hasHealth={Boolean(health)} />
          <IconButton
            icon={<RefreshIcon spinning={loading} />}
            title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            disabled={loading}
            onClick={onRefresh}
          />
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{error}</p>
      ) : null}

      {streamError ? (
        <p className={cn('mt-2 text-xs', STATE_BADGE_CLASS.warning.pill.replace('bg-', 'text-'))}>
          {t('runtimeConfig.runtime.streamError', { defaultValue: 'Stream error' })}: {streamError}
        </p>
      ) : null}

      {/* System Vitals - 4 micro cards */}
      {health ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <VitalCard
            label={t('runtimeConfig.runtime.cpu', { defaultValue: 'CPU' })}
            value={formatCpuMilli(health.cpuMilli)}
            percent={cpuPercent}
            tone="info"
          />
          <VitalCard
            label={t('runtimeConfig.runtime.ram', { defaultValue: 'RAM' })}
            value={formatBytes(health.memoryBytes)}
            percent={ramPercent}
            tone="success"
          />
          <VitalCard
            label={t('runtimeConfig.runtime.vram', { defaultValue: 'VRAM' })}
            value={formatBytes(health.vramBytes)}
            percent={vramPercent}
            tone="warning"
          />
          <VitalCard
            label={t('runtimeConfig.runtime.queue', { defaultValue: 'Queue' })}
            value={String(health.queueDepth)}
            percent={queuePercent}
            tone="neutral"
          />
        </div>
      ) : !loading ? (
        <p className={cn('mt-3 text-xs', TOKEN_TEXT_MUTED)}>
          {t('runtimeConfig.runtime.noHealthData', { defaultValue: 'No health data available.' })}
        </p>
      ) : null}

      {/* Sub-metrics row */}
      {health ? (
        <div className={cn('mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]', TOKEN_TEXT_MUTED)}>
          <span>
            {t('runtimeConfig.runtime.workflows', { defaultValue: 'Workflows' })}
            {': '}
            <span className={cn('font-mono', TOKEN_TEXT_PRIMARY)}>{health.activeWorkflows}</span>
          </span>
          <span>
            {t('runtimeConfig.runtime.jobs', { defaultValue: 'Jobs' })}
            {': '}
            <span className={cn('font-mono', TOKEN_TEXT_PRIMARY)}>{health.activeInferenceJobs}</span>
          </span>
          {health.sampledAt ? (
            <span>
              {t('runtimeConfig.runtime.sampled', { defaultValue: 'Sampled' })}
              {' '}
              {relativeTimeShort(timestampToIso(health.sampledAt))}
            </span>
          ) : null}
          {health.reason ? (
            <span className="truncate" title={health.reason}>
              {health.reason}
            </span>
          ) : null}
        </div>
      ) : null}

      <ProviderHealthTable providerHealth={providerHealth} />
    </Surface>
  );
}
