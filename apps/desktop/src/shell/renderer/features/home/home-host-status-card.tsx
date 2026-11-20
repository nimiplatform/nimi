import { AppCardSurface, Button, ProgressIndicator } from '@nimiplatform/kit/ui';
import { RemoteSourceAccessState, type GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { HardDrive, Network, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import {
  useSystemResources,
  type SystemResourceSnapshot,
  type SystemResourceStatus,
} from '../runtime-config/runtime-config-system-resources.js';
import { useHomePrimaryRuntimeQuery, useHomeRemoteAccessQuery } from '../settings/home-remote-access-query.js';
import { useSystemEntry } from '../system-entry/system-entry-context.js';
import { HOME_RESOURCE_WARN_PERCENT, type HomeRuntimeState } from './home-machine-status.js';

const HOME_RESOURCE_POLL_MS = 15_000;

export type HomeRemoteSummary = Readonly<{
  primaryState: 'this-pc' | 'unbound' | 'other-pc' | 'unknown';
  remoteEnabled: boolean | null;
  connectedClientCount: number;
  pendingConfirmCount: number;
}>;

export type HomeHostStatusCardViewProps = {
  runtime: HomeRuntimeState;
  resources: { status: SystemResourceStatus; snapshot: SystemResourceSnapshot | null };
  remote: HomeRemoteSummary;
  onOpenDiagnostics: (pane: RuntimeAdvancedDiagnosticsPane) => void;
  onOpenConnections: () => void;
  onOpenStorage: () => void;
};

const RUNTIME_DOT: Record<HomeRuntimeState, string> = {
  checking: 'bg-[var(--nimi-text-muted)]',
  ready: 'bg-[var(--nimi-status-success)]',
  attention: 'bg-[var(--nimi-status-warning)]',
  unavailable: 'bg-[var(--nimi-status-danger)]',
};

const RUNTIME_LABEL_KEY: Record<HomeRuntimeState, string> = {
  checking: 'runtimeConfig.overview.runtimeChecking',
  ready: 'runtimeConfig.overview.runtimeReady',
  attention: 'runtimeConfig.overview.runtimeNotReady',
  unavailable: 'runtimeConfig.overview.runtimeUnavailable',
};

function percentOf(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function roundPercent(percent: number): number {
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)));
}

