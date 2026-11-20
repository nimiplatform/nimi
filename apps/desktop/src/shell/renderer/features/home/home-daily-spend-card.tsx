import { AppCardSurface, Button, IconButton, LoadingSkeleton, Popover, PopoverContent, PopoverTrigger, ProgressIndicator } from '@nimiplatform/kit/ui';
import { DesktopAIExecutionRoute, type DesktopAICostEstimate, type DesktopAIUsageGroup } from '@nimiplatform/sdk/runtime/generated';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Coins, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isSystemEntryLocalOnlyUsage } from '../../../shared/system-entry-types.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { createRuntimeConfigConnectorSdkService } from '../runtime-config/runtime-config-connector-sdk-service.js';
import { projectSystemEntryUsage, type SystemEntryAIState } from '../system-entry/system-entry-ai-model.js';
import { useSystemEntryAI } from '../system-entry/system-entry-context.js';

export type HomeDailySpendCardViewProps = {
  ai: SystemEntryAIState | null;
  cloudConnectorCount: number | null;
  onOpenDetails: () => void;
  onOpenCloud: () => void;
};

function hasPositiveCount(value: string | undefined): boolean {
  return typeof value === 'string' && /^\d{1,30}$/u.test(value) && BigInt(value) > 0n;
}

function formatDecimalCount(value: string | null | undefined, locale: string): string | null {
  return typeof value === 'string' && /^\d{1,30}$/u.test(value)
    ? new Intl.NumberFormat(locale).format(BigInt(value))
    : null;
}

