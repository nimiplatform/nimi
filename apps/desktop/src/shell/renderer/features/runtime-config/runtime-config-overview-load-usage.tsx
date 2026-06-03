import { useTranslation } from 'react-i18next';
import { Surface, cn } from '@nimiplatform/kit/ui';
import { formatLocaleDateTime, formatLocaleNumber } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import { useSystemResources } from './runtime-config-system-resources';
import { useUsageEstimate } from './runtime-config-cost-estimator';

type RuntimeTone = 'neutral' | 'success' | 'warning' | 'danger';
type ProgressTone = 'info' | 'action' | 'warning';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';
const METRIC_CARD_CLASS = 'rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3';

const TONE_STYLES: Record<RuntimeTone, {
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

const PROGRESS_STYLES: Record<ProgressTone, { track: string; fill: string }> = {
  info: {
    track: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,var(--nimi-surface-panel))]',
    fill: 'bg-[var(--nimi-status-info)]',
  },
  action: {
    track: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,var(--nimi-surface-panel))]',
    fill: 'bg-[var(--nimi-action-primary-bg)]',
  },
  warning: {
    track: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,var(--nimi-surface-panel))]',
    fill: 'bg-[var(--nimi-status-warning)]',
  },
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  return formatLocaleNumber(Math.round(value));
}

function ResourceStateMessage(props: {
  tone: RuntimeTone;
  title: string;
  body: string;
}) {
  return (
    <div className={cn('rounded-xl border px-3 py-2 text-xs', TONE_STYLES[props.tone].surface)}>
      <p className={cn('font-semibold', TOKEN_TEXT_PRIMARY)}>{props.title}</p>
      <p className={cn('mt-1', TONE_STYLES[props.tone].subtleText)}>{props.body}</p>
    </div>
  );
}

function ResourceLoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={`resource-skeleton-${index}`} className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200/70" />
          <div className="h-2.5 w-full animate-pulse rounded-full bg-slate-200/70" />
        </div>
      ))}
    </div>
  );
}

function formatCost(value: number | null, currency: string): string {
  if (value === null) return 'N/A';
  if (currency === 'none') return '$0.00';
  const prefix = currency === 'USD' ? '$' : currency === 'CNY' ? '\u00a5' : '';
  if (value < 0.01 && value > 0) return `~${prefix}0.01`;
  return `~${prefix}${value.toFixed(2)}`;
}

