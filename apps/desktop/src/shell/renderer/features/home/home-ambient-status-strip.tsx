import { Tooltip } from '@nimiplatform/kit/ui';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isSystemEntryLocalOnlyUsage } from '../../../shared/system-entry-types.js';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import { projectSystemEntryUsage, type SystemEntryAIState } from '../system-entry/system-entry-ai-model.js';
import type { HomeRemoteSummary } from './home-host-status-card.js';
import type { HomeRuntimeState } from './home-machine-status.js';

export type HomeAmbientStatusStripProps = {
  runtime: HomeRuntimeState;
  capabilitiesLoading: boolean;
  capabilitiesFailed: boolean;
  readyCapabilityCount: number;
  ai: SystemEntryAIState | null;
  remote: HomeRemoteSummary;
  activeIntegrationCount: number;
  onOpenDiagnostics: (pane: RuntimeAdvancedDiagnosticsPane) => void;
  onOpenCapabilities: () => void;
  onOpenUsageDetails: () => void;
  onOpenConnections: () => void;
  onOpenIntegrations: () => void;
};

const RUNTIME_DOT: Record<HomeRuntimeState, string> = {
  checking: 'bg-[var(--nimi-text-muted)]',
  ready: 'bg-[var(--nimi-status-success)]',
  attention: 'bg-[var(--nimi-status-warning)]',
  unavailable: 'bg-[var(--nimi-status-danger)]',
};

const ENGINE_LABEL_KEY: Record<HomeRuntimeState, string> = {
  checking: 'runtimeConfig.overview.ambientStrip.engineChecking',
  ready: 'runtimeConfig.overview.ambientStrip.engineReady',
  attention: 'runtimeConfig.overview.ambientStrip.engineAttention',
  unavailable: 'runtimeConfig.overview.ambientStrip.engineUnavailable',
};

function hasPositiveCount(value: string | undefined): boolean {
  return typeof value === 'string' && /^\d{1,30}$/u.test(value) && BigInt(value) > 0n;
}

function formatDecimalCount(value: string | null | undefined, locale: string): string | null {
  return typeof value === 'string' && /^\d{1,30}$/u.test(value)
    ? new Intl.NumberFormat(locale).format(BigInt(value))
    : null;
}

function describeUsageSegment(
  ai: SystemEntryAIState | null,
  locale: string,
  t: ReturnType<typeof useTranslation>['t'],
): { text: string; incomplete: boolean; tooltipKey?: string } {
  const read = ai?.usage;
  if (!ai || !read || read.status === 'loading') {
    return { text: t('runtimeConfig.overview.ambientStrip.usageLoading'), incomplete: false };
  }
  const summary = read.status === 'ready' ? read.value : null;
  const projection = summary?.totals
    ? projectSystemEntryUsage(read, ai.range, locale.startsWith('zh') ? 'zh' : 'en')
    : null;
  if (!projection || projection.status === 'unavailable') {
    return { text: t('runtimeConfig.overview.ambientStrip.usageUnavailable'), incomplete: false };
  }

  const localOnly = isSystemEntryLocalOnlyUsage(projection);
  const pending = hasPositiveCount(summary?.totals?.pendingUsageCount);
  const unpriced = hasPositiveCount(summary?.totals?.unpricedAttemptCount);
  const uncoveredSources = summary?.sourceCoverage.filter((source) => !source.usageComplete) ?? [];
  const sourceIncomplete = !summary?.sourceComplete || !summary?.sourceCoverage.length || uncoveredSources.length > 0;
  const recordsIncomplete = Boolean(summary && (sourceIncomplete || !summary.timeComplete));
  const quantitiesIncomplete = Boolean(summary && !localOnly && (!summary.quantityComplete || pending));
  const pricingIncomplete = Boolean(summary && projection.costs.length !== summary.estimates.length);
  const unexplainedCoverage = Boolean(
    summary
      && summary.partialReasons.some((reason) => !localOnly || reason !== 'usage_pending')
      && !recordsIncomplete
      && !quantitiesIncomplete
      && !unpriced,
  );
  const costIncomplete = recordsIncomplete || quantitiesIncomplete || unpriced || pricingIncomplete || unexplainedCoverage;
  const formattedAttempts = formatDecimalCount(projection.attempts, locale);

  if (projection.costs.length > 0) {
    const costStr = projection.costs.map((item) => `${item.currency} ${item.estimate}`).join(' / ');
    return {
      text: formattedAttempts
        ? t('runtimeConfig.overview.ambientStrip.usageCostWithCalls', { cost: costStr, count: formattedAttempts as unknown as number })
        : t('runtimeConfig.overview.ambientStrip.usageCostOnly', { cost: costStr }),
      incomplete: costIncomplete,
      tooltipKey: 'runtimeConfig.systemEntry.costsIncomplete',
    };
  }

  if (localOnly && !costIncomplete && formattedAttempts && projection.attempts !== '0') {
    return {
      text: t('runtimeConfig.overview.ambientStrip.usageLocalOnly', { count: formattedAttempts as unknown as number }),
      incomplete: false,
    };
  }

  if (projection.attempts === '0' && !costIncomplete) {
    return { text: t('runtimeConfig.overview.ambientStrip.usageIdle'), incomplete: false };
  }

  // @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-coverage
  // Keep incomplete uncertainty visible when source or time coverage is partial,
  // while distinguishing incomplete attempt coverage from pending billing.
  if (projection.attempts === '0' && !pending && !unpriced && !pricingIncomplete) {
    return {
      text: t('runtimeConfig.overview.ambientStrip.usageZeroIncomplete'),
      incomplete: true,
      tooltipKey: recordsIncomplete
        ? 'runtimeConfig.systemEntry.attemptsIncomplete'
        : 'runtimeConfig.systemEntry.attemptsUnconfirmed',
    };
  }

  return {
    text: formattedAttempts
      ? t('runtimeConfig.overview.ambientStrip.usageUnknownCost', { count: formattedAttempts as unknown as number })
      : t('runtimeConfig.overview.ambientStrip.usageCostUnknownNoCount'),
    incomplete: true,
    tooltipKey: 'runtimeConfig.systemEntry.costsIncomplete',
  };
}

