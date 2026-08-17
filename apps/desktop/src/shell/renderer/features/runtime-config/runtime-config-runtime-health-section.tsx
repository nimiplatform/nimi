import { useTranslation } from 'react-i18next';
import type { GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { ProgressIndicator, StatusBadge as KitStatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import {
  runtimeHealthStatusLabel,
  formatBytes,
  formatCpuMilli,
  timestampToIso,
  relativeTimeShort,
} from './runtime-config-global-audit-view-model.js';
import { IconButton, RefreshIcon, TOKEN_PANEL_CARD, TOKEN_TEXT_MUTED, TOKEN_TEXT_PRIMARY } from './runtime-config-runtime-page-ui.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';

type VitalTone = 'info' | 'success' | 'warning' | 'neutral';

// Fill color override for the kit ProgressIndicator bar, keyed by vital tone.
const VITAL_FILL_CLASS: Record<VitalTone, string> = {
  info: '[&_.nimi-progress__bar]:bg-[var(--nimi-status-info)]',
  success: '[&_.nimi-progress__bar]:bg-[var(--nimi-status-success)]',
  warning: '[&_.nimi-progress__bar]:bg-[var(--nimi-status-warning)]',
  neutral: '[&_.nimi-progress__bar]:bg-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]',
};

const CPU_MAX_MILLI = 1000; // 1 full core = 100% fill
const RAM_MAX_BYTES = 16 * 1024 ** 3; // 16 GB proxy
const VRAM_MAX_BYTES = 24 * 1024 ** 3; // 24 GB proxy
const QUEUE_MAX = 10;

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
      <p className={cn('text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>{label}</p>
      <p className={cn('mt-1 font-mono text-sm', TOKEN_TEXT_PRIMARY)}>{value}</p>
      <ProgressIndicator value={clamped} className={cn('mt-2', VITAL_FILL_CLASS[tone])} />
    </div>
  );
}

function LiveBadge({ connected, stale, hasHealth }: { connected: boolean; stale: boolean; hasHealth: boolean }) {
  const tone = connected && !stale ? 'success' : hasHealth ? 'warning' : 'neutral';
  const label = connected && !stale ? 'Live' : hasHealth ? 'Connecting' : 'Off';
  return <KitStatusBadge tone={tone} shape="dot">{label}</KitStatusBadge>;
}

type RuntimeHealthSectionProps = {
  runtimeHealth: GetRuntimeHealthResponse | null;
  loading: boolean;
  error: string | null;
  streamConnected: boolean;
  streamError: string | null;
  stale: boolean;
  onRefresh: () => void;
};

export function RuntimeHealthSection({
  runtimeHealth,
  loading,
  error,
  streamConnected,
  streamError,
  stale,
  onRefresh,
}: RuntimeHealthSectionProps) {
  const i18n = useDesktopI18nResource();
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
            <span className={cn('text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>
              {runtimeHealthStatusLabel(health.status)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge connected={streamConnected} stale={stale} hasHealth={Boolean(health)} />
          <IconButton
            icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
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
        <p className="mt-2 text-xs text-[var(--nimi-status-warning)]">
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
        <div className={cn('mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>
          <span>
            {t('runtimeConfig.runtime.jobs', { defaultValue: 'Jobs' })}
            {': '}
            <span className={cn('font-mono', TOKEN_TEXT_PRIMARY)}>{health.activeInferenceJobs}</span>
          </span>
          {health.sampledAt ? (
            <span>
              {t('runtimeConfig.runtime.sampled', { defaultValue: 'Sampled' })}
              {' '}
              {relativeTimeShort(timestampToIso(health.sampledAt), i18n.formatRelativeTime)}
            </span>
          ) : null}
          {health.reason ? (
            <span className="truncate" title={health.reason}>
              {health.reason}
            </span>
          ) : null}
        </div>
      ) : null}
    </Surface>
  );
}