function ResourceGauge({
  label,
  percent,
  warn,
  note,
}: {
  label: string;
  percent: number | null;
  warn: boolean;
  note?: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5"
      data-warn={warn ? 'true' : undefined}
      title={note}
    >
      <div className="flex items-baseline justify-between gap-1 text-xs tabular-nums">
        <span className="truncate text-[11px] font-medium text-[var(--nimi-text-secondary)]">{label}</span>
        <span
          className={`font-semibold ${
            warn ? 'text-[var(--nimi-status-warning-soft-text)]' : 'text-[var(--nimi-text-primary)]'
          }`}
        >
          {percent === null ? '—' : `${percent}%`}
        </span>
      </div>
      {percent !== null ? (
        <ProgressIndicator
          value={percent}
          max={100}
          aria-label={label}
          className={
            warn
              ? '[&_.nimi-progress__bar]:!bg-[var(--nimi-status-warning)] [&_.nimi-progress__track]:h-1.5'
              : '[&_.nimi-progress__track]:h-1.5'
          }
        />
      ) : (
        <div className="h-1.5 rounded-full bg-[var(--nimi-surface-active)]" aria-hidden="true" />
      )}
      {warn && note ? <span className="sr-only">{note}</span> : null}
    </div>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.product-surfaces.connections
// @nimi-authority: rule.nimi.desktop.shell-ui.r029
export function HomeHostStatusCardView({
  runtime,
  resources,
  remote,
  onOpenDiagnostics,
  onOpenConnections,
  onOpenStorage,
}: HomeHostStatusCardViewProps) {
  const { t } = useTranslation();
  const snapshot = resources.snapshot;
  const cpu = roundPercent(snapshot?.cpuPercent ?? 0);
  const memory = roundPercent(snapshot ? percentOf(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes) : 0);
  const disk = snapshot?.diskUsedBytes != null && snapshot.diskTotalBytes != null
    ? roundPercent(percentOf(snapshot.diskUsedBytes, snapshot.diskTotalBytes))
    : null;
  const memoryPressure = snapshot?.memoryPressure ?? 'unknown';
  const diskWarn = disk !== null && disk >= HOME_RESOURCE_WARN_PERCENT.disk;

  const primaryText = remote.primaryState === 'this-pc'
    ? t('runtimeConfig.overview.hostStatus.primaryBoundHere')
    : remote.primaryState === 'unbound'
      ? t('runtimeConfig.overview.hostStatus.primaryUnbound')
      : remote.primaryState === 'other-pc'
        ? t('runtimeConfig.overview.hostStatus.primaryBoundOther')
        : t('runtimeConfig.overview.hostStatus.primaryUnknown');

  const remoteText = remote.remoteEnabled === null
    ? t('runtimeConfig.overview.hostStatus.remoteUnknown')
    : !remote.remoteEnabled
      ? t('runtimeConfig.overview.hostStatus.remoteOff')
      : remote.connectedClientCount > 0
        ? t('runtimeConfig.overview.hostStatus.remoteConnectedCount', { count: remote.connectedClientCount })
        : t('runtimeConfig.overview.hostStatus.remoteListening');

  return (
    <AppCardSurface
      kind="operational-solid"
      className="flex min-w-0 flex-col gap-3.5 p-5 shadow-[var(--nimi-elevation-base)]"
      aria-label={t('runtimeConfig.overview.hostStatus.title')}
      data-testid="home-host-status"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]">
            <Server size={15} aria-hidden="true" />
          </span>
          <h2 className="truncate text-sm font-semibold tracking-tight text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.overview.hostStatus.title')}
          </h2>
        </div>
        <Button tone="ghost" size="sm" onClick={() => onOpenDiagnostics('services')} data-testid="home-host-diagnostics">
          {t('runtimeConfig.nav.advancedDiagnostics')}
        </Button>
      </header>

      <div className="flex flex-col gap-3 text-xs">
        <div data-testid="home-machine-resources">
          {snapshot ? (
            <div className="grid grid-cols-3 gap-3">
              <ResourceGauge
                label={t('runtimeConfig.overview.cpu')}
                percent={cpu}
                warn={cpu >= HOME_RESOURCE_WARN_PERCENT.cpu}
              />
              <ResourceGauge
                label={t('runtimeConfig.overview.memory')}
                percent={memory}
                warn={memoryPressure === 'warning' || memoryPressure === 'critical'}
                note={memoryPressure === 'unknown'
                  ? undefined
                  : t('runtimeConfig.overview.memoryPressureSummary', { state: t(`runtimeConfig.overview.memoryPressureState.${memoryPressure}`) })}
              />
              <ResourceGauge
                label={t('runtimeConfig.overview.disk')}
                percent={disk}
                warn={diskWarn}
                note={disk === null ? t('runtimeConfig.overview.diskUnavailable') : undefined}
              />
            </div>
          ) : (
            <span className="text-[var(--nimi-text-secondary)]">
              {resources.status === 'unavailable'
                ? t('runtimeConfig.overview.systemResourcesUnavailable')
                : t('Common.loading')}
            </span>
          )}
        </div>

        <div className="flex flex-col divide-y divide-[var(--nimi-border-subtle)] border-t border-[var(--nimi-border-subtle)]">
          <div className="flex items-center justify-between gap-2 py-2.5">
            <button
              type="button"
              onClick={() => onOpenDiagnostics('services')}
              data-testid="home-machine-runtime"
              data-state={runtime}
              className="inline-flex min-w-0 items-center gap-2 rounded-lg text-left transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              <span className={`size-2 shrink-0 rounded-full ${RUNTIME_DOT[runtime]}`} />
              <span className={`truncate font-medium ${runtime === 'unavailable' ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-primary)]'}`}>
                {t(RUNTIME_LABEL_KEY[runtime])}
              </span>
            </button>
            {diskWarn ? (
              <Button tone="ghost" size="sm" onClick={onOpenStorage} data-testid="home-host-storage">
                <HardDrive size={13} aria-hidden="true" />
                {t('runtimeConfig.overview.hostStatus.storageAction')}
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5" data-testid="home-host-remote">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-medium text-[var(--nimi-text-primary)]">
                <Network size={13} aria-hidden="true" className="shrink-0 text-[var(--nimi-text-secondary)]" />
                <span className="truncate">{primaryText}</span>
              </span>
              <span className="truncate text-[11px] text-[var(--nimi-text-secondary)]">{remoteText}</span>
              {remote.pendingConfirmCount > 0 ? (
                <span className="mt-1 inline-flex self-start rounded-full bg-[var(--nimi-status-warning-soft-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--nimi-status-warning-soft-text)]">
                  {t('runtimeConfig.overview.hostStatus.remotePendingConfirm', { count: remote.pendingConfirmCount })}
                </span>
              ) : null}
            </div>
            <Button tone="ghost" size="sm" onClick={onOpenConnections} data-testid="home-host-connections">
              {t('runtimeConfig.overview.hostStatus.manageConnections')}
            </Button>
          </div>
        </div>
      </div>
    </AppCardSurface>
  );
}

export function deriveHomeRemoteSummary(input: {
  primarySuccess: boolean;
  primaryData: { bindingId?: string; thisRuntime?: boolean } | undefined;
  remoteData: GetRemoteAccessStateResponse | undefined;
}): HomeRemoteSummary {
  if (!input.primarySuccess || !input.primaryData) {
    return { primaryState: 'unknown', remoteEnabled: null, connectedClientCount: 0, pendingConfirmCount: 0 };
  }
  const primaryState = input.primaryData.thisRuntime
    ? 'this-pc'
    : input.primaryData.bindingId
      ? 'other-pc'
      : 'unbound';
  const { bindingId, thisRuntime } = input.primaryData;
  const remote = thisRuntime && bindingId && bindingId === input.remoteData?.bindingId ? input.remoteData : undefined;
  const remoteEnabled = remote?.enabled ?? null;
  const connectedClientCount = remote?.connections.length ?? 0;
  const pendingConfirmCount = remote?.sources.filter(
    (source) => source.state === RemoteSourceAccessState.PENDING || source.state === RemoteSourceAccessState.CHANGED,
  ).length ?? 0;
  return { primaryState, remoteEnabled, connectedClientCount, pendingConfirmCount };
}

function VisibleHomeHostStatusCard(props: Omit<HomeHostStatusCardViewProps, 'resources' | 'remote'>) {
  const resources = useSystemResources(HOME_RESOURCE_POLL_MS);
  const primary = useHomePrimaryRuntimeQuery();
  const remoteQuery = useHomeRemoteAccessQuery();
  return (
    <HomeHostStatusCardView
      {...props}
      resources={{ status: resources.status, snapshot: resources.snapshot }}
      remote={deriveHomeRemoteSummary({
        primarySuccess: primary.isSuccess,
        primaryData: primary.data,
        remoteData: remoteQuery.isSuccess ? remoteQuery.data : undefined,
      })}
    />
  );
}

export function HomeHostStatusCard(props: Omit<HomeHostStatusCardViewProps, 'resources' | 'remote'>) {
  const { homeVisible } = useSystemEntry();
  if (!homeVisible) return null;
  return <VisibleHomeHostStatusCard {...props} />;
}
