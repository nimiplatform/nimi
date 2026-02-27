import { useMemo } from 'react';
import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import {
  CAPABILITIES_V11,
  type CapabilityV11,
  type RuntimeConfigStateV11,
  type RuntimeSetupPageIdV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { formatLocaleDateTime } from '@renderer/i18n';
import type { RuntimeDependencyTargetDescriptor } from '../../runtime-config-panel-types';
import { Button, Card, StatusBadge } from '../primitives';

type RuntimeOverviewPageProps = {
  state: RuntimeConfigStateV11;
  runtimeDependencyTargets: RuntimeDependencyTargetDescriptor[];
  registeredRuntimeModIds: string[];
  vaultEntryCount: number;
  discovering: boolean;
  checkingHealth: boolean;
  runtimeDaemonStatus: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonBusyAction: 'start' | 'restart' | 'stop' | null;
  runtimeDaemonError: string;
  runtimeDaemonUpdatedAt: string | null;
  onDiscover: () => Promise<void>;
  onHealthCheck: () => Promise<void>;
  onRefreshRuntimeDaemon: () => Promise<void>;
  onStartRuntimeDaemon: () => Promise<void>;
  onRestartRuntimeDaemon: () => Promise<void>;
  onStopRuntimeDaemon: () => Promise<void>;
  onNavigate: (pageId: RuntimeSetupPageIdV11) => void;
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
      (model) => model.status === 'active' && model.capabilities.includes(capability),
    );
    const cloudAvailable = state.connectors.some(
      (connector) => connector.status === 'healthy',
    );
    return {
      capability,
      localAvailable: Boolean(localNode) || hasLocalModel,
      cloudAvailable,
      localProvider: localNode?.provider,
    };
  });
}

export function RuntimeOverviewPage({
  state,
  runtimeDependencyTargets,
  registeredRuntimeModIds,
  vaultEntryCount,
  discovering,
  checkingHealth,
  runtimeDaemonStatus,
  runtimeDaemonBusyAction,
  runtimeDaemonError,
  runtimeDaemonUpdatedAt,
  onDiscover,
  onHealthCheck,
  onRefreshRuntimeDaemon,
  onStartRuntimeDaemon,
  onRestartRuntimeDaemon,
  onStopRuntimeDaemon,
  onNavigate,
}: RuntimeOverviewPageProps) {
  const capabilityStatuses = useMemo(() => deriveCapabilityStatuses(state), [state]);
  const installedModelCount = state.localRuntime.models.filter(
    (model) => model.status !== 'removed',
  ).length;
  const activeModelCount = state.localRuntime.models.filter(
    (model) => model.status === 'active',
  ).length;
  const healthyConnectorCount = state.connectors.filter(
    (connector) => connector.status === 'healthy',
  ).length;
  const daemonRunning = runtimeDaemonStatus?.running === true;
  const daemonBusy = runtimeDaemonBusyAction !== null;
  const daemonLabel = daemonRunning ? 'running' : 'stopped';
  const daemonAddress = runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Local Runtime</p>
              <p className="text-xs text-gray-500">Local AI engine and model status</p>
            </div>
            <StatusBadge status={state.localRuntime.status} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <p className="text-[11px] text-gray-500">Installed Models</p>
              <p className="text-lg font-semibold text-gray-900">{installedModelCount}</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <p className="text-[11px] text-gray-500">Active Models</p>
              <p className="text-lg font-semibold text-gray-900">{activeModelCount}</p>
            </div>
          </div>
          {state.localRuntime.lastCheckedAt ? (
            <p className="text-[11px] text-gray-400">
              Last checked: {formatLocaleDateTime(state.localRuntime.lastCheckedAt)}
            </p>
          ) : null}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-500">Runtime Daemon</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                daemonRunning ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {daemonLabel}
              </span>
            </div>
            <p className="text-[11px] text-gray-700">
              gRPC: {daemonAddress}
              {runtimeDaemonStatus?.pid ? ` · pid ${runtimeDaemonStatus.pid}` : ''}
            </p>
            {runtimeDaemonUpdatedAt ? (
              <p className="text-[11px] text-gray-400">
                daemon checked: {formatLocaleDateTime(runtimeDaemonUpdatedAt)}
              </p>
            ) : null}
            {runtimeDaemonError ? (
              <p className="text-[11px] text-red-600">{runtimeDaemonError}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void onRefreshRuntimeDaemon()}>
                {daemonBusy ? 'Working...' : 'Refresh Daemon'}
              </Button>
              <Button variant="secondary" size="sm" disabled={daemonBusy || daemonRunning} onClick={() => void onStartRuntimeDaemon()}>
                Start
              </Button>
              <Button variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void onRestartRuntimeDaemon()}>
                Restart
              </Button>
              <Button variant="secondary" size="sm" disabled={daemonBusy || !daemonRunning} onClick={() => void onStopRuntimeDaemon()}>
                Stop
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={checkingHealth} onClick={() => void onHealthCheck()}>
              {checkingHealth ? 'Checking...' : 'Health Check'}
            </Button>
            <Button variant="secondary" size="sm" disabled={discovering} onClick={() => void onDiscover()}>
              {discovering ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('models')}>
              Manage Models
            </Button>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Cloud API</p>
              <p className="text-xs text-gray-500">API key connectors for cloud fallback</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <p className="text-[11px] text-gray-500">Connectors</p>
              <p className="text-lg font-semibold text-gray-900">{state.connectors.length}</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <p className="text-[11px] text-gray-500">Healthy</p>
              <p className="text-lg font-semibold text-gray-900">{healthyConnectorCount}</p>
            </div>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
            <p className="text-[11px] text-gray-500">Credential Vault Entries</p>
            <p className="text-sm font-medium text-gray-900">{vaultEntryCount}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('cloud-api')}>
            Configure Connectors
          </Button>
        </Card>
      </div>

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
                    item.localAvailable
                      ? 'text-emerald-900'
                      : item.cloudAvailable
                        ? 'text-amber-900'
                        : 'text-gray-600'
                  }`}>
                    {item.capability}
                  </p>
                  <p className={`text-[11px] ${
                    item.localAvailable
                      ? 'text-emerald-700'
                      : item.cloudAvailable
                        ? 'text-amber-700'
                        : 'text-gray-500'
                  }`}>
                    {source}
                  </p>
                </div>
                {!available ? (
                  <button
                    type="button"
                    onClick={() => onNavigate('models')}
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

      {runtimeDependencyTargets.length > 0 ? (
        <Card className="space-y-3 p-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Active Mods</p>
            <p className="text-xs text-gray-500">
              {registeredRuntimeModIds.length} registered mod{registeredRuntimeModIds.length !== 1 ? 's' : ''}
              {' \u00b7 '}
              {runtimeDependencyTargets.length} with AI dependencies
            </p>
          </div>
          <div className="space-y-1">
            {runtimeDependencyTargets.map((target) => (
              <div
                key={`overview-mod-${target.modId}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{target.modName}</p>
                  <p className="text-[11px] text-gray-500">
                    consume: {target.consumeCapabilities.join(', ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
