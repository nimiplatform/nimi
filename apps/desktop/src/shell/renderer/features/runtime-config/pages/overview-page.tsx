import { useMemo, type ReactNode } from 'react';
import {
  CAPABILITIES_V11,
  type CapabilityV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/types';
import { formatLocaleDateTime } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigPanelControllerModel } from '../runtime-config-panel-types';
import { Button } from '../panels/primitives';
import { useSystemResources } from '../domain/system-resources';
import { useUsageEstimate } from '../domain/cost-estimator';

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
    const localNode = state.localRuntime.nodeMatrix.find(
      (node) => node.capability === capability && node.available,
    );
    const hasLocalModel = state.localRuntime.models.some(
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
  return new Intl.NumberFormat('en-US').format(Math.round(value));
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
  return <div className={`rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>{children}</div>;
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
  const capabilityStatuses = useMemo(() => deriveCapabilityStatuses(state), [state]);
  const sysResources = useSystemResources();
  const usageEstimate = useUsageEstimate();

  const installedModelCount = state.localRuntime.models.filter((m) => m.status !== 'removed').length;
  const activeModelCount = state.localRuntime.models.filter((m) => m.status === 'active').length;
  const healthyConnectorCount = state.connectors.filter((c) => c.status === 'healthy').length;
  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const memoryPercent = sysResources.memoryTotalBytes > 0
    ? (sysResources.memoryUsedBytes / sysResources.memoryTotalBytes) * 100
    : 0;
  const diskPercent = sysResources.diskTotalBytes > 0
    ? (sysResources.diskUsedBytes / sysResources.diskTotalBytes) * 100
    : 0;

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle description="System summary and key runtime stats.">
          Overview Snapshot
        </SectionTitle>
        <div className="mt-3 grid grid-cols-4 gap-4">
          <StatTile
            title="Installed Models"
            value={installedModelCount}
            subtitle={`${activeModelCount} active`}
            onClick={() => model.onChangePage('local')}
          />
          <StatTile
            title="Cloud Connectors"
            value={state.connectors.length}
            subtitle={`${healthyConnectorCount} healthy`}
            onClick={() => model.onChangePage('cloud')}
          />
          <StatTile
            title="Vault Entries"
            value={model.vaultEntryCount}
            subtitle="credentials stored"
          />
          <StatTile
            title="AI Mods"
            value={model.runtimeDependencyTargets.length}
            subtitle="with AI dependencies"
            onClick={() => model.onChangePage('mods')}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description="Live system usage and aggregated runtime consumption.">
          Runtime Load & Usage
        </SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SurfaceCard className="p-5">
            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-900">System Resources</p>
              <p className="text-xs text-gray-500">Live snapshot from desktop runtime</p>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-600">CPU</span>
                  <span className="font-medium text-gray-900">{sysResources.cpuPercent.toFixed(0)}%</span>
                </div>
                <ProgressBar percent={sysResources.cpuPercent} color="bg-blue-500" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-600">Memory</span>
                  <span className="font-medium text-gray-900">
                    {formatBytes(sysResources.memoryUsedBytes)} / {formatBytes(sysResources.memoryTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={memoryPercent} color="bg-purple-500" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-600">Disk</span>
                  <span className="font-medium text-gray-900">
                    {formatBytes(sysResources.diskUsedBytes)} / {formatBytes(sysResources.diskTotalBytes)}
                  </span>
                </div>
                <ProgressBar percent={diskPercent} color="bg-amber-500" />
              </div>
              {typeof sysResources.temperatureCelsius === 'number' ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Temperature</span>
                  <span className="font-medium text-gray-900">{sysResources.temperatureCelsius.toFixed(0)} C</span>
                </div>
              ) : null}
              <p className="pt-1 text-xs text-gray-500">
                Source: {sysResources.source} | Captured: {formatLocaleDateTime(new Date(sysResources.capturedAtMs).toISOString())}
              </p>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-900">Usage Estimate</p>
              <p className="text-xs text-gray-500">Aggregated from runtime usage stats</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Requests</p>
                <p className="text-lg font-semibold text-gray-900">{formatCount(usageEstimate.totalRequests)}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Compute</p>
                <p className="text-lg font-semibold text-gray-900">{formatCount(usageEstimate.totalComputeMs)} ms</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Input Tokens</p>
                <p className="text-sm font-semibold text-gray-900">{formatCount(usageEstimate.totalInputTokens)}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Output Tokens</p>
                <p className="text-sm font-semibold text-gray-900">{formatCount(usageEstimate.totalOutputTokens)}</p>
              </div>
            </div>
            {usageEstimate.error ? (
              <p className="mt-3 text-xs text-red-600">{usageEstimate.error}</p>
            ) : null}
            <div className="mt-4 space-y-1 border-t border-gray-100 pt-3">
              {usageEstimate.breakdown.map((entry) => (
                <div key={entry.label} className="flex items-center justify-between text-xs text-gray-600">
                  <span className="truncate pr-3">{entry.label}</span>
                  <span className="font-medium">{formatCount(entry.requests)} req</span>
                </div>
              ))}
              {usageEstimate.breakdown.length === 0 && !usageEstimate.loading ? (
                <p className="text-xs text-gray-500">No usage records in current window.</p>
              ) : null}
              {usageEstimate.updatedAt ? (
                <p className="pt-1 text-xs text-gray-500">Updated: {formatLocaleDateTime(usageEstimate.updatedAt)}</p>
              ) : null}
            </div>
          </SurfaceCard>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description="Available AI capabilities from local runtime and cloud fallback.">
          Capability Coverage
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {capabilityStatuses.map((item) => {
              const available = item.localAvailable || item.cloudAvailable;
              const source = item.localAvailable
                ? `local-runtime${item.localProvider ? ` (${item.localProvider})` : ''}`
                : item.cloudAvailable
                  ? 'cloud API fallback'
                  : 'unavailable';
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
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      Setup
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      </section>

      <section className="mt-8">
        <SectionTitle description="Control and inspect local runtime daemon status.">
          Runtime Daemon
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Local AI runtime daemon status</div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              daemonRunning ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {daemonRunning ? 'running' : 'stopped'}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>gRPC</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>{model.runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371'}</p>
            </div>
            <div className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>PID</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>{model.runtimeDaemonStatus?.pid || '-'}</p>
            </div>
            <div className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>Last check</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>{model.runtimeDaemonUpdatedAt ? formatLocaleDateTime(model.runtimeDaemonUpdatedAt) : '-'}</p>
            </div>
          </div>

          {model.runtimeDaemonError ? (
            <p className="mt-3 text-xs text-red-600">{model.runtimeDaemonError}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void model.refreshRuntimeDaemonStatus()}>
              {daemonBusy ? 'Working...' : 'Refresh'}
            </Button>
            <Button variant="secondary" size="sm" disabled={daemonBusy || daemonRunning} onClick={() => void model.startRuntimeDaemon()}>
              Start
            </Button>
            <Button variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void model.restartRuntimeDaemon()}>
              Restart
            </Button>
            <Button variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void model.stopRuntimeDaemon()}>
              Stop
            </Button>
          </div>
        </SurfaceCard>
      </section>

      <section className="mt-8">
        <SectionTitle description="Fast entry points to key runtime configuration pages.">
          Quick Navigation
        </SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLinkCard
            title="Manage Models"
            description="Install, start, stop local models"
            onClick={() => model.onChangePage('local')}
          />
          <QuickLinkCard
            title="Configure Cloud"
            description="API keys and connectors"
            onClick={() => model.onChangePage('cloud')}
          />
          <QuickLinkCard
            title="Runtime & Audit"
            description="Health, logs, EAA tokens"
            onClick={() => model.onChangePage('runtime')}
          />
          <QuickLinkCard
            title="Mod Dependencies"
            description="Configure AI for mods"
            onClick={() => model.onChangePage('mods')}
          />
        </div>
      </section>
    </div>
  );
}
