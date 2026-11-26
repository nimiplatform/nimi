import { AppCardSurface, Button, ProgressIndicator, Tooltip } from '@nimiplatform/kit/ui';
import { RemoteSourceAccessState, type GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { useQuery } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isSystemEntryLocalOnlyUsage } from '../../../shared/system-entry-types.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { createRuntimeConfigConnectorSdkService } from '../runtime-config/runtime-config-connector-sdk-service.js';
import type { RuntimeAdvancedDiagnosticsPane } from '../runtime-config/runtime-config-state-types.js';
import {
  useSystemResources,
  type SystemResourceSnapshot,
  type SystemResourceStatus,
} from '../runtime-config/runtime-config-system-resources.js';
import { useHomePrimaryRuntimeQuery, useHomeRemoteAccessQuery } from '../settings/home-remote-access-query.js';
import { projectSystemEntryUsage, type SystemEntryAIState } from '../system-entry/system-entry-ai-model.js';
import { useSystemEntry, useSystemEntryAI } from '../system-entry/system-entry-context.js';
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
  ai?: SystemEntryAIState | null;
  cloudConnectorCount?: number | null;
  onOpenDiagnostics: (pane: RuntimeAdvancedDiagnosticsPane) => void;
  onOpenConnections: () => void;
  onOpenStorage: () => void;
  onOpenUsageDetails?: () => void;
  onOpenCloud?: () => void;
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
  const gauge = (
    <div
      className="flex min-w-0 flex-col justify-between gap-2 rounded-2xl bg-[var(--nimi-home-soft-well)] p-3"
      data-warn={warn ? 'true' : undefined}
    >
      <div className="flex items-baseline justify-between gap-1 text-xs tabular-nums">
        <span className="truncate text-xs text-[var(--nimi-text-secondary)]">{label}</span>
        <span
          className={`font-mono font-semibold ${
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
              ? '[&_.nimi-progress__bar]:bg-[var(--nimi-status-warning)]! [&_.nimi-progress__track]:h-[3px]!'
              : '[&_.nimi-progress__bar]:bg-[var(--nimi-text-primary)]! [&_.nimi-progress__track]:h-[3px]!'
          }
        />
      ) : (
        <div className="h-[3px] rounded-full bg-[var(--nimi-surface-active)]" aria-hidden="true" />
      )}
      {warn && note ? <span className="sr-only">{note}</span> : null}
    </div>
  );
  return note ? (
    <Tooltip content={note} placement="top">
      {gauge}
    </Tooltip>
  ) : gauge;
}

function compactUsageText(
  ai: SystemEntryAIState | null | undefined,
  cloudConnectorCount: number | null | undefined,
  locale: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const cloudPart = cloudConnectorCount === null || cloudConnectorCount === undefined
    ? t('runtimeConfig.nav.cloudServices')
    : cloudConnectorCount > 0
      ? t('runtimeConfig.overview.dailySpend.cloudConnectorsReady', { count: cloudConnectorCount })
      : t('runtimeConfig.overview.dailySpend.cloudConnectorsNone');

  const read = ai?.usage;
  const summary = read?.status === 'ready' ? read.value : null;
  const projection = ai && read && summary?.totals
    ? projectSystemEntryUsage(read, ai.range, locale.startsWith('zh') ? 'zh' : 'en')
    : null;

  if (!projection || projection.status === 'unavailable') {
    return cloudPart;
  }

  const localOnly = isSystemEntryLocalOnlyUsage(projection);
  const formattedAttempts = projection.attempts && /^\d+$/u.test(projection.attempts)
    ? new Intl.NumberFormat(locale).format(BigInt(projection.attempts))
    : projection.attempts;

  if (projection.costs.length > 0) {
    const costStr = projection.costs.map((item) => `${item.currency} ${item.estimate}`).join(' / ');
    return formattedAttempts
      ? `${cloudPart} · ${t('runtimeConfig.overview.dailySpend.callsCount', { count: formattedAttempts as unknown as number })} (${costStr})`
      : `${cloudPart} · ${costStr}`;
  }

  if (projection.attempts === '0') {
    return `${cloudPart} · ${t('runtimeConfig.overview.dailySpend.noCallsToday')}`;
  }

  if (localOnly && formattedAttempts) {
    return `${cloudPart} · ${t('runtimeConfig.overview.dailySpend.callsCount', { count: formattedAttempts as unknown as number })}`;
  }

  if (formattedAttempts) {
    return `${cloudPart} · ${t('runtimeConfig.overview.dailySpend.callsCount', { count: formattedAttempts as unknown as number })}`;
  }

  return cloudPart;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.product-surfaces.connections
// @nimi-authority: rule.nimi.desktop.shell-ui.r029
export function HomeHostStatusCardView({
  runtime,
  resources,
  remote,
  ai,
  cloudConnectorCount,
  onOpenDiagnostics,
  onOpenConnections,
  onOpenStorage,
  onOpenUsageDetails,
}: HomeHostStatusCardViewProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
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

  const usageLine = compactUsageText(ai, cloudConnectorCount, locale, t);

  const headerTitle = onOpenUsageDetails
    ? t('runtimeConfig.overview.hostStatus.combinedTitle')
    : t('runtimeConfig.overview.hostStatus.title');

  return (
    <AppCardSurface
      kind="operational-solid"
      className="flex h-full min-w-0 flex-col justify-between gap-4 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
      aria-label={headerTitle}
      data-testid="home-host-status"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
            {headerTitle}
          </h2>
          <Tooltip content={t(RUNTIME_LABEL_KEY[runtime])} placement="top">
            <button
              type="button"
              onClick={() => onOpenDiagnostics('services')}
              data-testid="home-machine-runtime"
              data-state={runtime}
              aria-label={t(RUNTIME_LABEL_KEY[runtime])}
              className="-m-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
            >
              <span className={`size-2 rounded-full ${RUNTIME_DOT[runtime]}`} />
            </button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1">
          {diskWarn ? (
            <Button tone="ghost" size="sm" onClick={onOpenStorage} data-testid="home-host-storage">
              <HardDrive size={13} aria-hidden="true" />
              {t('runtimeConfig.overview.hostStatus.storageAction')}
            </Button>
          ) : null}
          <Button tone="ghost" size="sm" onClick={() => onOpenDiagnostics('services')} data-testid="home-host-diagnostics">
            {t('runtimeConfig.nav.advancedDiagnostics')} →
          </Button>
        </div>
      </header>

      <div data-testid="home-machine-resources">
        {snapshot ? (
          <div className="grid grid-cols-3 gap-2.5">
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
          <div className="rounded-2xl bg-[var(--nimi-home-soft-well)] px-3.5 py-3 text-xs text-[var(--nimi-text-secondary)]">
            {resources.status === 'unavailable'
              ? t('runtimeConfig.overview.systemResourcesUnavailable')
              : t('Common.loading')}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 pt-1 text-xs" data-testid="home-host-remote">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {onOpenUsageDetails ? (
            <button
              type="button"
              onClick={onOpenUsageDetails}
              data-testid="home-host-usage-summary"
              className="min-w-0 truncate text-left text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {usageLine}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[var(--nimi-text-secondary)]">
              {`${primaryText} · ${remoteText}`}
            </span>
          )}

          <Tooltip content={`${primaryText} · ${remoteText}`} placement="top">
            <button
              type="button"
              onClick={onOpenConnections}
              data-testid="home-host-connections"
              className="inline-flex shrink-0 items-center gap-1.5 font-medium text-[var(--nimi-text-primary)] transition-colors hover:text-[var(--nimi-action-primary-bg)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {remote.pendingConfirmCount > 0 ? (
                <span className="size-1.5 rounded-full bg-[var(--nimi-status-warning)]" aria-hidden="true" />
              ) : null}
              <span>{t('runtimeConfig.overview.hostStatus.manageConnections')} →</span>
            </button>
          </Tooltip>
        </div>

        {onOpenUsageDetails ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
            <span className="truncate">{`${primaryText} · ${remoteText}`}</span>
            {remote.pendingConfirmCount > 0 ? (
              <span className="text-[var(--nimi-status-warning-soft-text)]">
                · {t('runtimeConfig.overview.hostStatus.remotePendingConfirm', { count: remote.pendingConfirmCount })}
              </span>
            ) : null}
          </div>
        ) : remote.pendingConfirmCount > 0 ? (
          <span className="text-xs text-[var(--nimi-status-warning-soft-text)]">
            {t('runtimeConfig.overview.hostStatus.remotePendingConfirm', { count: remote.pendingConfirmCount })}
          </span>
        ) : null}
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

function VisibleHomeHostStatusCard(props: Omit<HomeHostStatusCardViewProps, 'resources' | 'remote' | 'ai' | 'cloudConnectorCount'>) {
  const resources = useSystemResources(HOME_RESOURCE_POLL_MS);
  const primary = useHomePrimaryRuntimeQuery();
  const remoteQuery = useHomeRemoteAccessQuery();
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
    <HomeHostStatusCardView
      {...props}
      ai={ai}
      cloudConnectorCount={connectors.isSuccess ? connectors.data : null}
      resources={{ status: resources.status, snapshot: resources.snapshot }}
      remote={deriveHomeRemoteSummary({
        primarySuccess: primary.isSuccess,
        primaryData: primary.data,
        remoteData: remoteQuery.isSuccess ? remoteQuery.data : undefined,
      })}
    />
  );
}

export function HomeHostStatusCard(props: Omit<HomeHostStatusCardViewProps, 'resources' | 'remote' | 'ai' | 'cloudConnectorCount'>) {
  const { homeVisible } = useSystemEntry();
  if (!homeVisible) return null;
  return <VisibleHomeHostStatusCard {...props} />;
}
