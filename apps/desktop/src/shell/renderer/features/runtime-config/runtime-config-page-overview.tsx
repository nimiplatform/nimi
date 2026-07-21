import {
  useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Surface,
  StatusBadge as KitStatusBadge,
  cn,
  } from '@nimiplatform/kit/ui';
import {
  projectNimiRuntimeRouteCapabilityCoverageList,
  type NimiRuntimeRouteCapabilityCoverageProjection,
} from '@nimiplatform/sdk/runtime';
import {
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';
import { formatLocaleDateTime } from '../../i18n';
import { SectionTitle } from '../settings/settings-layout-components';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import { Button, DaemonStatusBadge } from './runtime-config-primitives';
import { RuntimePageShell } from './runtime-config-page-shell';
import { OverviewLoadUsageSection } from './runtime-config-overview-load-usage';

type OverviewPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

type RuntimeTone = 'neutral' | 'success' | 'warning' | 'danger';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-xl';

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

function deriveCapabilityStatuses(state: RuntimeConfigStateV11): NimiRuntimeRouteCapabilityCoverageProjection[] {
  return projectNimiRuntimeRouteCapabilityCoverageList({
    localNodes: state.local.nodeMatrix,
    localModels: state.local.models,
    connectors: state.connectors,
  });
}

function StatTile({
  title,
  value,
  subtitle,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className={cn('text-xs break-words [overflow-wrap:anywhere]', TOKEN_TEXT_MUTED)}>{title}</p>
      <p className={cn('mt-1 text-2xl font-bold break-words [overflow-wrap:anywhere]', TOKEN_TEXT_PRIMARY)}>{value}</p>
      <p className={cn('mt-1 text-xs break-words [overflow-wrap:anywhere]', TOKEN_TEXT_MUTED)}>{subtitle}</p>
    </>
  );

  if (onClick) {
    return (
      <Surface
        as="button"
        type="button"
        tone="card"
        interactive
        className={cn(TOKEN_PANEL_CARD, 'w-full min-w-0 p-4 text-center')}
        onClick={onClick}
      >
        {content}
      </Surface>
    );
  }

  return (
    <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'w-full min-w-0 p-4 text-center')}>
      {content}
    </Surface>
  );
}

function QuickLinkCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Surface
      as="button"
      type="button"
      tone="card"
      interactive
      className="w-full min-w-0 rounded-xl p-3 text-left"
      onClick={onClick}
    >
      <p className={cn('text-sm font-semibold break-words [overflow-wrap:anywhere]', TOKEN_TEXT_PRIMARY)}>{title}</p>
      <p className={cn('mt-1 text-xs break-words [overflow-wrap:anywhere]', TOKEN_TEXT_MUTED)}>{description}</p>
    </Surface>
  );
}

