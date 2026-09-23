import { Button } from '@nimiplatform/kit/ui';
import { projectNimiRuntimeHealthStatusName } from '@nimiplatform/sdk/runtime';
import { UsageWindow, type GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { ArrowRight, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatEstimatedCost, useUsageEstimate } from '../runtime-config/runtime-config-cost-estimator.js';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import {
  useSystemResources,
  type SystemResourceSnapshot,
  type SystemResourceStatus,
} from '../runtime-config/runtime-config-system-resources.js';

// Home is a long-lived surface, so it polls slower than the diagnostics page
// (5s / 15s there). Both hooks stop when Home unmounts on a tab switch.
const HOME_RESOURCE_POLL_MS = 15_000;
const HOME_USAGE_POLL_MS = 30_000;

export type HomeRuntimeState = 'checking' | 'ready' | 'attention' | 'unavailable';

export type HomeMachineStatusViewProps = {
  runtime: HomeRuntimeState;
  resources: { status: SystemResourceStatus; snapshot: SystemResourceSnapshot | null };
  usage: {
    loading: boolean;
    error: string | null;
    pricingLoading: boolean;
    totalRequests: number;
    totalEstimatedCost: number | null;
    costCurrency: string;
    hasUnpricedUsage: boolean;
  };
  onOpenDiagnostics: (pane: RuntimeAdvancedDiagnosticsPane) => void;
};

export function homeRuntimeState(health: {
  isPending: boolean;
  isError: boolean;
  data: Pick<GetRuntimeHealthResponse, 'status'> | undefined;
}): HomeRuntimeState {
  if (health.isError) return 'unavailable';
  if (health.isPending || !health.data) return 'checking';
  return projectNimiRuntimeHealthStatusName(health.data.status) === 'READY' ? 'ready' : 'attention';
}

function percentOf(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

// At or above these the value is tinted as a warning. No advice text: Home has
// no action that would relieve the pressure, so it only points at diagnostics.
export const HOME_RESOURCE_WARN_PERCENT = { cpu: 90, memory: 85, disk: 90 } as const;

const RUNTIME_DOT: Record<HomeRuntimeState, string> = {
  checking: 'bg-[var(--nimi-text-muted)]',
  ready: 'bg-[var(--nimi-status-success)] shadow-[0_0_8px_var(--nimi-status-success)]',
  attention: 'bg-[var(--nimi-status-warning)]',
  unavailable: 'bg-[var(--nimi-status-danger)]',
};

const RUNTIME_LABEL_KEY: Record<HomeRuntimeState, string> = {
  checking: 'runtimeConfig.overview.runtimeChecking',
  ready: 'runtimeConfig.overview.runtimeReady',
  attention: 'runtimeConfig.overview.runtimeNotReady',
  unavailable: 'runtimeConfig.overview.runtimeUnavailable',
};

const ITEM_CLASS =
  'flex h-9 min-w-0 items-center gap-2 rounded-full px-3 text-left text-xs text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]';

function ResourceValue({ label, percent, warnAt }: { label: string; percent: number; warnAt: number }) {
  const rounded = Math.round(Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)));
  const warn = rounded >= warnAt;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap" data-warn={warn ? 'true' : undefined}>
      <span>{label}</span>
      <span className={`font-semibold tabular-nums ${warn ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-primary)]'}`}>
        {`${rounded}%`}
      </span>
    </span>
  );
}

