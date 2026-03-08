import { useMemo, useState } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { CAPABILITIES_V11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { desktopBridge } from '@renderer/bridge';
import { Tooltip } from '@renderer/components/tooltip.js';
import { formatLocaleDateTime } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import { RuntimeHealthSection } from './panels/setup/audit-sections/runtime-health-section.js';
import { GlobalAuditSection } from './panels/setup/audit-sections/global-audit-section.js';
import { UsageStatsSection } from './panels/setup/audit-sections/usage-stats-section.js';
import { LocalDebugSection } from './panels/setup/audit-sections/local-debug-section.js';
import { useGlobalAuditData } from './panels/setup/use-global-audit-data.js';
import { ExternalAgentAccessPanel } from './panels/setup/external-agent-access';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Button, Input, StatusBadge } from './runtime-config-primitives';

// Icon Button Component
function IconButton({
  icon,
  title,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white/90 text-gray-600 transition-colors hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// Plus Icon
function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// Key Icon
function KeyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

type RuntimePageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

// SurfaceCard component matching Overview page style
function SurfaceCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04] ${className}`}>{children}</div>;
}

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
    () =>
      [...(state.localRuntime.nodeMatrix || [])].sort(
        (left, right) =>
          String(left.capability || '').localeCompare(String(right.capability || '')) ||
          String(left.nodeId || '').localeCompare(String(right.nodeId || '')),
      ),
    [state.localRuntime.nodeMatrix],
  );

  const providerStatusSummary = useMemo(() => {
    const grouped = new Map<
      string,
      {
        provider: string;
        total: number;
        available: number;
        reasonCodes: Set<string>;
        policyGates: Set<string>;
        npuStates: Set<string>;
      }
    >();
    for (const row of sortedNodeMatrix) {
      const provider = String(row.provider || 'localai').trim() || 'localai';
      const current = grouped.get(provider) || {
        provider,
        total: 0,
        available: 0,
        reasonCodes: new Set<string>(),
        policyGates: new Set<string>(),
        npuStates: new Set<string>(),
      };
      current.total += 1;
      if (row.available) current.available += 1;
      else if (row.reasonCode) current.reasonCodes.add(String(row.reasonCode));
      if (row.policyGate) current.policyGates.add(String(row.policyGate));
      const nexaGate = row.providerHints?.nexa;
      if (nexaGate) {
        if (nexaGate.hostNpuReady === true && nexaGate.modelProbeHasNpuCandidate === false)
          current.npuStates.add('host-ready-but-no-npu-model');
        if (nexaGate.hostNpuReady === false) current.npuStates.add('host-npu-not-ready');
        if (nexaGate.policyGateAllowsNpu === false) current.npuStates.add('npu-policy-denied');
        if (nexaGate.npuUsable === true) current.npuStates.add('npu-usable');
      }
      grouped.set(provider, current);
    }
    return [...grouped.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }, [sortedNodeMatrix]);

  return (
    <div className="space-y-8">
      {/* Endpoint */}
      <section>
        <SectionTitle description="Local runtime endpoint configuration.">Local Runtime Endpoint</SectionTitle>
        <SurfaceCard className="mt-3 p-5">
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
        </SurfaceCard>
      </section>

      {/* Daemon Lifecycle */}
      <section>
        <SectionTitle description="Manage the local AI runtime daemon process.">Daemon Lifecycle</SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">Local AI runtime daemon status</div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                daemonRunning ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {daemonRunning ? 'running' : 'stopped'}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div
              className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>gRPC</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>
                {model.runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371'}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>PID</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>
                {model.runtimeDaemonStatus?.pid || '-'}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>Mode</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>
                {model.runtimeDaemonStatus?.launchMode || '-'}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>Last check</p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>
                {model.runtimeDaemonUpdatedAt ? formatLocaleDateTime(model.runtimeDaemonUpdatedAt) : '-'}
              </p>
            </div>
          </div>

          {model.runtimeDaemonError ? <p className="mt-3 text-xs text-red-600">{model.runtimeDaemonError}</p> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
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
        </SurfaceCard>
      </section>

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
      <section>
        <SectionTitle description="AI capability availability across local runtime and cloud API.">
          Capability Summary
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {capabilitySummary.map((item) => {
              const sourceLabel = item.localAvailable
                ? `local-runtime${item.localProvider ? ` (${item.localProvider})` : ''}`
                : item.cloudAvailable
                  ? 'cloud API fallback'
                  : 'unavailable';
              const toneClass = item.localAvailable
                ? {
                    shell: 'bg-mint-50/60 ring-1 ring-mint-100',
                    title: 'text-gray-900',
                    meta: 'text-mint-700',
                  }
                : item.cloudAvailable
                  ? {
                      shell: 'bg-amber-50/80 ring-1 ring-amber-100',
                      title: 'text-gray-900',
                      meta: 'text-amber-700',
                    }
                  : {
                      shell: 'bg-[#F7F9FC] ring-1 ring-black/5',
                      title: 'text-gray-800',
                      meta: 'text-gray-500',
                    };
              return (
                <div
                  key={`cap-runtime-${item.capability}`}
                  className={`rounded-2xl p-4 ${toneClass.shell}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${toneClass.title}`}>
                        {item.capability}
                      </p>
                      <p className={`mt-1 text-[11px] ${toneClass.meta}`}>
                        {sourceLabel}
                      </p>
                    </div>
                    {!item.localAvailable && !item.cloudAvailable ? (
                      <div className="flex items-center gap-1.5">
                        <IconButton
                          icon={<PlusIcon />}
                          title="Install Model"
                          onClick={() => model.onChangePage('local')}
                        />
                        <IconButton
                          icon={<KeyIcon />}
                          title="Add API Key"
                          onClick={() => model.onChangePage('cloud')}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      </section>

      {/* Provider Diagnostics */}
      <section>
        <SectionTitle description="Managed LocalAI/Nexa diagnostics.">Provider Runtime Status</SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-500">Local runtime provider status</div>
            <StatusBadge status={state.localRuntime.status} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-[#F7F9FC] p-3 ring-1 ring-black/5">
              <p className="text-xs text-gray-500">Last Check</p>
              <p className="text-sm font-medium text-gray-800">
                {state.localRuntime.lastCheckedAt ? formatLocaleDateTime(state.localRuntime.lastCheckedAt) : '-'}
              </p>
            </div>
            <div className="rounded-xl bg-[#F7F9FC] p-3 ring-1 ring-black/5 md:col-span-2">
              <p className="text-xs text-gray-500">Detail</p>
              <p className="text-sm font-medium text-gray-800">{state.localRuntime.lastDetail || '-'}</p>
            </div>
          </div>
        </SurfaceCard>
      </section>

      {/* Node Matrix */}
      <section>
        <SectionTitle description="Detailed node capability availability matrix.">Node Capability Matrix</SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left mb-3"
            onClick={() => setNodeMatrixExpanded((prev) => !prev)}
          >
            <span className="text-sm font-medium text-gray-900">Node Matrix</span>
            <span className="text-xs text-gray-500">{nodeMatrixExpanded ? 'Collapse' : 'Expand'}</span>
          </button>
          {providerStatusSummary.length > 0 ? (
            <div className="mb-3 space-y-2 rounded-xl bg-[#F7F9FC] p-3 ring-1 ring-black/5">
              {providerStatusSummary.map((summary) => (
                <p key={`provider-summary-${summary.provider}`} className="text-[11px] text-gray-700">
                  provider={summary.provider}
                  {' · '}available={summary.available}/{summary.total}
                  {summary.reasonCodes.size > 0 ? ` · reasonCodes=${[...summary.reasonCodes].join(',')}` : ''}
                  {summary.policyGates.size > 0 ? ` · policyGate=${[...summary.policyGates].join(',')}` : ''}
                  {summary.npuStates.size > 0 ? ` · npuState=${[...summary.npuStates].join(',')}` : ''}
                </p>
              ))}
            </div>
          ) : null}
          {!nodeMatrixExpanded ? null : sortedNodeMatrix.length === 0 ? (
            <p className="text-sm text-gray-500">No node availability data. Run Refresh to probe LocalAI runtime.</p>
          ) : (
            <div className="space-y-2">
              {sortedNodeMatrix.map((row) => {
                const nexaGate = row.providerHints?.nexa;
                const hasNpuGateEvidence =
                  typeof nexaGate?.hostNpuReady === 'boolean' ||
                  typeof nexaGate?.modelProbeHasNpuCandidate === 'boolean' ||
                  typeof nexaGate?.policyGateAllowsNpu === 'boolean' ||
                  typeof nexaGate?.npuUsable === 'boolean';
                return (
                  <div key={`node-matrix-${row.nodeId}`} className="rounded-xl bg-[#F7F9FC] p-3 ring-1 ring-black/5">
                    <p className="text-xs font-medium text-gray-900">
                      {row.capability} · {row.nodeId}
                    </p>
                    <p className="text-xs text-gray-700">
                      {row.available ? 'available' : 'unavailable'} · provider={row.provider || 'localai'} · adapter={
                        row.adapter
                      }
                      {row.backend ? ` · backend=${row.backend}` : ''}
                    </p>
                    {row.policyGate ? <p className="text-xs text-gray-600">policyGate={row.policyGate}</p> : null}
                    {hasNpuGateEvidence ? (
                      <p className="text-xs text-gray-600">
                        npuGate: hostReady={String(nexaGate?.hostNpuReady)} · modelCandidate=
                        {String(nexaGate?.modelProbeHasNpuCandidate)} · policyAllows=
                        {String(nexaGate?.policyGateAllowsNpu)} · usable={String(nexaGate?.npuUsable)}
                      </p>
                    ) : null}
                    {nexaGate?.hostNpuReady === true && nexaGate?.modelProbeHasNpuCandidate === false ? (
                      <p className="text-xs text-amber-700">
                        NPU intermediate state: host ready but no NPU model candidate from probe.
                      </p>
                    ) : null}
                    {nexaGate?.hostNpuReady === false ? (
                      <p className="text-xs text-amber-700">NPU intermediate state: host probe not ready.</p>
                    ) : null}
                    {nexaGate?.policyGateAllowsNpu === false ? (
                      <p className="text-xs text-amber-700">
                        NPU intermediate state: policy gate denied (license/authorization required).
                      </p>
                    ) : null}
                    {String(nexaGate?.gateReason || '').trim() ? (
                      <p className="text-xs text-gray-600">
                        gateReason={String(nexaGate?.gateReason || '').trim()}
                      </p>
                    ) : null}
                    {String(nexaGate?.gateDetail || '').trim() ? (
                      <p className="text-xs text-gray-600">
                        gateDetail={String(nexaGate?.gateDetail || '').trim()}
                      </p>
                    ) : null}
                    {!row.available && row.reasonCode ? (
                      <p className="text-xs text-amber-700">reason={row.reasonCode}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </section>

      {/* Local Debug */}
      <LocalDebugSection collapsed={!auditData.localDebugExpanded} onToggle={auditData.toggleLocalDebug} />
    </div>
  );
}
