import type { UsageStatRecord } from '@nimiplatform/sdk/runtime';
import { UsageWindow } from '@nimiplatform/sdk/runtime';
import { useTranslation } from 'react-i18next';
import { Surface, Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { Button } from './runtime-config-primitives.js';
import {
  formatTokenCount,
  formatComputeMs,
  formatNumber,
  usageWindowLabel,
  timestampToIso,
  relativeTimeShort,
} from './runtime-config-global-audit-view-model.js';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';

const FILTER_INPUT_CLASS =
  'h-8 rounded-lg border border-[var(--nimi-border-subtle)] bg-transparent px-2.5 text-xs text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]';

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

function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const toneText = {
    neutral: TOKEN_TEXT_PRIMARY,
    success: 'text-[var(--nimi-status-success)]',
    warning: 'text-[var(--nimi-status-warning)]',
    danger: 'text-[var(--nimi-status-danger)]',
    info: 'text-[var(--nimi-status-info)]',
  }[tone];
  return (
    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-3">
      <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>{label}</p>
      <p className={cn('mt-1 font-mono text-base font-semibold', toneText)}>{value}</p>
      {sub ? <p className={cn('mt-0.5 text-[11px]', TOKEN_TEXT_MUTED)}>{sub}</p> : null}
    </div>
  );
}

