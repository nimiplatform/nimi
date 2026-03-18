import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CAPABILITIES_V11,
  type CapabilityV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { formatLocaleDateTime, formatLocaleNumber } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import { Button } from './runtime-config-primitives';
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

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
      <div
        className={`h-full transition-all ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

function SurfaceCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04] ${className}`}>{children}</div>;
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
  const body = (
    <SurfaceCard className="p-5 text-center transition-all hover:shadow-md">
      <p className="text-xs text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
    </SurfaceCard>
  );

  if (!onClick) {
    return body;
  }

  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      {body}
    </button>
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
    <button type="button" onClick={onClick} className="text-left">
      <SurfaceCard className="p-4 transition-all hover:shadow-md hover:border-mint-200">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      </SurfaceCard>
    </button>
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
          <SurfaceCard className="p-5">
            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-900">{t('runtimeConfig.overview.systemResources', { defaultValue: 'System Resources' })}</p>
              <p className="text-xs text-gray-500">{t('runtimeConfig.overview.systemResourcesDescription', { defaultValue: 'Live snapshot from desktop runtime' })}</p>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-600">{t('runtimeConfig.overview.cpu', { defaultValue: 'CPU' })}</span>
                  <span className="font-medium text-gray-900">{sysResources.cpuPercent.toFixed(0)}%</span>
                </div>
                <ProgressBar percent={sysResources.cpuPercent} color="bg-blue-500" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-600">{t('runtimeConfig.overview.memory', { defaultValue: 'Memory' })}</span>
                  <span className="font-medium text-gray-900">
                    {formatBytes(sysResources.memoryUsedBytes)} / {formatBytes(sysResources.memoryTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={memoryPercent} color="bg-purple-500" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-600">{t('runtimeConfig.overview.disk', { defaultValue: 'Disk' })}</span>
                  <span className="font-medium text-gray-900">
                    {formatBytes(sysResources.diskUsedBytes)} / {formatBytes(sysResources.diskTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={diskPercent} color="bg-amber-500" />
              </div>
              {typeof sysResources.temperatureCelsius === 'number' ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{t('runtimeConfig.overview.temperature', { defaultValue: 'Temperature' })}</span>
                  <span className="font-medium text-gray-900">
                    {t('runtimeConfig.overview.temperatureValue', { value: sysResources.temperatureCelsius.toFixed(0), defaultValue: '{{value}} C' })}
                  </span>
                </div>
              ) : null}
              <p className="pt-1 text-xs text-gray-500">
                {t('runtimeConfig.overview.systemResourceMeta', {
                  source: sysResources.source,
                  capturedAt: formatLocaleDateTime(new Date(sysResources.capturedAtMs).toISOString()),
                  defaultValue: 'Source: {{source}} | Captured: {{capturedAt}}',
                })}
              </p>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-900">{t('runtimeConfig.overview.usageEstimate', { defaultValue: 'Usage Estimate' })}</p>
              <p className="text-xs text-gray-500">{t('runtimeConfig.overview.usageEstimateDescription', { defaultValue: 'Aggregated from runtime usage stats' })}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{t('runtimeConfig.overview.requests', { defaultValue: 'Requests' })}</p>
                <p className="text-lg font-semibold text-gray-900">{formatCount(usageEstimate.totalRequests)}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{t('runtimeConfig.overview.compute', { defaultValue: 'Compute' })}</p>
                <p className="text-lg font-semibold text-gray-900">
                  {t('runtimeConfig.overview.computeValue', {
                    value: formatCount(usageEstimate.totalComputeMs),
                    defaultValue: '{{value}} ms',
                  })}
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{t('runtimeConfig.overview.inputTokens', { defaultValue: 'Input Tokens' })}</p>
                <p className="text-sm font-semibold text-gray-900">{formatCount(usageEstimate.totalInputTokens)}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{t('runtimeConfig.overview.outputTokens', { defaultValue: 'Output Tokens' })}</p>
                <p className="text-sm font-semibold text-gray-900">{formatCount(usageEstimate.totalOutputTokens)}</p>
              </div>
              <div className="col-span-2 rounded-xl border border-gray-100 bg-gray-50 p-3" title={usageEstimate.totalEstimatedCost === null ? t('runtimeConfig.overview.costTooltipUnknown', { defaultValue: 'Some models have unknown pricing' }) : ''}>
                <p className="text-xs text-gray-500">{t('runtimeConfig.overview.estimatedCost', { defaultValue: 'Estimated Cost' })}</p>
                <p className="text-lg font-semibold text-gray-900">
                  {usageEstimate.pricingLoading ? '...' : formatCost(usageEstimate.totalEstimatedCost, usageEstimate.costCurrency)}
                </p>
              </div>
            </div>
            {usageEstimate.error ? (
              <p className="mt-3 text-xs text-red-600">{usageEstimate.error}</p>
            ) : null}
            <div className="mt-4 space-y-1 border-t border-gray-100 pt-3">
              {usageEstimate.breakdown.map((entry) => (
                <div key={entry.label} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <span className="shrink-0 font-medium">
                    {t('runtimeConfig.overview.requestsShort', {
                      value: formatCount(entry.requests),
                      defaultValue: '{{value}} req',
                    })}
                  </span>
                  <span className="w-16 shrink-0 text-right font-medium text-gray-500">
                    {formatCost(entry.estimatedCost, entry.costCurrency)}
                  </span>
                </div>
              ))}
              {usageEstimate.breakdown.length === 0 && !usageEstimate.loading ? (
                <p className="text-xs text-gray-500">{t('runtimeConfig.overview.noUsageRecords', { defaultValue: 'No usage records in current window.' })}</p>
              ) : null}
              {usageEstimate.updatedAt ? (
                <p className="pt-1 text-xs text-gray-500">
                  {t('runtimeConfig.overview.updatedAt', {
                    value: formatLocaleDateTime(usageEstimate.updatedAt),
                    defaultValue: 'Updated: {{value}}',
                  })}
                </p>
              ) : null}
              {usageEstimate.breakdown.length > 0 ? (
                <p className="pt-1 text-[11px] text-gray-400">
                  {t('runtimeConfig.overview.costDisclaimer', { defaultValue: 'Estimates based on catalog pricing; actual costs may vary.' })}
                </p>
              ) : null}
            </div>
          </SurfaceCard>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('runtimeConfig.overview.capabilityCoverageDescription', { defaultValue: 'Available AI capabilities from local runtime and cloud fallback.' })}>
          {t('runtimeConfig.overview.capabilityCoverageTitle', { defaultValue: 'Capability Coverage' })}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {capabilityStatuses.map((item) => {
              const available = item.localAvailable || item.cloudAvailable;
              const source = item.localAvailable
                ? t('runtimeConfig.overview.capabilitySourceLocal', {
                  providerSuffix: item.localProvider ? ` (${item.localProvider})` : '',
                  defaultValue: 'local{{providerSuffix}}',
                })
                : item.cloudAvailable
                  ? t('runtimeConfig.overview.capabilitySourceCloudFallback', { defaultValue: 'cloud API fallback' })
                  : t('runtimeConfig.overview.capabilitySourceUnavailable', { defaultValue: 'unavailable' });
              return (
                <div
                  key={`capability-overview-${item.capability}`}
                  className={`flex items-center justify-between rounded-xl border p-3 ${
                    item.localAvailable
                      ? 'border-emerald-200 bg-emerald-50'
                      : item.cloudAvailable
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div>
                    <p className={`text-sm font-medium ${
                      item.localAvailable ? 'text-emerald-900'
                      : item.cloudAvailable ? 'text-amber-900'
                      : 'text-gray-600'
                    }`}>{item.capability}</p>
                    <p className={`text-xs ${
                      item.localAvailable ? 'text-emerald-700'
                      : item.cloudAvailable ? 'text-amber-700'
                      : 'text-gray-500'
                    }`}>{source}</p>
                  </div>
                  {!available ? (
                    <button
                      type="button"
                      onClick={() => model.onChangePage('local')}
                      className="text-xs font-medium text-mint-700 hover:text-mint-800"
                    >
                      {t('runtimeConfig.overview.setup', { defaultValue: 'Setup' })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('runtimeConfig.overview.runtimeDaemonDescription', { defaultValue: 'Control and inspect local runtime daemon status.' })}>
          {t('runtimeConfig.overview.runtimeDaemonTitle', { defaultValue: 'Runtime Daemon' })}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">{t('runtimeConfig.overview.runtimeDaemonStatus', { defaultValue: 'Local AI runtime daemon status' })}</div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              daemonRunning ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {daemonRunning
                ? t('runtimeConfig.overview.running', { defaultValue: 'running' })
                : t('runtimeConfig.overview.stopped', { defaultValue: 'stopped' })}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>{t('runtimeConfig.overview.grpc', { defaultValue: 'gRPC' })}</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>{model.runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371'}</p>
            </div>
            <div className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>{t('runtimeConfig.overview.pid', { defaultValue: 'PID' })}</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>{model.runtimeDaemonStatus?.pid || '-'}</p>
            </div>
            <div className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>{t('runtimeConfig.overview.lastCheck', { defaultValue: 'Last check' })}</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>{model.runtimeDaemonUpdatedAt ? formatLocaleDateTime(model.runtimeDaemonUpdatedAt) : '-'}</p>
            </div>
          </div>

          {daemonIssue ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-sm font-medium text-amber-900">{daemonIssue.title}</p>
              <p className="mt-1 text-xs text-amber-800">{daemonIssue.message}</p>
              <p className="mt-2 text-[11px] text-amber-700">{daemonIssue.rawError}</p>
            </div>
          ) : model.runtimeDaemonError ? (
            <p className="mt-3 text-xs text-red-600">{model.runtimeDaemonError}</p>
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
        </SurfaceCard>
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
