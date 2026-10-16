import { useTranslation } from 'react-i18next';
import type { GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { StatusBadge as KitStatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import {
  runtimeHealthStatusLabel,
  formatBytes,
  formatCpuMilli,
  timestampToIso,
  relativeTimeShort,
} from './runtime-config-global-audit-view-model.js';
import { IconButton, RefreshIcon, TOKEN_PANEL_CARD, TOKEN_TEXT_MUTED, TOKEN_TEXT_PRIMARY } from './runtime-config-runtime-page-ui.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';

function VitalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-3">
      <p className={cn('text-[length:var(--nimi-type-caption-size)] font-medium', TOKEN_TEXT_MUTED)}>{label}</p>
      <p className={cn('mt-1 font-mono text-sm', TOKEN_TEXT_PRIMARY)}>{value}</p>
    </div>
  );
}

function LiveBadge({ connected, stale, hasHealth }: { connected: boolean; stale: boolean; hasHealth: boolean }) {
  const tone = connected && !stale ? 'success' : hasHealth ? 'warning' : 'neutral';
  const { t } = useTranslation();
  const label = t(connected && !stale ? 'runtimeConfig.runtime.healthLive' : hasHealth ? 'runtimeConfig.runtime.healthConnecting' : 'runtimeConfig.runtime.healthNoData');
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

      <p className={cn('mt-3 text-xs leading-relaxed', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.runtime.healthCountersHint')}</p>
      {/* Runtime counters have no device-capacity denominator. */}
      {health ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <VitalCard
            label={t('runtimeConfig.runtime.reportedCpu')}
            value={formatCpuMilli(health.cpuMilli)}
          />
          <VitalCard
            label={t('runtimeConfig.runtime.reportedRam')}
            value={formatBytes(health.memoryBytes)}
          />
          <VitalCard
            label={t('runtimeConfig.runtime.reportedVram')}
            value={formatBytes(health.vramBytes)}
          />
          <VitalCard
            label={t('runtimeConfig.runtime.queue', { defaultValue: 'Queue' })}
            value={String(health.queueDepth)}
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
