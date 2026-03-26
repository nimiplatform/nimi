import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Surface,
  StatusBadge as KitStatusBadge,
  cn,
} from '@nimiplatform/nimi-kit/ui';
import {
  CAPABILITIES_V11,
  type CapabilityV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { formatLocaleDateTime, formatLocaleNumber } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import { Button, DaemonStatusBadge } from './runtime-config-primitives';
import { useSystemResources } from './runtime-config-system-resources';
import { useUsageEstimate } from './runtime-config-cost-estimator';

type OverviewPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

type CapabilityStatus = {
  capability: CapabilityV11;
  localAvailable: boolean;
  cloudAvailable: boolean;
  localProvider?: string;
};

type RuntimeTone = 'neutral' | 'success' | 'warning' | 'danger';
type ProgressTone = 'info' | 'action' | 'warning';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';
const METRIC_CARD_CLASS = 'rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3';

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

const PROGRESS_STYLES: Record<ProgressTone, { track: string; fill: string }> = {
  info: {
    track: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,var(--nimi-surface-panel))]',
    fill: 'bg-[var(--nimi-status-info)]',
  },
  action: {
    track: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,var(--nimi-surface-panel))]',
    fill: 'bg-[var(--nimi-action-primary-bg)]',
  },
  warning: {
    track: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,var(--nimi-surface-panel))]',
    fill: 'bg-[var(--nimi-status-warning)]',
  },
};

