import { useMemo } from 'react';
import {
  CAPABILITIES_V11,
  type CapabilityV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/types';
import { formatLocaleDateTime } from '@renderer/i18n';
import type { RuntimeConfigPanelControllerModel } from '../runtime-config-panel-types';
import { Button, Card, StatusBadge } from '../panels/primitives';
import { useMockSystemResources } from '../domain/system-resources';
import { useMockCostEstimate } from '../domain/cost-estimator';

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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
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

export function OverviewPage({ model, state }: OverviewPageProps) {
  const capabilityStatuses = useMemo(() => deriveCapabilityStatuses(state), [state]);
  const sysResources = useMockSystemResources();
  const costEstimate = useMockCostEstimate();

  const installedModelCount = state.localRuntime.models.filter((m) => m.status !== 'removed').length;
  const activeModelCount = state.localRuntime.models.filter((m) => m.status === 'active').length;
  const healthyConnectorCount = state.connectors.filter((c) => c.status === 'healthy').length;
  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" onClick={() => model.onChangePage('local')} className="text-left">
          <Card className="p-4 transition-shadow hover:shadow-sm">
            <p className="text-[11px] font-medium text-gray-500">Installed Models</p>
            <p className="text-2xl font-bold text-gray-900">{installedModelCount}</p>
            <p className="text-[11px] text-gray-400">{activeModelCount} active</p>
          </Card>
        </button>
        <button type="button" onClick={() => model.onChangePage('cloud')} className="text-left">
          <Card className="p-4 transition-shadow hover:shadow-sm">
            <p className="text-[11px] font-medium text-gray-500">Cloud Connectors</p>
            <p className="text-2xl font-bold text-gray-900">{state.connectors.length}</p>
            <p className="text-[11px] text-gray-400">{healthyConnectorCount} healthy</p>
          </Card>
        </button>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-gray-500">Vault Entries</p>
          <p className="text-2xl font-bold text-gray-900">{model.vaultEntryCount}</p>
          <p className="text-[11px] text-gray-400">credentials stored</p>
        </Card>
        <button type="button" onClick={() => model.onChangePage('mods')} className="text-left">
          <Card className="p-4 transition-shadow hover:shadow-sm">
            <p className="text-[11px] font-medium text-gray-500">AI Mods</p>
            <p className="text-2xl font-bold text-gray-900">{model.runtimeDependencyTargets.length}</p>
            <p className="text-[11px] text-gray-400">with AI dependencies</p>
          </Card>
        </button>
      </div>

      {/* System Resources + Cost Estimate */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">System Resources</p>
            <p className="text-[11px] text-gray-400">Mock data — will connect to Tauri sysinfo</p>
          </div>
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-gray-600">CPU</span>
                <span className="text-xs font-medium text-gray-900">{sysResources.cpuPercent.toFixed(0)}%</span>
              </div>
              <ProgressBar percent={sysResources.cpuPercent} color="bg-blue-500" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-gray-600">Memory</span>
                <span className="text-xs font-medium text-gray-900">
                  {formatBytes(sysResources.memoryUsedBytes)} / {formatBytes(sysResources.memoryTotalBytes)}
                </span>
              </div>
              <ProgressBar
                percent={(sysResources.memoryUsedBytes / sysResources.memoryTotalBytes) * 100}
                color="bg-purple-500"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-gray-600">Disk</span>
                <span className="text-xs font-medium text-gray-900">
                  {formatBytes(sysResources.diskUsedBytes)} / {formatBytes(sysResources.diskTotalBytes)}
                </span>
              </div>
              <ProgressBar
                percent={(sysResources.diskUsedBytes / sysResources.diskTotalBytes) * 100}
                color="bg-amber-500"
              />
            </div>
            {sysResources.temperatureCelsius !== null ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Temperature</span>
                <span className="text-xs font-medium text-gray-900">{sysResources.temperatureCelsius.toFixed(0)}°C</span>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Estimated Cost</p>
            <p className="text-[11px] text-gray-400">Mock data — will derive from usage stats</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <p className="text-[11px] text-gray-500">Daily</p>
              <p className="text-lg font-semibold text-gray-900">${costEstimate.dailyUsd.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <p className="text-[11px] text-gray-500">Monthly</p>
              <p className="text-lg font-semibold text-gray-900">${costEstimate.monthlyUsd.toFixed(2)}</p>
            </div>
          </div>
          <div className="space-y-1">
            {costEstimate.breakdown.map((entry) => (
              <div key={entry.provider} className="flex items-center justify-between text-xs text-gray-600">
                <span>{entry.provider}</span>
                <span className="font-medium">${entry.monthlyUsd.toFixed(2)}/mo</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Capability Coverage */}
      <Card className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Capability Coverage</p>
          <p className="text-xs text-gray-500">AI capabilities available via local runtime or cloud API fallback</p>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
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
                className={`flex items-center justify-between rounded-lg border p-2.5 ${
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
                  <p className={`text-[11px] ${
                    item.localAvailable ? 'text-emerald-700'
                    : item.cloudAvailable ? 'text-amber-700'
                    : 'text-gray-500'
                  }`}>{source}</p>
                </div>
                {!available ? (
                  <button
                    type="button"
                    onClick={() => model.onChangePage('local')}
                    className="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                  >
                    Setup
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Daemon status */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Runtime Daemon</p>
            <p className="text-xs text-gray-500">Local AI runtime daemon status</p>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            daemonRunning ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {daemonRunning ? 'running' : 'stopped'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[11px] text-gray-400">gRPC</p>
            <p className="font-medium">{model.runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371'}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[11px] text-gray-400">PID</p>
            <p className="font-medium">{model.runtimeDaemonStatus?.pid || '-'}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[11px] text-gray-400">Last check</p>
            <p className="font-medium">{model.runtimeDaemonUpdatedAt ? formatLocaleDateTime(model.runtimeDaemonUpdatedAt) : '-'}</p>
          </div>
        </div>
        {model.runtimeDaemonError ? (
          <p className="text-[11px] text-red-600">{model.runtimeDaemonError}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
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
      </Card>

      {/* Quick Navigation */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" onClick={() => model.onChangePage('local')} className="text-left">
          <Card className="p-3 transition-shadow hover:shadow-sm">
            <p className="text-xs font-semibold text-gray-900">Manage Models</p>
            <p className="text-[11px] text-gray-500">Install, start, stop local models</p>
          </Card>
        </button>
        <button type="button" onClick={() => model.onChangePage('cloud')} className="text-left">
          <Card className="p-3 transition-shadow hover:shadow-sm">
            <p className="text-xs font-semibold text-gray-900">Configure Cloud</p>
            <p className="text-[11px] text-gray-500">API keys and connectors</p>
          </Card>
        </button>
        <button type="button" onClick={() => model.onChangePage('runtime')} className="text-left">
          <Card className="p-3 transition-shadow hover:shadow-sm">
            <p className="text-xs font-semibold text-gray-900">Runtime & Audit</p>
            <p className="text-[11px] text-gray-500">Health, logs, EAA tokens</p>
          </Card>
        </button>
        <button type="button" onClick={() => model.onChangePage('mods')} className="text-left">
          <Card className="p-3 transition-shadow hover:shadow-sm">
            <p className="text-xs font-semibold text-gray-900">Mod Dependencies</p>
            <p className="text-[11px] text-gray-500">Configure AI for mods</p>
          </Card>
        </button>
      </div>
    </div>
  );
}
