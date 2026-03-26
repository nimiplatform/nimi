import type { UsageStatRecord } from '@nimiplatform/sdk/runtime';
import { UsageWindow } from '@nimiplatform/sdk/runtime';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { Button, Card } from './runtime-config-primitives.js';
import {
  formatTokenCount,
  formatComputeMs,
  formatNumber,
  usageWindowLabel,
  timestampToIso,
  relativeTimeShort,
} from './runtime-config-global-audit-view-model.js';

// Icon Button Component
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
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] bg-white/90 text-[var(--nimi-text-secondary)] transition-colors hover:bg-white hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// Refresh Icon
function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

type UsageStatsSectionProps = {
  records: UsageStatRecord[];
  loading: boolean;
  error: string | null;
  hasNextPage: boolean;
  filters: {
    capability: string;
    modelId: string;
    window: number;
  };
  summary: {
    totalRequests: number;
    totalSuccess: number;
    totalErrors: number;
    totalInput: number;
    totalOutput: number;
    totalCompute: number;
  };
  onUpdateFilters: (patch: Partial<{ capability: string; modelId: string; window: number }>) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
};

export function UsageStatsSection({
  records,
  loading,
  error,
  hasNextPage,
  filters,
  summary,
  onUpdateFilters,
  onRefresh,
  onLoadMore,
}: UsageStatsSectionProps) {
  const { t } = useTranslation();
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.runtime.usageStatistics', { defaultValue: 'Usage Statistics' })}
        </h3>
        <IconButton
          icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
          title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
          disabled={loading}
          onClick={onRefresh}
        />
      </div>

      {error ? <p className="text-xs text-[var(--nimi-status-danger)]">{error}</p> : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] text-xs">
          {[UsageWindow.MINUTE, UsageWindow.HOUR, UsageWindow.DAY].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onUpdateFilters({ window: w })}
              className={`px-3 py-1.5 font-medium transition-colors ${
                filters.window === w
                  ? 'bg-[var(--nimi-action-primary-bg)] text-white'
                  : 'text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]'
              } ${w === UsageWindow.MINUTE ? 'rounded-l-md' : ''} ${w === UsageWindow.DAY ? 'rounded-r-md' : ''}`}
            >
              {usageWindowLabel(w)}
            </button>
          ))}
        </div>
        <input
          value={filters.capability}
          onChange={(e) => onUpdateFilters({ capability: e.target.value })}
          placeholder={t('runtimeConfig.runtime.capabilityPlaceholder', { defaultValue: 'Capability...' })}
          className="h-8 rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-2 text-xs text-[var(--nimi-text-primary)] outline-none transition-all focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100"
        />
        <input
          value={filters.modelId}
          onChange={(e) => onUpdateFilters({ modelId: e.target.value })}
          placeholder={t('runtimeConfig.runtime.modelIdPlaceholder', { defaultValue: 'Model ID...' })}
          className="h-8 rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-2 text-xs text-[var(--nimi-text-primary)] outline-none transition-all focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100"
        />
      </div>

      {/* Summary row */}
      {records.length > 0 ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--nimi-border-subtle)] bg-white/70 px-3 py-2 text-xs">
          <span className="text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.runtime.total', { defaultValue: 'Total' })}: <strong>{formatNumber(String(summary.totalRequests))}</strong>{' '}
            {t('runtimeConfig.runtime.requests', { defaultValue: 'Requests' }).toLowerCase()}
          </span>
          <span className="text-[var(--nimi-status-success)]">
            {t('runtimeConfig.runtime.success', { defaultValue: 'Success' })}: <strong>{formatNumber(String(summary.totalSuccess))}</strong>
          </span>
          <span className="text-[var(--nimi-status-danger)]">
            {t('runtimeConfig.runtime.errors', { defaultValue: 'Errors' })}: <strong>{formatNumber(String(summary.totalErrors))}</strong>
          </span>
          <span className="text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.runtime.input', { defaultValue: 'Input' })}: <strong>{formatTokenCount(String(summary.totalInput))}</strong>{' '}
            {t('runtimeConfig.runtime.tokens', { defaultValue: 'tokens' })}
          </span>
          <span className="text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.runtime.output', { defaultValue: 'Output' })}: <strong>{formatTokenCount(String(summary.totalOutput))}</strong>{' '}
            {t('runtimeConfig.runtime.tokens', { defaultValue: 'tokens' })}
          </span>
          <span className="text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.runtime.compute', { defaultValue: 'Compute' })}: <strong>{formatComputeMs(String(summary.totalCompute))}</strong>
          </span>
        </div>
      ) : null}

      {/* Records table */}
      <div className="overflow-x-auto max-h-[calc(100vh-36rem)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] text-left text-[11px] text-[var(--nimi-text-muted)]">
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.capability', { defaultValue: 'Capability' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.model', { defaultValue: 'Model' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.requests', { defaultValue: 'Requests' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.success', { defaultValue: 'Success' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.errors', { defaultValue: 'Errors' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.inputTokens', { defaultValue: 'Input Tokens' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.outputTokens', { defaultValue: 'Output Tokens' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.compute', { defaultValue: 'Compute' })}</th>
              <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.queueWait', { defaultValue: 'Queue Wait' })}</th>
              <th className="pb-1.5 font-medium">{t('runtimeConfig.runtime.bucket', { defaultValue: 'Bucket' })}</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-[var(--nimi-text-muted)]">
                  {loading
                    ? t('runtimeConfig.runtime.loadingUsageStats', { defaultValue: 'Loading usage stats...' })
                    : t('runtimeConfig.runtime.noUsageData', { defaultValue: 'No usage data available.' })}
                </td>
              </tr>
            ) : (
              records.map((r, idx) => {
                const bucketTs = timestampToIso(r.bucketStart);
                return (
                  <tr key={`${r.capability}-${r.modelId}-${idx}`} className="border-b border-[var(--nimi-border-subtle)]/70">
                    <td className="py-1.5 pr-3 text-[var(--nimi-text-primary)]">{r.capability || '-'}</td>
                    <td className="py-1.5 pr-3 font-mono text-[var(--nimi-text-secondary)]">{r.modelId || '-'}</td>
                    <td className="py-1.5 pr-3 text-[var(--nimi-text-primary)]">{formatNumber(r.requestCount)}</td>
                    <td className="py-1.5 pr-3 text-[var(--nimi-status-success)]">{formatNumber(r.successCount)}</td>
                    <td className="py-1.5 pr-3 text-[var(--nimi-status-danger)]">{formatNumber(r.errorCount)}</td>
                    <td className="py-1.5 pr-3 text-[var(--nimi-text-secondary)]">{formatTokenCount(r.inputTokens)}</td>
                    <td className="py-1.5 pr-3 text-[var(--nimi-text-secondary)]">{formatTokenCount(r.outputTokens)}</td>
                    <td className="py-1.5 pr-3 text-[var(--nimi-text-secondary)]">{formatComputeMs(r.computeMs)}</td>
                    <td className="py-1.5 pr-3 text-[var(--nimi-text-secondary)]">{formatComputeMs(r.queueWaitMs)}</td>
                    <td className="py-1.5 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
                      <Tooltip content={bucketTs} placement="top">
                        <span>{bucketTs !== '-' ? relativeTimeShort(bucketTs) : '-'}</span>
                      </Tooltip>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load More */}
      {hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading
              ? t('runtimeConfig.runtime.loading', { defaultValue: 'Loading...' })
              : t('runtimeConfig.runtime.loadMore', { defaultValue: 'Load More' })}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