function describeRemoteSegment(
  remote: HomeRemoteSummary,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (remote.connectedClientCount > 0) {
    return t('runtimeConfig.overview.ambientStrip.remoteConnected', { count: remote.connectedClientCount });
  }
  if (remote.remoteEnabled === true) {
    return t('runtimeConfig.overview.ambientStrip.remoteListening');
  }
  if (remote.primaryState === 'other-pc') {
    return t('runtimeConfig.overview.ambientStrip.remoteOtherPc');
  }
  return null;
}

const ITEM_BUTTON_CLASS =
  'inline-flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[11.5px] text-[var(--nimi-text-muted)] transition-[transform,background-color,color] duration-150 hover:bg-[var(--nimi-home-whisper-surface)] hover:text-[var(--nimi-text-primary)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.product-surfaces.home-system-activity
// @nimi-authority: rule.nimi.desktop.product-surfaces.connections
export function HomeAmbientStatusStrip({
  runtime,
  capabilitiesLoading,
  capabilitiesFailed,
  readyCapabilityCount,
  ai,
  remote,
  activeIntegrationCount,
  onOpenDiagnostics,
  onOpenCapabilities,
  onOpenUsageDetails,
  onOpenConnections,
  onOpenIntegrations,
}: HomeAmbientStatusStripProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const usage = describeUsageSegment(ai, locale, t);
  const remoteLabel = describeRemoteSegment(remote, t);

  return (
    <footer
      aria-label={t('runtimeConfig.overview.ambientStrip.sectionLabel')}
      data-testid="home-ambient-status-strip"
      className="mx-auto flex w-full max-w-[780px] flex-wrap items-center justify-center gap-x-1.5 gap-y-1 border-t border-[var(--nimi-border-subtle)]/60 pt-3.5 text-[11.5px] text-[var(--nimi-text-muted)]"
    >
      <button
        type="button"
        onClick={() => onOpenDiagnostics('services')}
        data-testid="home-ambient-runtime"
        data-state={runtime}
        className={ITEM_BUTTON_CLASS}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${RUNTIME_DOT[runtime]}`} aria-hidden="true" />
        <span className="truncate">{t(ENGINE_LABEL_KEY[runtime])}</span>
      </button>

      {!capabilitiesLoading ? (
        <>
          <span className="text-[var(--nimi-border-strong)]" aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpenCapabilities}
            data-testid="home-ambient-capabilities"
            className={ITEM_BUTTON_CLASS}
          >
            <span className="truncate">
              {capabilitiesFailed
                ? t('runtimeConfig.overview.ambientStrip.capabilitiesUnavailable')
                : t('runtimeConfig.overview.ambientStrip.capabilitiesReady', { count: readyCapabilityCount })}
            </span>
          </button>
        </>
      ) : null}

      <span className="text-[var(--nimi-border-strong)]" aria-hidden="true">·</span>

      <button
        type="button"
        onClick={onOpenUsageDetails}
        data-testid="home-ambient-usage"
        className={`${ITEM_BUTTON_CLASS} tabular-nums`}
      >
        <span className="truncate">{usage.text}</span>
        {usage.incomplete ? (
          <Tooltip content={t(usage.tooltipKey ?? 'runtimeConfig.systemEntry.costsIncomplete')} placement="top">
            <span className="inline-flex items-center text-[var(--nimi-status-warning)]" data-testid="home-ambient-usage-incomplete">
              <Info size={12} aria-hidden="true" />
            </span>
          </Tooltip>
        ) : null}
      </button>

      {remoteLabel ? (
        <>
          <span className="text-[var(--nimi-border-strong)]" aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpenConnections}
            data-testid="home-ambient-remote"
            className={ITEM_BUTTON_CLASS}
          >
            <span className="truncate">{remoteLabel}</span>
          </button>
        </>
      ) : null}

      {activeIntegrationCount > 0 ? (
        <>
          <span className="text-[var(--nimi-border-strong)]" aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpenIntegrations}
            data-testid="home-ambient-integrations"
            className={ITEM_BUTTON_CLASS}
          >
            <span className="truncate">
              {t('runtimeConfig.overview.ambientStrip.integrationsConnected', { count: activeIntegrationCount })}
            </span>
          </button>
        </>
      ) : null}
    </footer>
  );
}
