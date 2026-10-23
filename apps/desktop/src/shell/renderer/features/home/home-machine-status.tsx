import { Button } from '@nimiplatform/kit/ui';
import { projectNimiRuntimeHealthStatusName } from '@nimiplatform/sdk/runtime';
import type { GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { Coins } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemEntryUsage } from '../../../shared/system-entry-types.js';
import { useSystemEntry } from '../system-entry/system-entry-context.js';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import {
  useSystemResources,
  type SystemResourceSnapshot,
  type SystemResourceStatus,
} from '../runtime-config/runtime-config-system-resources.js';

// Resource sampling is mounted only while the native Home window is visible.
const HOME_RESOURCE_POLL_MS = 15_000;

export type HomeRuntimeState = 'checking' | 'ready' | 'attention' | 'unavailable';

export type HomeMachineStatusViewProps = {
  runtime: HomeRuntimeState;
  capabilities?: ReactNode;
  resources: { status: SystemResourceStatus; snapshot: SystemResourceSnapshot | null };
  usage: SystemEntryUsage | null;
  onOpenDiagnostics: (pane: RuntimeAdvancedDiagnosticsPane) => void;
  onOpenUsage: () => void;
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

// CPU and disk at or above these are tinted as a warning. Memory is tinted only
// when the OS itself reports pressure: its share also counts cache the system
// can reclaim. No advice text: Home has no action that would relieve the
// pressure, so it only points at diagnostics.
export const HOME_RESOURCE_WARN_PERCENT = { cpu: 90, disk: 90 } as const;

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

function roundPercent(percent: number): number {
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)));
}

function ResourceValue({ label, percent, warn, note }: { label: string; percent: number | null; warn: boolean; note?: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap" data-warn={warn ? 'true' : undefined} title={note}>
      <span>{label}</span>
      <span className={`font-semibold tabular-nums ${warn ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-primary)]'}`}>
        {percent === null ? '—' : `${percent}%`}
      </span>
      {warn && note ? <span className="sr-only">{note}</span> : null}
    </span>
  );
}

/** Runtime, capability summary, resources, usage and diagnostics in one device-status strip. */
export function HomeMachineStatusView({ runtime, capabilities, resources, usage, onOpenDiagnostics, onOpenUsage }: HomeMachineStatusViewProps) {
  const { t } = useTranslation();
  const snapshot = resources.snapshot;
  const cpu = roundPercent(snapshot?.cpuPercent ?? 0);
  const memory = roundPercent(snapshot ? percentOf(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes) : 0);
  const disk = snapshot?.diskUsedBytes != null && snapshot.diskTotalBytes != null ? roundPercent(percentOf(snapshot.diskUsedBytes, snapshot.diskTotalBytes)) : null;
  const memoryPressure = snapshot?.memoryPressure ?? 'unknown';
  const usageReady = usage && (usage.status === 'available' || usage.status === 'partial') && usage.attempts !== null;
  const usageText = usageReady
    ? t('runtimeConfig.systemEntry.todayRecorded', { value: usage.attempts })
    : t(`runtimeConfig.systemEntry.${usage?.status === 'unavailable' ? 'usageUnavailableShort' : 'usageLoading'}`);
  const costText = !usageReady ? null : usage.costs.length === 1
    ? t('runtimeConfig.systemEntry.estimateWithCurrency', { amount: usage.costs[0]!.estimate, currency: usage.costs[0]!.currency })
    : usage.costs.length > 1 ? t('runtimeConfig.systemEntry.currencyCount', { count: usage.costs.length })
      : t('runtimeConfig.systemEntry.costUnknown');
  return (
    <section
      className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-[24px] bg-[var(--nimi-surface-panel)] px-2 py-1.5 shadow-[var(--nimi-home-card-elevation)]"
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
      {capabilities}
      <button
        type="button"
        className={`${ITEM_CLASS} gap-4`}
        onClick={() => onOpenDiagnostics('services')}
        data-testid="home-machine-resources"
      >
        {snapshot ? (
          <>
            <ResourceValue label={t('runtimeConfig.overview.cpu')} percent={cpu} warn={cpu >= HOME_RESOURCE_WARN_PERCENT.cpu} />
            <ResourceValue
              label={t('runtimeConfig.overview.memory')}
              percent={memory}
              warn={memoryPressure === 'warning' || memoryPressure === 'critical'}
              note={memoryPressure === 'unknown'
                ? undefined
                : t('runtimeConfig.overview.memoryPressureSummary', { state: t(`runtimeConfig.overview.memoryPressureState.${memoryPressure}`) })}
            />
            <ResourceValue label={t('runtimeConfig.overview.disk')} percent={disk} warn={disk !== null && disk >= HOME_RESOURCE_WARN_PERCENT.disk} note={disk === null ? t('runtimeConfig.overview.diskUnavailable') : undefined} />
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
        onClick={onOpenUsage}
        data-testid="home-machine-usage"
        title={usage?.note}
      >
        <Coins size={14} strokeWidth={1.6} className="shrink-0" />
        <span className="truncate font-medium tabular-nums text-[var(--nimi-text-primary)]">{usageText}</span>
        {usageReady && usage.partial ? <span className="shrink-0 text-[var(--nimi-status-warning)]">{t('runtimeConfig.systemEntry.partial')}</span> : null}
        {costText ? <span className="max-w-48 truncate tabular-nums">{costText}</span> : null}
      </button>
      <Button tone="ghost" size="sm" className="rounded-full" onClick={() => onOpenDiagnostics('services')}>
        {t('runtimeConfig.nav.advancedDiagnostics')}
      </Button>
    </section>
  );
}

/** The hidden native Home mounts no resource sampler; AI reads stay shared. */
export function HomeMachineStatus({
  runtime,
  capabilities,
  onOpenDiagnostics,
  onOpenUsage,
}: {
  runtime: HomeRuntimeState;
  capabilities?: ReactNode;
  onOpenDiagnostics: (pane: RuntimeAdvancedDiagnosticsPane) => void;
  onOpenUsage: () => void;
}) {
  const { homeVisible, projection } = useSystemEntry();
  if (!homeVisible) return null;
  return <VisibleHomeMachineStatus runtime={runtime} capabilities={capabilities} usage={projection?.usage ?? null}
    onOpenDiagnostics={onOpenDiagnostics} onOpenUsage={onOpenUsage} />;
}

function VisibleHomeMachineStatus(props: Omit<HomeMachineStatusViewProps, 'resources'>) {
  const resources = useSystemResources(HOME_RESOURCE_POLL_MS);
  return (
    <HomeMachineStatusView
      {...props}
      resources={{ status: resources.status, snapshot: resources.snapshot }}
    />
  );
}