function ProgressBar({ percent, tone }: { percent: number; tone: ProgressTone }) {
  const style = PROGRESS_STYLES[tone];

  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full', style.track)}>
      <div
        className={cn('h-full transition-all', style.fill)}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

export function OverviewLoadUsageSection() {
  const { t } = useTranslation();
  const sysResources = useSystemResources();
  const usageEstimate = useUsageEstimate();
  const resourceSnapshot = sysResources.snapshot;
  const memoryPercent = resourceSnapshot && resourceSnapshot.memoryTotalBytes > 0
    ? (resourceSnapshot.memoryUsedBytes / resourceSnapshot.memoryTotalBytes) * 100
    : 0;
  const diskPercent = resourceSnapshot && resourceSnapshot.diskTotalBytes > 0
    ? (resourceSnapshot.diskUsedBytes / resourceSnapshot.diskTotalBytes) * 100
    : 0;

  return (
    <section className="mt-8">
      <SectionTitle>
        {t('runtimeConfig.overview.runtimeLoadTitle', { defaultValue: 'Runtime Load & Usage' })}
      </SectionTitle>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
          <div className="mb-4">
            <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{t('runtimeConfig.overview.systemResources', { defaultValue: 'System Resources' })}</p>
          </div>
          {sysResources.status === 'idle' || sysResources.status === 'loading' ? (
            <ResourceLoadingSkeleton />
          ) : resourceSnapshot ? (
            <div className="space-y-3">
              {sysResources.status === 'stale' ? (
                <ResourceStateMessage
                  tone="warning"
                  title={t('runtimeConfig.overview.systemResourcesStale', { defaultValue: 'Showing last successful snapshot' })}
                  body={sysResources.errorMessage || t('runtimeConfig.overview.systemResourcesStaleDescription', { defaultValue: 'A refresh failed, so these values may be outdated.' })}
                />
              ) : null}
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.cpu', { defaultValue: 'CPU' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>{resourceSnapshot.cpuPercent.toFixed(0)}%</span>
                </div>
                <ProgressBar percent={resourceSnapshot.cpuPercent} tone="info" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.memory', { defaultValue: 'Memory' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>
                    {formatBytes(resourceSnapshot.memoryUsedBytes)} / {formatBytes(resourceSnapshot.memoryTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={memoryPercent} tone="action" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.disk', { defaultValue: 'Disk' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>
                    {formatBytes(resourceSnapshot.diskUsedBytes)} / {formatBytes(resourceSnapshot.diskTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={diskPercent} tone="warning" />
              </div>
              {typeof resourceSnapshot.temperatureCelsius === 'number' ? (
                <div className="flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.temperature', { defaultValue: 'Temperature' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>
                    {t('runtimeConfig.overview.temperatureValue', { value: resourceSnapshot.temperatureCelsius.toFixed(0), defaultValue: '{{value}} C' })}
                  </span>
                </div>
              ) : null}
              <p className={cn('pt-1 text-xs', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.overview.systemResourceMeta', {
                  source: resourceSnapshot.source,
                  capturedAt: formatLocaleDateTime(new Date(resourceSnapshot.capturedAtMs).toISOString()),
                  defaultValue: 'Source: {{source}} | Captured: {{capturedAt}}',
                })}
              </p>
            </div>
          ) : (
            <ResourceStateMessage
              tone="warning"
              title={t('runtimeConfig.overview.systemResourcesUnavailable', { defaultValue: 'System resources unavailable' })}
              body={sysResources.errorMessage || t('runtimeConfig.overview.systemResourcesUnavailableDescription', { defaultValue: 'The desktop runtime could not provide a live system snapshot.' })}
            />
          )}
        </Surface>

        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
          <div className="mb-4">
            <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{t('runtimeConfig.overview.usageEstimate', { defaultValue: 'Usage Estimate' })}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={METRIC_CARD_CLASS}>
              <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.requests', { defaultValue: 'Requests' })}</p>
              <p className={cn('text-lg font-semibold', TOKEN_TEXT_PRIMARY)}>{formatCount(usageEstimate.totalRequests)}</p>
            </div>
            <div className={METRIC_CARD_CLASS}>
              <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.compute', { defaultValue: 'Compute' })}</p>
              <p className={cn('text-lg font-semibold', TOKEN_TEXT_PRIMARY)}>
                {t('runtimeConfig.overview.computeValue', {
                  value: formatCount(usageEstimate.totalComputeMs),
                  defaultValue: '{{value}} ms',
                })}
              </p>
            </div>
            <div className={METRIC_CARD_CLASS}>
              <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.inputTokens', { defaultValue: 'Input Tokens' })}</p>
              <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{formatCount(usageEstimate.totalInputTokens)}</p>
            </div>
            <div className={METRIC_CARD_CLASS}>
              <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.outputTokens', { defaultValue: 'Output Tokens' })}</p>
              <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{formatCount(usageEstimate.totalOutputTokens)}</p>
            </div>
            <div
              className={cn(METRIC_CARD_CLASS, 'col-span-2')}
              title={usageEstimate.totalEstimatedCost === null ? t('runtimeConfig.overview.costTooltipUnknown', { defaultValue: 'Some models have unknown pricing' }) : ''}
            >
              <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.estimatedCost', { defaultValue: 'Estimated Cost' })}</p>
              <p className={cn('text-lg font-semibold', TOKEN_TEXT_PRIMARY)}>
                {usageEstimate.pricingLoading ? '...' : formatCost(usageEstimate.totalEstimatedCost, usageEstimate.costCurrency)}
              </p>
            </div>
          </div>
          {usageEstimate.error ? (
            <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{usageEstimate.error}</p>
          ) : null}
        </Surface>
      </div>
    </section>
  );
}