function computeSuccessRate(success: number, total: number): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (!total || total <= 0) return { label: '—', tone: 'neutral' };
  const pct = (success / total) * 100;
  const rounded = pct >= 99.5 ? '100%' : pct < 1 && pct > 0 ? '<1%' : `${pct.toFixed(1)}%`;
  const tone: 'success' | 'warning' | 'danger' = pct >= 98 ? 'success' : pct >= 90 ? 'warning' : 'danger';
  return { label: rounded, tone };
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

  const successRate = computeSuccessRate(summary.totalSuccess, summary.totalRequests);
  const totalTokens = summary.totalInput + summary.totalOutput;
  const avgComputeMs = summary.totalRequests > 0
    ? Math.round(summary.totalCompute / summary.totalRequests)
    : 0;

  return (
    <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
          {t('runtimeConfig.runtime.usageStatistics', { defaultValue: 'Usage Statistics' })}
        </h3>
        <IconButton
          icon={<RefreshIcon spinning={loading} />}
          title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
          disabled={loading}
          onClick={onRefresh}
        />
      </div>

      {error ? <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{error}</p> : null}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Segmented window switcher */}
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-0.5">
          {[UsageWindow.MINUTE, UsageWindow.HOUR, UsageWindow.DAY].map((w) => {
            const active = filters.window === w;
            return (
              <button
                key={w}
                type="button"
                onClick={() => onUpdateFilters({ window: w })}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? cn('bg-[var(--nimi-surface-card)] shadow-sm', TOKEN_TEXT_PRIMARY)
                    : cn('hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_SECONDARY),
                )}
              >
                {usageWindowLabel(w)}
              </button>
            );
          })}
        </div>
        <input
          value={filters.capability}
          onChange={(e) => onUpdateFilters({ capability: e.target.value })}
          placeholder={t('runtimeConfig.runtime.capabilityPlaceholder', { defaultValue: 'Capability…' })}
          className={cn(FILTER_INPUT_CLASS, 'w-36')}
        />
        <input
          value={filters.modelId}
          onChange={(e) => onUpdateFilters({ modelId: e.target.value })}
          placeholder={t('runtimeConfig.runtime.modelIdPlaceholder', { defaultValue: 'Model ID…' })}
          className={cn(FILTER_INPUT_CLASS, 'w-48')}
        />
      </div>

      {/* Summary stat cards */}
      {records.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t('runtimeConfig.runtime.requests', { defaultValue: 'Requests' })}
            value={formatNumber(String(summary.totalRequests))}
            sub={t('runtimeConfig.runtime.requestsBreakdown', {
              success: formatNumber(String(summary.totalSuccess)),
              errors: formatNumber(String(summary.totalErrors)),
              defaultValue: '{{success}} ok · {{errors}} err',
            })}
            tone="info"
          />
          <StatCard
            label={t('runtimeConfig.runtime.successRate', { defaultValue: 'Success Rate' })}
            value={successRate.label}
            sub={summary.totalErrors > 0
              ? t('runtimeConfig.runtime.errorsCount', {
                count: summary.totalErrors,
                defaultValue: '{{count}} errors',
              })
              : t('runtimeConfig.runtime.noErrors', { defaultValue: 'no errors' })}
            tone={successRate.tone === 'neutral' ? 'neutral' : successRate.tone}
          />
          <StatCard
            label={t('runtimeConfig.runtime.tokens', { defaultValue: 'Tokens' })}
            value={formatTokenCount(String(totalTokens))}
            sub={t('runtimeConfig.runtime.tokensBreakdown', {
              input: formatTokenCount(String(summary.totalInput)),
              output: formatTokenCount(String(summary.totalOutput)),
              defaultValue: '{{input}} in · {{output}} out',
            })}
            tone="neutral"
          />
          <StatCard
            label={t('runtimeConfig.runtime.compute', { defaultValue: 'Compute' })}
            value={formatComputeMs(String(summary.totalCompute))}
            sub={avgComputeMs > 0
              ? t('runtimeConfig.runtime.avgCompute', {
                value: formatComputeMs(String(avgComputeMs)),
                defaultValue: 'avg {{value}} / req',
              })
              : undefined}
            tone="warning"
          />
        </div>
      ) : null}

      {/* Records table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={cn('text-left text-[10px] font-medium uppercase tracking-[0.12em]', TOKEN_TEXT_MUTED)}>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.capability', { defaultValue: 'Capability' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.model', { defaultValue: 'Model' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.requests', { defaultValue: 'Requests' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.successRate', { defaultValue: 'Success Rate' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.inputTokens', { defaultValue: 'Input' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.outputTokens', { defaultValue: 'Output' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.compute', { defaultValue: 'Compute' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.queueWait', { defaultValue: 'Queue Wait' })}</th>
                <th className="px-4 py-2.5">{t('runtimeConfig.runtime.bucket', { defaultValue: 'Bucket' })}</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center">
                    <p className={cn('text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
                      {loading
                        ? t('runtimeConfig.runtime.loadingUsageStats', { defaultValue: 'Loading usage stats…' })
                        : t('runtimeConfig.runtime.noUsageData', { defaultValue: 'No usage data yet.' })}
                    </p>
                    {!loading ? (
                      <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>
                        {t('runtimeConfig.runtime.noUsageHint', {
                          defaultValue: 'Data appears once mods or connected apps start making runtime calls.',
                        })}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ) : (
                records.map((r, idx) => {
                  const bucketTs = timestampToIso(r.bucketStart);
                  const requestsNum = Number(r.requestCount) || 0;
                  const successNum = Number(r.successCount) || 0;
                  const rowSuccess = computeSuccessRate(successNum, requestsNum);
                  const rowToneText = {
                    success: 'text-[var(--nimi-status-success)]',
                    warning: 'text-[var(--nimi-status-warning)]',
                    danger: 'text-[var(--nimi-status-danger)]',
                    neutral: TOKEN_TEXT_MUTED,
                  }[rowSuccess.tone];
                  return (
                    <tr
                      key={`${r.capability}-${r.modelId}-${idx}`}
                      className="border-t border-[var(--nimi-border-subtle)]/50 transition-colors hover:bg-white/50"
                    >
                      <td className={cn('px-4 py-2.5', TOKEN_TEXT_PRIMARY)}>{r.capability || '—'}</td>
                      <td className={cn('max-w-[200px] truncate px-4 py-2.5 font-mono', TOKEN_TEXT_SECONDARY)} title={r.modelId}>
                        {r.modelId || '—'}
                      </td>
                      <td className={cn('px-4 py-2.5 font-mono', TOKEN_TEXT_PRIMARY)}>{formatNumber(r.requestCount)}</td>
                      <td className={cn('px-4 py-2.5 font-mono', rowToneText)}>{rowSuccess.label}</td>
                      <td className={cn('px-4 py-2.5 font-mono', TOKEN_TEXT_SECONDARY)}>{formatTokenCount(r.inputTokens)}</td>
                      <td className={cn('px-4 py-2.5 font-mono', TOKEN_TEXT_SECONDARY)}>{formatTokenCount(r.outputTokens)}</td>
                      <td className={cn('px-4 py-2.5 font-mono', TOKEN_TEXT_SECONDARY)}>{formatComputeMs(r.computeMs)}</td>
                      <td className={cn('px-4 py-2.5 font-mono', TOKEN_TEXT_SECONDARY)}>{formatComputeMs(r.queueWaitMs)}</td>
                      <td className={cn('px-4 py-2.5', TOKEN_TEXT_MUTED)}>
                        <Tooltip content={bucketTs} placement="top">
                          <span>{bucketTs !== '-' ? relativeTimeShort(bucketTs) : '—'}</span>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Load More */}
      {hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading
              ? t('runtimeConfig.runtime.loading', { defaultValue: 'Loading…' })
              : t('runtimeConfig.runtime.loadMore', { defaultValue: 'Load more' })}
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}
