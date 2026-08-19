import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Surface, cn } from '@nimiplatform/kit/ui';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { SectionTitle } from './runtime-config-primitives';
import {
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TONE_STYLES,
  type RuntimeTone,
} from './runtime-config-runtime-page-ui';
import { useSystemResources } from './runtime-config-system-resources';
import { useUsageEstimate } from './runtime-config-cost-estimator';
import {
  ActivityIcon,
  ArrowDownUpIcon,
  CoinsIcon,
  CpuIcon,
  HardDriveIcon,
  MemoryStickIcon,
  ThermometerIcon,
  TimerIcon,
} from './runtime-config-overview-icons';
import { GaugeRing, useCountUp } from './runtime-config-overview-motion';
import { useDesktopReducedMotion } from '../../ui/motion/desktop-motion';

const METRIC_CARD_CLASS = 'rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatCount(value: number, i18n: DesktopI18nResource): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  return i18n.formatNumber(Math.round(value));
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
    <div className="flex flex-wrap items-start justify-between gap-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={`resource-skeleton-${index}`} className="flex flex-col items-center gap-2">
          <div className="h-24 w-24 animate-pulse rounded-full bg-[var(--nimi-surface-panel)]" />
          <div className="h-3 w-14 animate-pulse rounded bg-[var(--nimi-surface-panel)]" />
        </div>
      ))}
    </div>
  );
}

function formatCost(value: number | null, currency: string): string {
  if (value === null) return 'N/A';
  if (currency === 'none') return '$0.00';
  const prefix = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
  if (value < 0.01 && value > 0) return `~${prefix}0.01`;
  return `~${prefix}${value.toFixed(2)}`;
}

function CountUpText({ value, format }: { value: number; format: (n: number) => string }) {
  const counted = useCountUp(value);
  return <>{format(counted)}</>;
}

function UsageMetric({
  icon,
  label,
  numericValue,
  displayValue,
  format,
  emphasize = false,
  className = '',
  title,
}: {
  icon: ReactNode;
  label: string;
  numericValue?: number;
  displayValue?: string;
  format?: (n: number) => string;
  emphasize?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn(METRIC_CARD_CLASS, className)} title={title}>
      <p className={cn('flex items-center gap-1.5 text-xs', TOKEN_TEXT_MUTED)}>
        {icon}
        {label}
      </p>
      <p className={cn(
        'mt-1 font-semibold tabular-nums break-words [overflow-wrap:anywhere]',
        emphasize ? 'text-lg' : 'text-base',
        TOKEN_TEXT_PRIMARY,
      )}>
        {typeof numericValue === 'number' && format
          ? <CountUpText value={numericValue} format={format} />
          : displayValue}
      </p>
    </div>
  );
}