export function OverviewPage({ model, state }: OverviewPageProps) {
  const { t } = useTranslation();
  const capabilityStatuses = useMemo(() => deriveCapabilityStatuses(state), [state]);

  const installedModelCount = state.local.models.filter((m) => m.status !== 'removed').length;
  const activeModelCount = state.local.models.filter((m) => m.status === 'active').length;
  const healthyConnectorCount = state.connectors.filter((c) => c.status === 'healthy').length;
  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  });

  return (
    <RuntimePageShell>
      <section>
        <SectionTitle>
          {t('runtimeConfig.overview.snapshotTitle', { defaultValue: 'Overview Snapshot' })}
        </SectionTitle>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            title={t('runtimeConfig.overview.installedModels', { defaultValue: 'Installed Models' })}
            value={installedModelCount}
            subtitle={t('runtimeConfig.overview.activeModelsCount', { count: activeModelCount, defaultValue: '{{count}} active' })}
            onClick={() => model.onChangePage('models')}
          />
          <StatTile
            title={t('runtimeConfig.overview.cloudConnectors', { defaultValue: 'Cloud Connectors' })}
            value={state.connectors.length}
            subtitle={t('runtimeConfig.overview.healthyConnectorsCount', { count: healthyConnectorCount, defaultValue: '{{count}} healthy' })}
            onClick={() => model.onChangePage('cloud')}
          />
          <StatTile
            title={t('runtimeConfig.overview.vaultEntries', { defaultValue: 'Vault Entries' })}
            value={model.vaultEntryCount}
            subtitle={t('runtimeConfig.overview.credentialsStored', { defaultValue: 'credentials stored' })}
          />
        </div>
      </section>

      <OverviewLoadUsageSection />

      <section>
        <SectionTitle>
          {t('runtimeConfig.overview.capabilityCoverageTitle', { defaultValue: 'Capability Coverage' })}
        </SectionTitle>
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'mt-2 p-4')}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {capabilityStatuses.map((item) => {
              const available = item.localAvailable || item.cloudAvailable;
              const tone: RuntimeTone = item.localAvailable ? 'success' : item.cloudAvailable ? 'warning' : 'neutral';
              const source = item.localAvailable
                ? t('runtimeConfig.overview.capabilitySourceLocal', {
                  providerSuffix: item.localProvider ? ` (${item.localProvider})` : '',
                  defaultValue: 'local{{providerSuffix}}',
                })
                : item.cloudAvailable
                  ? t('runtimeConfig.overview.capabilitySourceCloudFallback', { defaultValue: 'cloud API fallback' })
                  : t('runtimeConfig.overview.capabilitySourceUnavailable', { defaultValue: 'unavailable' });
              const toneStyle = TONE_STYLES[tone];

              return (
                <Surface
                  key={`capability-overview-${item.capability}`}
                  tone="card"
                  className={cn('flex min-w-0 flex-col gap-2 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between', toneStyle.surface)}
                >
                  <div className="min-w-0">
                    <p className={cn('text-sm font-medium break-words [overflow-wrap:anywhere]', TOKEN_TEXT_PRIMARY)}>{item.capability}</p>
                    <p className={cn('text-xs break-words [overflow-wrap:anywhere]', toneStyle.subtleText)}>{source}</p>
                  </div>
                  {available ? (
                    <KitStatusBadge tone={toneStyle.badge}>
                      {item.localAvailable
                        ? t('runtimeConfig.overview.available', { defaultValue: 'Available' })
                        : t('runtimeConfig.overview.fallback', { defaultValue: 'Fallback' })}
                    </KitStatusBadge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => model.onChangePage('models')}>
                      {t('runtimeConfig.overview.setup', { defaultValue: 'Setup' })}
                    </Button>
                  )}
                </Surface>
              );
            })}
          </div>
        </Surface>
      </section>

      <section>
        <SectionTitle>
          {t('runtimeConfig.overview.runtimeDaemonTitle', { defaultValue: 'Runtime Daemon' })}
        </SectionTitle>
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'mt-2 p-4')}>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className={cn('min-w-0 text-sm break-words [overflow-wrap:anywhere]', TOKEN_TEXT_SECONDARY)}>{t('runtimeConfig.overview.runtimeDaemonStatus', { defaultValue: 'Local AI runtime daemon status' })}</div>
            <DaemonStatusBadge running={daemonRunning} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {[
              {
                key: 'grpc',
                label: t('runtimeConfig.overview.grpc', { defaultValue: 'gRPC' }),
                value: model.runtimeDaemonStatus?.grpcAddr || '—',
              },
              {
                key: 'pid',
                label: t('runtimeConfig.overview.pid', { defaultValue: 'PID' }),
                value: model.runtimeDaemonStatus?.pid || '-',
              },
              {
                key: 'last-check',
                label: t('runtimeConfig.overview.lastCheck', { defaultValue: 'Last check' }),
                value: model.runtimeDaemonUpdatedAt ? formatLocaleDateTime(model.runtimeDaemonUpdatedAt) : '-',
              },
            ].map((entry) => {
              const toneStyle = TONE_STYLES[daemonRunning ? 'success' : 'danger'];
              return (
                <Surface
                  key={entry.key}
                  tone="card"
                  className={cn('min-w-0 rounded-xl p-3', toneStyle.surface)}
                >
                  <p className={cn('text-xs', toneStyle.subtleText)}>{entry.label}</p>
                  <p className={cn('text-sm font-medium break-words [overflow-wrap:anywhere]', TOKEN_TEXT_PRIMARY)}>{entry.value}</p>
                </Surface>
              );
            })}
          </div>

          {daemonIssue ? (
            <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-3">
              <p className="text-sm font-medium text-[var(--nimi-status-warning)]">{daemonIssue.title}</p>
              <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--nimi-status-warning)_80%,var(--nimi-text-secondary))]">{daemonIssue.message}</p>
              <p className="mt-2 text-[11px] break-words [overflow-wrap:anywhere] text-[color-mix(in_srgb,var(--nimi-status-warning)_75%,var(--nimi-text-secondary))]">{daemonIssue.rawError}</p>
            </div>
          ) : model.runtimeDaemonError ? (
            <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{model.runtimeDaemonError}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button data-testid="runtime-service-refresh" variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void model.refreshRuntimeDaemonStatus()}>
              {daemonBusy
                ? t('runtimeConfig.overview.working', { defaultValue: 'Working...' })
                : t('runtimeConfig.overview.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={daemonBusy || daemonRunning} onClick={() => void model.startRuntimeDaemon()}>
              {t('runtimeConfig.overview.start', { defaultValue: 'Start' })}
            </Button>
            <Button data-testid="runtime-service-restart" variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void model.restartRuntimeDaemon()}>
              {t('runtimeConfig.overview.restart', { defaultValue: 'Restart' })}
            </Button>
          </div>
        </Surface>
      </section>

      <section>
        <SectionTitle>
          {t('runtimeConfig.overview.quickNavigationTitle', { defaultValue: 'Quick Navigation' })}
        </SectionTitle>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <QuickLinkCard
            title={t('runtimeConfig.overview.manageModels', { defaultValue: 'Manage Models' })}
            description={t('runtimeConfig.overview.manageModelsDescription', { defaultValue: 'Install, start, stop local assets' })}
            onClick={() => model.onChangePage('models')}
          />
          <QuickLinkCard
            title={t('runtimeConfig.overview.configureCloud', { defaultValue: 'Configure Cloud' })}
            description={t('runtimeConfig.overview.configureCloudDescription', { defaultValue: 'API keys and connectors' })}
            onClick={() => model.onChangePage('cloud')}
          />
          <QuickLinkCard
            title={t('runtimeConfig.overview.runtimeAudit', { defaultValue: 'Runtime & Audit' })}
            description={t('runtimeConfig.overview.runtimeAuditDescription', { defaultValue: 'Health, logs, EAA tokens' })}
            onClick={() => model.onChangePage('environment')}
          />
        </div>
      </section>
    </RuntimePageShell>
  );
}
