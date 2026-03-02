import { useMemo, useState } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import { CAPABILITIES_V11 } from '@renderer/features/runtime-config/state/types';
import { desktopBridge } from '@renderer/bridge';
import { formatLocaleDateTime } from '@renderer/i18n';
import { RuntimeHealthSection } from '../panels/setup/audit-sections/runtime-health-section.js';
import { GlobalAuditSection } from '../panels/setup/audit-sections/global-audit-section.js';
import { UsageStatsSection } from '../panels/setup/audit-sections/usage-stats-section.js';
import { LocalDebugSection } from '../panels/setup/audit-sections/local-debug-section.js';
import { useGlobalAuditData } from '../panels/setup/use-global-audit-data.js';
import { ExternalAgentAccessPanel } from '../panels/setup/external-agent-access';
import type { RuntimeConfigPanelControllerModel } from '../runtime-config-panel-types';
import { Button, Card, Input, StatusBadge } from '../panels/primitives';

type RuntimePageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function RuntimePage({ model, state }: RuntimePageProps) {
  const auditData = useGlobalAuditData(true);
  const [nodeMatrixExpanded, setNodeMatrixExpanded] = useState(false);

  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const canManageDaemon = desktopBridge.hasTauriInvoke();

  // Capability summary
  const capabilitySummary = useMemo(() => {
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
  }, [state]);

  // Node matrix
  const sortedNodeMatrix = useMemo(
    () => [...(state.localRuntime.nodeMatrix || [])].sort((left, right) => (
      String(left.capability || '').localeCompare(String(right.capability || ''))
      || String(left.nodeId || '').localeCompare(String(right.nodeId || ''))
    )),
    [state.localRuntime.nodeMatrix],
  );

  const providerStatusSummary = useMemo(() => {
    const grouped = new Map<string, {
      provider: string;
      total: number;
      available: number;
      reasonCodes: Set<string>;
      policyGates: Set<string>;
      npuStates: Set<string>;
    }>();
    for (const row of sortedNodeMatrix) {
      const provider = String(row.provider || 'localai').trim() || 'localai';
      const current = grouped.get(provider) || {
        provider, total: 0, available: 0,
        reasonCodes: new Set<string>(), policyGates: new Set<string>(), npuStates: new Set<string>(),
      };
      current.total += 1;
      if (row.available) current.available += 1;
      else if (row.reasonCode) current.reasonCodes.add(String(row.reasonCode));
      if (row.policyGate) current.policyGates.add(String(row.policyGate));
      const nexaGate = row.providerHints?.nexa;
      if (nexaGate) {
        if (nexaGate.hostNpuReady === true && nexaGate.modelProbeHasNpuCandidate === false) current.npuStates.add('host-ready-but-no-npu-model');
        if (nexaGate.hostNpuReady === false) current.npuStates.add('host-npu-not-ready');
        if (nexaGate.policyGateAllowsNpu === false) current.npuStates.add('npu-policy-denied');
        if (nexaGate.npuUsable === true) current.npuStates.add('npu-usable');
      }
      grouped.set(provider, current);
    }
    return [...grouped.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }, [sortedNodeMatrix]);

  return (
    <div className="space-y-4">
      {/* Endpoint */}
      <Card className="space-y-3 p-4">
        <p className="text-sm font-semibold text-gray-900">Local Runtime Endpoint</p>
        <Input
          label="Endpoint URL"
          value={state.localRuntime.endpoint}
          onChange={(endpoint) => {
            model.updateState((prev) => ({
              ...prev,
              localRuntime: { ...prev.localRuntime, endpoint },
            }));
          }}
          placeholder="http://127.0.0.1:1234/v1"
        />
      </Card>

      {/* Daemon Lifecycle */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Daemon Lifecycle</p>
            <p className="text-xs text-gray-500">Manage the local AI runtime daemon process.</p>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            daemonRunning ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {daemonRunning ? 'running' : 'stopped'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 md:grid-cols-4">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[11px] text-gray-400">gRPC</p>
            <p className="font-medium">{model.runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371'}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[11px] text-gray-400">PID</p>
            <p className="font-medium">{model.runtimeDaemonStatus?.pid || '-'}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[11px] text-gray-400">Mode</p>
            <p className="font-medium">{model.runtimeDaemonStatus?.launchMode || '-'}</p>
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
          <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy || daemonRunning} onClick={() => void model.startRuntimeDaemon()}>
            Start
          </Button>
          <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy || !daemonRunning} onClick={() => void model.restartRuntimeDaemon()}>
            Restart
          </Button>
          <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy || !daemonRunning} onClick={() => void model.stopRuntimeDaemon()}>
            Stop
          </Button>
        </div>
      </Card>

      {/* Runtime Health */}
      <RuntimeHealthSection
        runtimeHealth={auditData.runtimeHealth}
        providerHealth={auditData.providerHealth}
        loading={auditData.healthLoading}
        error={auditData.healthError}
        onRefresh={() => void auditData.loadHealth()}
      />

      {/* Audit Log */}
      <GlobalAuditSection
        events={auditData.auditEvents}
        loading={auditData.auditLoading}
        error={auditData.auditError}
        hasNextPage={!!auditData.auditNextPageToken}
        filters={auditData.auditFilters}
        onUpdateFilters={auditData.updateAuditFilters}
        onRefresh={() => void auditData.loadAuditEvents()}
        onLoadMore={() => void auditData.loadNextAuditPage()}
        onExport={(format) => void auditData.exportAudit(format)}
      />

      {/* Usage Stats */}
      <UsageStatsSection
        records={auditData.usageRecords}
        loading={auditData.usageLoading}
        error={auditData.usageError}
        hasNextPage={!!auditData.usageNextPageToken}
        filters={auditData.usageFilters}
        summary={auditData.usageSummary}
        onUpdateFilters={auditData.updateUsageFilters}
        onRefresh={() => void auditData.loadUsageStats()}
        onLoadMore={() => void auditData.loadNextUsagePage()}
      />

      {/* EAA */}
      <ExternalAgentAccessPanel />

      {/* Capability Summary + Node Matrix */}
      <Card className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Capability Summary</p>
          <p className="text-xs text-gray-500">AI capability availability across local runtime and cloud API.</p>
        </div>
        <div className="space-y-1">
          {capabilitySummary.map((item) => {
            const sourceLabel = item.localAvailable
              ? `Available (local-runtime${item.localProvider ? `, ${item.localProvider}` : ''})`
              : item.cloudAvailable
                ? 'Available (cloud API fallback)'
                : 'Unavailable';
            return (
              <div
                key={`cap-runtime-${item.capability}`}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                  item.localAvailable
                    ? 'border-emerald-200 bg-emerald-50'
                    : item.cloudAvailable
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div>
                  <span className={`text-sm font-medium ${
                    item.localAvailable ? 'text-emerald-900'
                    : item.cloudAvailable ? 'text-amber-900'
                    : 'text-gray-600'
                  }`}>{item.capability}</span>
                  <span className={`ml-2 text-[11px] ${
                    item.localAvailable ? 'text-emerald-700'
                    : item.cloudAvailable ? 'text-amber-700'
                    : 'text-gray-500'
                  }`}>{sourceLabel}</span>
                </div>
                {!item.localAvailable && !item.cloudAvailable ? (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => model.onChangePage('local')}>
                      Install Model
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => model.onChangePage('cloud')}>
                      Add API Key
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Provider Diagnostics */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Provider Runtime Status</p>
            <p className="text-xs text-gray-500">Managed LocalAI/Nexa diagnostics.</p>
          </div>
          <StatusBadge status={state.localRuntime.status} />
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Last Check</p>
            <p className="text-sm font-medium text-gray-800">
              {state.localRuntime.lastCheckedAt ? formatLocaleDateTime(state.localRuntime.lastCheckedAt) : '-'}
            </p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3 md:col-span-2">
            <p className="text-xs text-gray-500">Detail</p>
            <p className="text-sm font-medium text-gray-800">{state.localRuntime.lastDetail || '-'}</p>
          </div>
        </div>
      </Card>

      {/* Node Matrix */}
      <Card className="space-y-2 p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setNodeMatrixExpanded((prev) => !prev)}
        >
          <p className="text-xs font-semibold text-slate-900">Node Capability Matrix</p>
          <p className="text-[11px] text-gray-500">{nodeMatrixExpanded ? 'Collapse' : 'Expand'}</p>
        </button>
        {providerStatusSummary.length > 0 ? (
          <div className="space-y-1 rounded border border-slate-200 bg-white px-2 py-1.5">
            {providerStatusSummary.map((summary) => (
              <p key={`provider-summary-${summary.provider}`} className="text-[11px] text-slate-700">
                provider={summary.provider}
                {' \u00b7 '}available={summary.available}/{summary.total}
                {summary.reasonCodes.size > 0 ? ` \u00b7 reasonCodes=${[...summary.reasonCodes].join(',')}` : ''}
                {summary.policyGates.size > 0 ? ` \u00b7 policyGate=${[...summary.policyGates].join(',')}` : ''}
                {summary.npuStates.size > 0 ? ` \u00b7 npuState=${[...summary.npuStates].join(',')}` : ''}
              </p>
            ))}
          </div>
        ) : null}
        {!nodeMatrixExpanded ? null : sortedNodeMatrix.length === 0 ? (
          <p className="text-[11px] text-slate-600">No node availability data. Run Refresh to probe LocalAI runtime.</p>
        ) : (
          <div className="space-y-1">
            {sortedNodeMatrix.map((row) => {
              const nexaGate = row.providerHints?.nexa;
              const hasNpuGateEvidence = typeof nexaGate?.hostNpuReady === 'boolean'
                || typeof nexaGate?.modelProbeHasNpuCandidate === 'boolean'
                || typeof nexaGate?.policyGateAllowsNpu === 'boolean'
                || typeof nexaGate?.npuUsable === 'boolean';
              return (
                <div key={`node-matrix-${row.nodeId}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                  <p className="text-[11px] font-medium text-slate-900">{row.capability} · {row.nodeId}</p>
                  <p className="text-[11px] text-slate-700">
                    {row.available ? 'available' : 'unavailable'} · provider={row.provider || 'localai'} · adapter={row.adapter}
                    {row.backend ? ` · backend=${row.backend}` : ''}
                  </p>
                  {row.policyGate ? <p className="text-[11px] text-slate-600">policyGate={row.policyGate}</p> : null}
                  {hasNpuGateEvidence ? (
                    <p className="text-[11px] text-slate-600">
                      npuGate: hostReady={String(nexaGate?.hostNpuReady)} · modelCandidate={String(nexaGate?.modelProbeHasNpuCandidate)} · policyAllows={String(nexaGate?.policyGateAllowsNpu)} · usable={String(nexaGate?.npuUsable)}
                    </p>
                  ) : null}
                  {nexaGate?.hostNpuReady === true && nexaGate?.modelProbeHasNpuCandidate === false ? (
                    <p className="text-[11px] text-amber-700">NPU intermediate state: host ready but no NPU model candidate from probe.</p>
                  ) : null}
                  {nexaGate?.hostNpuReady === false ? (
                    <p className="text-[11px] text-amber-700">NPU intermediate state: host probe not ready.</p>
                  ) : null}
                  {nexaGate?.policyGateAllowsNpu === false ? (
                    <p className="text-[11px] text-amber-700">NPU intermediate state: policy gate denied (license/authorization required).</p>
                  ) : null}
                  {String(nexaGate?.gateReason || '').trim() ? (
                    <p className="text-[11px] text-slate-600">gateReason={String(nexaGate?.gateReason || '').trim()}</p>
                  ) : null}
                  {String(nexaGate?.gateDetail || '').trim() ? (
                    <p className="text-[11px] text-slate-600">gateDetail={String(nexaGate?.gateDetail || '').trim()}</p>
                  ) : null}
                  {!row.available && row.reasonCode ? (
                    <p className="text-[11px] text-amber-700">reason={row.reasonCode}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Local Debug */}
      <LocalDebugSection
        collapsed={!auditData.localDebugExpanded}
        onToggle={auditData.toggleLocalDebug}
      />
    </div>
  );
}