function validGroupEstimates(estimates: readonly DesktopAICostEstimate[]): DesktopAICostEstimate[] {
  return estimates.filter(
    (item) => /^[A-Z]{3,8}$/u.test(item.currency)
      && /^\d+(\.\d+)?$/u.test(item.estimatedAmount)
      && item.estimatedAmount.length <= 40,
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.home-system-activity
// @nimi-authority: rule.nimi.desktop.shell-ui.r029
// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-usage-summary
export function HomeDailySpendCardView({
  ai,
  cloudConnectorCount,
  onOpenDetails,
  onOpenCloud,
}: HomeDailySpendCardViewProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const read = ai?.usage;
  const loading = !ai || !read || read.status === 'loading';
  const summary = read?.status === 'ready' ? read.value : null;
  const projection = ai && read && summary?.totals
    ? projectSystemEntryUsage(read, ai.range, locale.startsWith('zh') ? 'zh' : 'en')
    : null;
  const unavailable = !loading && (!projection || projection.status === 'unavailable');

  const localOnly = projection ? isSystemEntryLocalOnlyUsage(projection) : false;
  const pending = hasPositiveCount(summary?.totals?.pendingUsageCount);
  const unpriced = hasPositiveCount(summary?.totals?.unpricedAttemptCount);
  const uncoveredSources = summary?.sourceCoverage.filter((source) => !source.usageComplete) ?? [];
  const sourceIncomplete = !summary?.sourceComplete || !summary?.sourceCoverage.length || uncoveredSources.length > 0;
  const recordsIncomplete = Boolean(summary && (sourceIncomplete || !summary.timeComplete));
  const quantitiesIncomplete = Boolean(summary && !localOnly && (!summary.quantityComplete || pending));
  const pricingIncomplete = Boolean(summary && projection && projection.costs.length !== summary.estimates.length);
  const unexplainedCoverage = Boolean(
    summary
      && summary.partialReasons.some((reason) => !localOnly || reason !== 'usage_pending')
      && !recordsIncomplete
      && !quantitiesIncomplete
      && !unpriced,
  );
  const costIncomplete = recordsIncomplete || quantitiesIncomplete || unpriced || pricingIncomplete || unexplainedCoverage;

  const validSplit = Boolean(
    projection
      && projection.attempts !== null
      && projection.localAttempts !== null
      && projection.cloudAttempts !== null,
  );
  const totalCount = validSplit ? Number(projection!.attempts) : 0;
  const localCount = validSplit ? Number(projection!.localAttempts) : 0;

  const cloudGroups: readonly DesktopAIUsageGroup[] = summary
    ? summary.groups
        .filter((group) => group.route === DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD)
        .sort((left, right) => {
          const leftCount = BigInt(left.totals?.attemptCount && /^\d+$/u.test(left.totals.attemptCount) ? left.totals.attemptCount : '0');
          const rightCount = BigInt(right.totals?.attemptCount && /^\d+$/u.test(right.totals.attemptCount) ? right.totals.attemptCount : '0');
          return rightCount > leftCount ? 1 : rightCount < leftCount ? -1 : 0;
        })
        .slice(0, 3)
    : [];

  return (
    <AppCardSurface
      kind="operational-solid"
      className="flex min-w-0 flex-col gap-3.5 p-5 shadow-[var(--nimi-elevation-raised)]"
      data-testid="home-daily-spend-card"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-action-primary-bg)]">
            <Coins size={16} aria-hidden="true" />
          </span>
          <h2 className="truncate text-sm font-semibold tracking-tight text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.overview.dailySpend.title')}
          </h2>
          {!loading && !unavailable && costIncomplete ? (
            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  tone="ghost"
                  size="sm"
                  className="size-6 shrink-0 rounded-full text-[var(--nimi-status-warning)]"
                  aria-label={t('runtimeConfig.systemEntry.costsIncomplete')}
                  title={t('runtimeConfig.systemEntry.costsIncomplete')}
                  data-testid="home-daily-spend-warning"
                  icon={<Info size={14} aria-hidden="true" />}
                />
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-72 space-y-1.5 p-3 text-xs leading-5">
                <p className="font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.systemEntry.costsIncomplete')}</p>
                {recordsIncomplete ? <p className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.systemEntry.costsMissingRecords')}</p> : null}
                {pending && quantitiesIncomplete ? (
                  <p className="text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.systemEntry.costsPendingUsage', { value: formatDecimalCount(summary?.totals?.pendingUsageCount, locale) ?? t('runtimeConfig.systemEntry.unknown') })}
                  </p>
                ) : null}
                {!pending && quantitiesIncomplete ? <p className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.systemEntry.costsMissingQuantities')}</p> : null}
                {unpriced ? (
                  <p className="text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.systemEntry.costsUnpriced', { value: formatDecimalCount(summary?.totals?.unpricedAttemptCount, locale) ?? t('runtimeConfig.systemEntry.unknown') })}
                  </p>
                ) : null}
                {pricingIncomplete || unexplainedCoverage ? <p className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.systemEntry.costsUnconfirmed')}</p> : null}
                <p className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.systemEntry.missingCostsNotZero')}</p>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
        <Button tone="ghost" size="sm" onClick={onOpenDetails} data-testid="home-daily-spend-details">
          {t('runtimeConfig.overview.dailySpend.detailsAction')}
        </Button>
      </header>

      {loading ? (
        <LoadingSkeleton lines={2} label={t('runtimeConfig.systemEntry.usageLoading')} />
      ) : unavailable || !projection ? (
        <p className="text-sm text-[var(--nimi-text-secondary)]" data-testid="home-daily-spend-unavailable">
          {t('runtimeConfig.systemEntry.usageUnavailableShort')}
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-3" data-testid="home-daily-spend-primary">
            {projection.costs.length > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {projection.costs.map((item) => (
                    <span key={item.currency} className="inline-flex items-baseline gap-1.5 tabular-nums" data-testid={`home-daily-spend-currency:${item.currency}`}>
                      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-secondary)]">{item.currency}</span>
                      <span className="text-3xl font-bold tracking-tight text-[var(--nimi-text-primary)]">{item.estimate}</span>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-[var(--nimi-text-secondary)]">
                  {t(costIncomplete
                    ? 'runtimeConfig.overview.dailySpend.partialEstimateHint'
                    : 'runtimeConfig.overview.dailySpend.catalogEstimateHint')}
                  {projection.costs.length > 1 ? ` · ${t('runtimeConfig.systemEntry.separateCurrencies')}` : ''}
                </p>
              </div>
            ) : localOnly && !costIncomplete ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-3xl font-bold tabular-nums tracking-tight text-[var(--nimi-text-primary)]">0.00</span>
                <span className="rounded-full bg-[var(--nimi-status-success-soft-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-status-success)]">
                  {t('runtimeConfig.overview.dailySpend.localOnlyZero')}
                </span>
              </div>
            ) : projection.attempts === '0' && !costIncomplete ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-bold tabular-nums tracking-tight text-[var(--nimi-text-primary)]">0.00</span>
                  <p className="text-xs font-medium text-[var(--nimi-text-secondary)]" data-testid="home-daily-spend-zero">
                    {t('runtimeConfig.overview.dailySpend.noCallsToday')}
                  </p>
                </div>
                {projection.partial ? (
                  <span className="rounded-full bg-[var(--nimi-status-warning-soft-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--nimi-status-warning-soft-text)]">
                    {t('runtimeConfig.systemEntry.partial')}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--nimi-text-secondary)]" data-testid="home-daily-spend-cost-unknown">
                  {t('runtimeConfig.systemEntry.costUnknown')}
                </span>
                {projection.partial ? (
                  <span className="rounded-full bg-[var(--nimi-status-warning-soft-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--nimi-status-warning-soft-text)]">
                    {t('runtimeConfig.systemEntry.partial')}
                  </span>
                ) : null}
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-[var(--nimi-border-subtle)] pt-3" data-testid="home-daily-spend-split">
              {validSplit ? (
                <>
                  <div className="grid grid-cols-3 divide-x divide-[var(--nimi-border-subtle)] text-center">
                    <div className="px-1">
                      <p className="text-[11px] text-[var(--nimi-text-muted)]">{t('runtimeConfig.overview.dailySpend.metricTotal')}</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--nimi-text-primary)]">
                        {formatDecimalCount(projection.attempts, locale) ?? projection.attempts}
                      </p>
                    </div>
                    <div className="px-1">
                      <p className="inline-flex items-center gap-1 text-[11px] text-[var(--nimi-text-muted)]">
                        <span className="size-1.5 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
                        {t('runtimeConfig.overview.dailySpend.metricLocal')}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--nimi-text-primary)]">
                        {formatDecimalCount(projection.localAttempts, locale) ?? projection.localAttempts}
                      </p>
                    </div>
                    <div className="px-1">
                      <p className="inline-flex items-center gap-1 text-[11px] text-[var(--nimi-text-muted)]">
                        <span className="size-1.5 rounded-full bg-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
                        {t('runtimeConfig.overview.dailySpend.metricCloud')}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--nimi-text-primary)]">
                        {formatDecimalCount(projection.cloudAttempts, locale) ?? projection.cloudAttempts}
                      </p>
                    </div>
                  </div>
                  <p className="sr-only">
                    {t('runtimeConfig.overview.dailySpend.splitSummary', {
                      total: formatDecimalCount(projection.attempts, locale) ?? projection.attempts,
                      local: formatDecimalCount(projection.localAttempts, locale) ?? projection.localAttempts,
                      cloud: formatDecimalCount(projection.cloudAttempts, locale) ?? projection.cloudAttempts,
                    })}
                  </p>
                  {Number.isFinite(totalCount) && totalCount > 0 ? (
                    <ProgressIndicator
                      value={localCount}
                      max={totalCount}
                      aria-label={t('runtimeConfig.overview.dailySpend.title')}
                    />
                  ) : null}
                </>
              ) : (
                <p className="text-xs tabular-nums text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.overview.dailySpend.splitTotalOnly', {
                    total: formatDecimalCount(projection.attempts, locale) ?? projection.attempts ?? '0',
                  })}
                </p>
              )}
            </div>
          </div>

          {cloudGroups.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-[var(--nimi-border-subtle)] pt-3" data-testid="home-daily-spend-cloud-groups">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.overview.dailySpend.topCloudTitle')}
              </p>
              <ul className="divide-y divide-[var(--nimi-border-subtle)]">
                {cloudGroups.map((group, index) => {
                  const primaryModel = group.models[0];
                  const modelLabel = primaryModel?.displayName || primaryModel?.modelId || t('runtimeConfig.systemEntry.modelUnknown');
                  const providerLabel = primaryModel?.providerId ?? '';
                  const estimates = validGroupEstimates(group.estimates);
                  const attemptsText = formatDecimalCount(group.totals?.attemptCount, locale) ?? t('runtimeConfig.systemEntry.unknown');
                  return (
                    <li
                      key={`${group.sourceKind}:${group.capability}:${index}`}
                      className="flex items-center justify-between gap-2 py-2 first:pt-1 last:pb-0 text-xs"
                      data-testid="home-daily-spend-cloud-row"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-[var(--nimi-text-primary)]">
                          {modelLabel}
                          {providerLabel ? <span className="ml-1.5 font-normal text-[var(--nimi-text-secondary)]">{providerLabel}</span> : null}
                        </p>
                        <p className="truncate text-[11px] text-[var(--nimi-text-muted)]">
                          {displayRuntimeConfigCapabilityLabel(group.capability, t)}
                          {' · '}
                          {t('runtimeConfig.overview.dailySpend.callsCount', { count: attemptsText as unknown as number })}
                        </p>
                      </div>
                      <div className="shrink-0 text-right font-semibold tabular-nums text-[var(--nimi-text-primary)]">
                        {estimates.length > 0
                          ? estimates.map((est) => `${est.currency} ${est.estimatedAmount}`).join(' · ')
                          : <span className="font-normal text-[var(--nimi-text-muted)]">{t('runtimeConfig.overview.dailySpend.unpricedTag')}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-3 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[var(--nimi-text-secondary)]" data-testid="home-daily-spend-connectors">
          <Cloud size={14} aria-hidden="true" className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
          {cloudConnectorCount === null
            ? t('runtimeConfig.nav.cloudServices')
            : cloudConnectorCount > 0
              ? t('runtimeConfig.overview.dailySpend.cloudConnectorsReady', { count: cloudConnectorCount })
              : t('runtimeConfig.overview.dailySpend.cloudConnectorsNone')}
        </span>
        <Button tone="ghost" size="sm" onClick={onOpenCloud} data-testid="home-daily-spend-manage-cloud">
          {t('runtimeConfig.overview.dailySpend.manageCloud')}
        </Button>
      </footer>
    </AppCardSurface>
  );
}

export function HomeDailySpendCard({
  onOpenDetails,
  onOpenCloud,
}: {
  onOpenDetails: () => void;
  onOpenCloud: () => void;
}) {
  const ai = useSystemEntryAI();
  const sdk = useDesktopRendererSdk();
  const authStatus = useAppStore((state) => state.auth.status);
  const connectors = useQuery({
    queryKey: ['nimi-overview', 'cloud-connectors-count'],
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const service = createRuntimeConfigConnectorSdkService(() => sdk.connectorAdmin());
      const items = await service.sdkListConnectors();
      return items.length;
    },
  });
  return (
    <HomeDailySpendCardView
      ai={ai}
      cloudConnectorCount={connectors.isSuccess ? connectors.data : null}
      onOpenDetails={onOpenDetails}
      onOpenCloud={onOpenCloud}
    />
  );
}