function TokenSplitBar({ inputTokens, outputTokens, inputLabel, outputLabel }: {
  inputTokens: number;
  outputTokens: number;
  inputLabel: string;
  outputLabel: string;
}) {
  const reduced = useDesktopReducedMotion();
  const total = inputTokens + outputTokens;
  if (!Number.isFinite(total) || total <= 0) return null;
  const inputPercent = Math.max(0, Math.min(100, (inputTokens / total) * 100));
  const outputPercent = 100 - inputPercent;
  const transition = { duration: reduced ? 0 : 0.6, ease: [0.05, 0.7, 0.1, 1] as const };
  return (
    <div className="col-span-2 pt-1">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--nimi-surface-panel)]">
        <motion.div
          className="h-full bg-[var(--nimi-status-info)]"
          initial={reduced ? false : { width: 0 }}
          animate={{ width: `${inputPercent}%` }}
          transition={transition}
        />
        <motion.div
          className="h-full bg-[var(--nimi-action-primary-bg)]"
          initial={reduced ? false : { width: 0 }}
          animate={{ width: `${outputPercent}%` }}
          transition={transition}
        />
      </div>
      <div className={cn('mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-info)]" />
          {inputLabel} {inputPercent.toFixed(0)}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--nimi-action-primary-bg)]" />
          {outputLabel} {outputPercent.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

export function OverviewLoadUsageSection() {
  const i18n = useDesktopI18nResource();
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

  const inputTokensLabel = t('runtimeConfig.overview.inputTokens', { defaultValue: 'Input Tokens' });
  const outputTokensLabel = t('runtimeConfig.overview.outputTokens', { defaultValue: 'Output Tokens' });

  return (
    <section>
      <SectionTitle>
        {t('runtimeConfig.overview.runtimeLoadTitle', { defaultValue: 'Runtime Load & Usage' })}
      </SectionTitle>
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'flex flex-col p-4')}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{t('runtimeConfig.overview.systemResources', { defaultValue: 'System Resources' })}</p>
            {typeof resourceSnapshot?.temperatureCelsius === 'number' ? (
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                <ThermometerIcon />
                {t('runtimeConfig.overview.temperatureValue', { value: resourceSnapshot.temperatureCelsius.toFixed(0), defaultValue: '{{value}} C' })}
              </span>
            ) : null}
          </div>
          {sysResources.status === 'idle' || sysResources.status === 'loading' ? (
            <ResourceLoadingSkeleton />
          ) : resourceSnapshot ? (
            <div className="flex flex-1 flex-col">
              {sysResources.status === 'stale' ? (
                <div className="mb-3">
                  <ResourceStateMessage
                    tone="warning"
                    title={t('runtimeConfig.overview.systemResourcesStale', { defaultValue: 'Showing last successful snapshot' })}
                    body={sysResources.errorMessage || t('runtimeConfig.overview.systemResourcesStaleDescription', { defaultValue: 'A refresh failed, so these values may be outdated.' })}
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <GaugeRing
                  percent={resourceSnapshot.cpuPercent}
                  tone="info"
                  icon={<CpuIcon />}
                  label={t('runtimeConfig.overview.cpu', { defaultValue: 'CPU' })}
                />
                <GaugeRing
                  percent={memoryPercent}
                  tone="action"
                  icon={<MemoryStickIcon />}
                  label={t('runtimeConfig.overview.memory', { defaultValue: 'Memory' })}
                  detail={`${formatBytes(resourceSnapshot.memoryUsedBytes)} / ${formatBytes(resourceSnapshot.memoryTotalBytes)}`}
                />
                <GaugeRing
                  percent={diskPercent}
                  tone="warning"
                  icon={<HardDriveIcon />}
                  label={t('runtimeConfig.overview.disk', { defaultValue: 'Disk' })}
                  detail={`${formatBytes(resourceSnapshot.diskUsedBytes)} / ${formatBytes(resourceSnapshot.diskTotalBytes)}`}
                />
              </div>
              <p className={cn('mt-auto border-t border-[var(--nimi-border-subtle)] pt-2 text-xs', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.overview.systemResourceUpdatedAt', {
                  capturedAt: i18n.formatDate(new Date(resourceSnapshot.capturedAtMs).toISOString(), {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                  defaultValue: 'Updated {{capturedAt}}',
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

        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'flex flex-col p-4')}>
          <div className="mb-3">
            <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{t('runtimeConfig.overview.usageEstimate', { defaultValue: 'Usage Estimate' })}</p>
          </div>
          <div className="grid flex-1 grid-cols-2 content-start gap-2">
            <UsageMetric
              icon={<ActivityIcon />}
              label={t('runtimeConfig.overview.requests', { defaultValue: 'Requests' })}
              numericValue={usageEstimate.totalRequests}
              format={(n) => formatCount(n, i18n)}
              emphasize
            />
            <UsageMetric
              icon={<TimerIcon />}
              label={t('runtimeConfig.overview.compute', { defaultValue: 'Compute' })}
              numericValue={usageEstimate.totalComputeMs}
              format={(n) => t('runtimeConfig.overview.computeValue', {
                value: formatCount(n, i18n),
                defaultValue: '{{value}} ms',
              })}
              emphasize
            />
            <UsageMetric
              icon={<ArrowDownUpIcon />}
              label={inputTokensLabel}
              numericValue={usageEstimate.totalInputTokens}
              format={(n) => formatCount(n, i18n)}
            />
            <UsageMetric
              icon={<ArrowDownUpIcon />}
              label={outputTokensLabel}
              numericValue={usageEstimate.totalOutputTokens}
              format={(n) => formatCount(n, i18n)}
            />
            <TokenSplitBar
              inputTokens={usageEstimate.totalInputTokens}
              outputTokens={usageEstimate.totalOutputTokens}
              inputLabel={inputTokensLabel}
              outputLabel={outputTokensLabel}
            />
            <UsageMetric
              icon={<CoinsIcon />}
              label={t('runtimeConfig.overview.estimatedCost', { defaultValue: 'Estimated Cost' })}
              displayValue={usageEstimate.pricingLoading ? '...' : formatCost(usageEstimate.totalEstimatedCost, usageEstimate.costCurrency)}
              emphasize
              className="col-span-2"
              title={usageEstimate.totalEstimatedCost === null ? t('runtimeConfig.overview.costTooltipUnknown', { defaultValue: 'Some models have unknown pricing' }) : ''}
            />
          </div>
          {usageEstimate.error ? (
            <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{usageEstimate.error}</p>
          ) : null}
        </Surface>
      </div>
    </section>
  );
}