function deriveCapabilityStatuses(state: RuntimeConfigStateV11): CapabilityStatus[] {
  return CAPABILITIES_V11.map((capability) => {
    const localNode = state.local.nodeMatrix.find(
      (node) => node.capability === capability && node.available,
    );
    const hasLocalModel = state.local.models.some(
      (m) => m.status === 'active' && m.capabilities.includes(capability),
    );
    const cloudAvailable = state.connectors.some((c) => c.status === 'healthy');
    return {
      capability,
      localAvailable: Boolean(localNode) || hasLocalModel,
      cloudAvailable,
      localProvider: localNode?.provider,
    };
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  return formatLocaleNumber(Math.round(value));
}

function formatCost(value: number | null, currency: string): string {
  if (value === null) return 'N/A';
  if (currency === 'none') return '$0.00';
  const prefix = currency === 'USD' ? '$' : currency === 'CNY' ? '\u00a5' : '';
  if (value < 0.01 && value > 0) return `~${prefix}0.01`;
  return `~${prefix}${value.toFixed(2)}`;
}

function ProgressBar({ percent, tone }: { percent: number; tone: ProgressTone }) {
  const style = PROGRESS_STYLES[tone];

  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full', style.track)}>
      <div
        className={cn('h-full transition-all', style.fill)}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
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
      <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{title}</p>
      <p className={cn('mt-2 text-3xl font-bold', TOKEN_TEXT_PRIMARY)}>{value}</p>
      <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>{subtitle}</p>
    </>
  );

  if (onClick) {
    return (
      <Surface
        as="button"
        type="button"
        tone="card"
        interactive
        className={cn(TOKEN_PANEL_CARD, 'w-full p-5 text-center')}
        onClick={onClick}
      >
        {content}
      </Surface>
    );
  }

  return (
    <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5 text-center')}>
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
      className="w-full rounded-2xl p-4 text-left"
      onClick={onClick}
    >
      <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{title}</p>
      <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>{description}</p>
    </Surface>
  );
}

export function OverviewPage({ model, state }: OverviewPageProps) {
  const { t } = useTranslation();
  const capabilityStatuses = useMemo(() => deriveCapabilityStatuses(state), [state]);
  const sysResources = useSystemResources();
  const usageEstimate = useUsageEstimate();

  const installedModelCount = state.local.models.filter((m) => m.status !== 'removed').length;
  const activeModelCount = state.local.models.filter((m) => m.status === 'active').length;
  const healthyConnectorCount = state.connectors.filter((c) => c.status === 'healthy').length;
  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  });
  const memoryPercent = sysResources.memoryTotalBytes > 0
    ? (sysResources.memoryUsedBytes / sysResources.memoryTotalBytes) * 100
    : 0;
  const diskPercent = sysResources.diskTotalBytes > 0
    ? (sysResources.diskUsedBytes / sysResources.diskTotalBytes) * 100
    : 0;

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle description={t('runtimeConfig.overview.snapshotDescription', { defaultValue: 'System summary and key runtime stats.' })}>
          {t('runtimeConfig.overview.snapshotTitle', { defaultValue: 'Overview Snapshot' })}
        </SectionTitle>
        <div className="mt-3 grid grid-cols-4 gap-4">
          <StatTile
            title={t('runtimeConfig.overview.installedModels', { defaultValue: 'Installed Models' })}
            value={installedModelCount}
            subtitle={t('runtimeConfig.overview.activeModelsCount', { count: activeModelCount, defaultValue: '{{count}} active' })}
            onClick={() => model.onChangePage('local')}
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
          <StatTile
            title={t('runtimeConfig.overview.aiMods', { defaultValue: 'AI Mods' })}
            value={model.runtimeProfileTargets.length}
            subtitle={t('runtimeConfig.overview.withAiProfiles', { defaultValue: 'with AI profiles' })}
            onClick={() => model.onChangePage('mods')}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('runtimeConfig.overview.runtimeLoadDescription', { defaultValue: 'Live system usage and aggregated runtime consumption.' })}>
          {t('runtimeConfig.overview.runtimeLoadTitle', { defaultValue: 'Runtime Load & Usage' })}
        </SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
            <div className="mb-4">
              <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{t('runtimeConfig.overview.systemResources', { defaultValue: 'System Resources' })}</p>
              <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.systemResourcesDescription', { defaultValue: 'Live snapshot from desktop runtime' })}</p>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.cpu', { defaultValue: 'CPU' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>{sysResources.cpuPercent.toFixed(0)}%</span>
                </div>
                <ProgressBar percent={sysResources.cpuPercent} tone="info" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.memory', { defaultValue: 'Memory' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>
                    {formatBytes(sysResources.memoryUsedBytes)} / {formatBytes(sysResources.memoryTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={memoryPercent} tone="action" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.disk', { defaultValue: 'Disk' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>
                    {formatBytes(sysResources.diskUsedBytes)} / {formatBytes(sysResources.diskTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={diskPercent} tone="warning" />
              </div>
              {typeof sysResources.temperatureCelsius === 'number' ? (
                <div className="flex items-center justify-between text-xs">
                  <span className={TOKEN_TEXT_SECONDARY}>{t('runtimeConfig.overview.temperature', { defaultValue: 'Temperature' })}</span>
                  <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>
                    {t('runtimeConfig.overview.temperatureValue', { value: sysResources.temperatureCelsius.toFixed(0), defaultValue: '{{value}} C' })}
                  </span>
                </div>
              ) : null}
              <p className={cn('pt-1 text-xs', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.overview.systemResourceMeta', {
                  source: sysResources.source,
                  capturedAt: formatLocaleDateTime(new Date(sysResources.capturedAtMs).toISOString()),
                  defaultValue: 'Source: {{source}} | Captured: {{capturedAt}}',
                })}
              </p>
            </div>
          </Surface>

          <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
            <div className="mb-4">
              <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{t('runtimeConfig.overview.usageEstimate', { defaultValue: 'Usage Estimate' })}</p>
              <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.usageEstimateDescription', { defaultValue: 'Aggregated from runtime usage stats' })}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className={METRIC_CARD_CLASS}>
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.requests', { defaultValue: 'Requests' })}</p>
                <p className={cn('text-lg font-semibold', TOKEN_TEXT_PRIMARY)}>{formatCount(usageEstimate.totalRequests)}</p>
              </div>
              <div className={METRIC_CARD_CLASS}>
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.compute', { defaultValue: 'Compute' })}</p>
                <p className={cn('text-lg font-semibold', TOKEN_TEXT_PRIMARY)}>
                  {t('runtimeConfig.overview.computeValue', {
                    value: formatCount(usageEstimate.totalComputeMs),
                    defaultValue: '{{value}} ms',
                  })}
                </p>
              </div>
              <div className={METRIC_CARD_CLASS}>
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.inputTokens', { defaultValue: 'Input Tokens' })}</p>
                <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{formatCount(usageEstimate.totalInputTokens)}</p>
              </div>
              <div className={METRIC_CARD_CLASS}>
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.outputTokens', { defaultValue: 'Output Tokens' })}</p>
                <p className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{formatCount(usageEstimate.totalOutputTokens)}</p>
              </div>
              <div
                className={cn(METRIC_CARD_CLASS, 'col-span-2')}
                title={usageEstimate.totalEstimatedCost === null ? t('runtimeConfig.overview.costTooltipUnknown', { defaultValue: 'Some models have unknown pricing' }) : ''}
              >
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.estimatedCost', { defaultValue: 'Estimated Cost' })}</p>
                <p className={cn('text-lg font-semibold', TOKEN_TEXT_PRIMARY)}>
                  {usageEstimate.pricingLoading ? '...' : formatCost(usageEstimate.totalEstimatedCost, usageEstimate.costCurrency)}
                </p>
              </div>
            </div>
            {usageEstimate.error ? (
              <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{usageEstimate.error}</p>
            ) : null}
            <div className="mt-4 space-y-1 border-t border-[var(--nimi-border-subtle)] pt-3">
              {usageEstimate.breakdown.map((entry) => (
                <div key={entry.label} className={cn('flex items-center justify-between gap-2 text-xs', TOKEN_TEXT_SECONDARY)}>
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <span className={cn('shrink-0 font-medium', TOKEN_TEXT_PRIMARY)}>
                    {t('runtimeConfig.overview.requestsShort', {
                      value: formatCount(entry.requests),
                      defaultValue: '{{value}} req',
                    })}
                  </span>
                  <span className="w-16 shrink-0 text-right font-medium text-[var(--nimi-text-muted)]">
                    {formatCost(entry.estimatedCost, entry.costCurrency)}
                  </span>
                </div>
              ))}
              {usageEstimate.breakdown.length === 0 && !usageEstimate.loading ? (
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>{t('runtimeConfig.overview.noUsageRecords', { defaultValue: 'No usage records in current window.' })}</p>
              ) : null}
              {usageEstimate.updatedAt ? (
                <p className={cn('pt-1 text-xs', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.overview.updatedAt', {
                    value: formatLocaleDateTime(usageEstimate.updatedAt),
                    defaultValue: 'Updated: {{value}}',
                  })}
                </p>
              ) : null}
              {usageEstimate.breakdown.length > 0 ? (
                <p className="pt-1 text-[11px] text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.overview.costDisclaimer', { defaultValue: 'Estimates based on catalog pricing; actual costs may vary.' })}
                </p>
              ) : null}
            </div>
          </Surface>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('runtimeConfig.overview.capabilityCoverageDescription', { defaultValue: 'Available AI capabilities from local runtime and cloud fallback.' })}>
          {t('runtimeConfig.overview.capabilityCoverageTitle', { defaultValue: 'Capability Coverage' })}
        </SectionTitle>
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'mt-3 p-5')}>
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
                  className={cn('flex items-center justify-between rounded-xl p-3', toneStyle.surface)}
                >
                  <div className="min-w-0">
                    <p className={cn('text-sm font-medium', TOKEN_TEXT_PRIMARY)}>{item.capability}</p>
                    <p className={cn('text-xs', toneStyle.subtleText)}>{source}</p>
                  </div>
                  {available ? (
                    <KitStatusBadge tone={toneStyle.badge}>
                      {item.localAvailable
                        ? t('runtimeConfig.overview.available', { defaultValue: 'Available' })
                        : t('runtimeConfig.overview.fallback', { defaultValue: 'Fallback' })}
                    </KitStatusBadge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => model.onChangePage('local')}>
                      {t('runtimeConfig.overview.setup', { defaultValue: 'Setup' })}
                    </Button>
                  )}
                </Surface>
              );
            })}
          </div>
        </Surface>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('runtimeConfig.overview.runtimeDaemonDescription', { defaultValue: 'Control and inspect local runtime daemon status.' })}>
          {t('runtimeConfig.overview.runtimeDaemonTitle', { defaultValue: 'Runtime Daemon' })}
        </SectionTitle>
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'mt-3 p-5')}>
          <div className="flex items-center justify-between">
            <div className={cn('text-sm', TOKEN_TEXT_SECONDARY)}>{t('runtimeConfig.overview.runtimeDaemonStatus', { defaultValue: 'Local AI runtime daemon status' })}</div>
            <DaemonStatusBadge running={daemonRunning} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              {
                key: 'grpc',
                label: t('runtimeConfig.overview.grpc', { defaultValue: 'gRPC' }),
                value: model.runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371',
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
                  className={cn('rounded-xl p-3', toneStyle.surface)}
                >
                  <p className={cn('text-xs', toneStyle.subtleText)}>{entry.label}</p>
                  <p className={cn('text-sm font-medium', TOKEN_TEXT_PRIMARY)}>{entry.value}</p>
                </Surface>
              );
            })}
          </div>

          {daemonIssue ? (
            <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-3">
              <p className="text-sm font-medium text-[var(--nimi-status-warning)]">{daemonIssue.title}</p>
              <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--nimi-status-warning)_80%,var(--nimi-text-secondary))]">{daemonIssue.message}</p>
              <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--nimi-status-warning)_75%,var(--nimi-text-secondary))]">{daemonIssue.rawError}</p>
            </div>
          ) : model.runtimeDaemonError ? (
            <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{model.runtimeDaemonError}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void model.refreshRuntimeDaemonStatus()}>
              {daemonBusy
                ? t('runtimeConfig.overview.working', { defaultValue: 'Working...' })
                : t('runtimeConfig.overview.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={daemonBusy || daemonRunning} onClick={() => void model.startRuntimeDaemon()}>
              {t('runtimeConfig.overview.start', { defaultValue: 'Start' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void model.restartRuntimeDaemon()}>
              {t('runtimeConfig.overview.restart', { defaultValue: 'Restart' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void model.stopRuntimeDaemon()}>
              {t('runtimeConfig.overview.stop', { defaultValue: 'Stop' })}
            </Button>
          </div>
        </Surface>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('runtimeConfig.overview.quickNavigationDescription', { defaultValue: 'Fast entry points to key runtime configuration pages.' })}>
          {t('runtimeConfig.overview.quickNavigationTitle', { defaultValue: 'Quick Navigation' })}
        </SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLinkCard
            title={t('runtimeConfig.overview.manageModels', { defaultValue: 'Manage Models' })}
            description={t('runtimeConfig.overview.manageModelsDescription', { defaultValue: 'Install, start, stop local models' })}
            onClick={() => model.onChangePage('local')}
          />
          <QuickLinkCard
            title={t('runtimeConfig.overview.configureCloud', { defaultValue: 'Configure Cloud' })}
            description={t('runtimeConfig.overview.configureCloudDescription', { defaultValue: 'API keys and connectors' })}
            onClick={() => model.onChangePage('cloud')}
          />
          <QuickLinkCard
            title={t('runtimeConfig.overview.runtimeAudit', { defaultValue: 'Runtime & Audit' })}
            description={t('runtimeConfig.overview.runtimeAuditDescription', { defaultValue: 'Health, logs, EAA tokens' })}
            onClick={() => model.onChangePage('runtime')}
          />
          <QuickLinkCard
            title={t('runtimeConfig.overview.modProfiles', { defaultValue: 'Mod Dependencies' })}
            description={t('runtimeConfig.overview.modProfilesDescription', { defaultValue: 'Configure AI for mods' })}
            onClick={() => model.onChangePage('mods')}
          />
        </div>
      </section>
    </div>
  );
}