/** Presentational strip: runtime dot, three resource percentages, today's cost, diagnostics entry. No refresh or lifecycle actions here by design. */
export function HomeMachineStatusView({ runtime, resources, usage, onOpenDiagnostics }: HomeMachineStatusViewProps) {
  const { t } = useTranslation();
  const snapshot = resources.snapshot;
  const usageText = usage.error
    ? t('runtimeConfig.overview.todayCostUnavailable')
    : usage.loading && usage.totalRequests === 0
      ? t('runtimeConfig.overview.todayCostPending')
      : t('runtimeConfig.overview.todayCost', {
          cost: usage.pricingLoading ? '…' : formatEstimatedCost(usage.totalEstimatedCost, usage.costCurrency),
        });
  const usageTitle = !usage.error && (usage.totalEstimatedCost === null || usage.hasUnpricedUsage)
    ? t('runtimeConfig.overview.costTooltipUnknown')
    : undefined;
  return (
    <section
      className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-full bg-[var(--nimi-surface-panel)] px-2 py-1.5 shadow-[var(--nimi-elevation-base)]"
      aria-label={t('runtimeConfig.overview.machineStatus')}
      data-testid="home-machine-status"
    >
      <button
        type="button"
        className={`${ITEM_CLASS} text-[var(--nimi-text-primary)]`}
        onClick={() => onOpenDiagnostics('services')}
        data-testid="home-machine-runtime"
        data-state={runtime}
      >
        <span className={`size-2 shrink-0 rounded-full ${RUNTIME_DOT[runtime]}`} />
        <span className={`truncate font-medium ${runtime === 'unavailable' ? 'text-[var(--nimi-status-warning)]' : ''}`}>
          {t(RUNTIME_LABEL_KEY[runtime])}
        </span>
      </button>
      <span className="h-4 w-px bg-[var(--nimi-border-subtle)]" aria-hidden="true" />
      <button
        type="button"
        className={`${ITEM_CLASS} gap-4`}
        onClick={() => onOpenDiagnostics('services')}
        data-testid="home-machine-resources"
      >
        {snapshot ? (
          <>
            <ResourceValue label={t('runtimeConfig.overview.cpu')} percent={snapshot.cpuPercent} warnAt={HOME_RESOURCE_WARN_PERCENT.cpu} />
            <ResourceValue
              label={t('runtimeConfig.overview.memory')}
              percent={percentOf(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes)}
              warnAt={HOME_RESOURCE_WARN_PERCENT.memory}
            />
            <ResourceValue
              label={t('runtimeConfig.overview.disk')}
              percent={percentOf(snapshot.diskUsedBytes, snapshot.diskTotalBytes)}
              warnAt={HOME_RESOURCE_WARN_PERCENT.disk}
            />
          </>
        ) : (
          <span className="truncate">
            {resources.status === 'unavailable'
              ? t('runtimeConfig.overview.systemResourcesUnavailable')
              : t('Common.loading')}
          </span>
        )}
      </button>
      <span className="flex-1" />
      <button
        type="button"
        className={`${ITEM_CLASS} gap-1.5`}
        onClick={() => onOpenDiagnostics('activity')}
        data-testid="home-machine-usage"
        title={usageTitle}
      >
        <Coins size={14} strokeWidth={1.6} className="shrink-0" />
        <span className="truncate font-medium tabular-nums text-[var(--nimi-text-primary)]">{usageText}</span>
        <span className="whitespace-nowrap tabular-nums">{t('runtimeConfig.overview.requestsShort', { count: usage.totalRequests })}</span>
      </button>
      <Button tone="ghost" size="sm" className="rounded-full" onClick={() => onOpenDiagnostics('services')}>
        {t('runtimeConfig.nav.advancedDiagnostics')}
        <ArrowRight size={14} />
      </Button>
    </section>
  );
}

/** Live wrapper used by Home; polls slower than the diagnostics page. */
export function HomeMachineStatus({
  runtime,
  onOpenDiagnostics,
}: {
  runtime: HomeRuntimeState;
  onOpenDiagnostics: (pane: RuntimeAdvancedDiagnosticsPane) => void;
}) {
  const resources = useSystemResources(HOME_RESOURCE_POLL_MS);
  const usage = useUsageEstimate(UsageWindow.DAY, HOME_USAGE_POLL_MS);
  return (
    <HomeMachineStatusView
      runtime={runtime}
      resources={{ status: resources.status, snapshot: resources.snapshot }}
      usage={usage}
      onOpenDiagnostics={onOpenDiagnostics}
    />
  );
}
