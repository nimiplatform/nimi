import { useMemo, useState } from 'react';
import {
  CAPABILITIES_V11,
  type RuntimeConfigStateV11,
  type RuntimeSetupPageIdV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { formatLocaleDateTime } from '@renderer/i18n';
import { Button, Card, StatusBadge } from '../primitives';

type ProvidersPageProps = {
  state: RuntimeConfigStateV11;
  onNavigate?: (pageId: RuntimeSetupPageIdV11) => void;
};

export function ProvidersPage({ state, onNavigate }: ProvidersPageProps) {
  const [nodeMatrixExpanded, setNodeMatrixExpanded] = useState(false);

  const capabilitySummary = useMemo(() => {
    return CAPABILITIES_V11.map((capability) => {
      const localNode = state.localRuntime.nodeMatrix.find(
        (node) => node.capability === capability && node.available,
      );
      const hasLocalModel = state.localRuntime.models.some(
        (model) => model.status === 'active' && model.capabilities.includes(capability),
      );
      const localAvailable = Boolean(localNode) || hasLocalModel;
      const cloudAvailable = state.connectors.some(
        (connector) => connector.status === 'healthy',
      );
      return {
        capability,
        localAvailable,
        cloudAvailable,
        localProvider: localNode?.provider,
      };
    });
  }, [state]);
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
        provider,
        total: 0,
        available: 0,
        reasonCodes: new Set<string>(),
        policyGates: new Set<string>(),
        npuStates: new Set<string>(),
      };
      current.total += 1;
      if (row.available) {
        current.available += 1;
      } else if (row.reasonCode) {
        current.reasonCodes.add(String(row.reasonCode));
      }
      if (row.policyGate) {
        current.policyGates.add(String(row.policyGate));
      }
      const nexaGate = row.providerHints?.nexa;
      if (nexaGate) {
        const hostReady = typeof nexaGate.hostNpuReady === 'boolean' ? nexaGate.hostNpuReady : null;
        const modelCandidate = typeof nexaGate.modelProbeHasNpuCandidate === 'boolean' ? nexaGate.modelProbeHasNpuCandidate : null;
        const policyAllows = typeof nexaGate.policyGateAllowsNpu === 'boolean' ? nexaGate.policyGateAllowsNpu : null;
        const npuUsable = typeof nexaGate.npuUsable === 'boolean' ? nexaGate.npuUsable : null;
        if (hostReady === true && modelCandidate === false) {
          current.npuStates.add('host-ready-but-no-npu-model');
        }
        if (hostReady === false) {
          current.npuStates.add('host-npu-not-ready');
        }
        if (policyAllows === false) {
          current.npuStates.add('npu-policy-denied');
        }
        if (npuUsable === true) {
          current.npuStates.add('npu-usable');
        }
      }
      grouped.set(provider, current);
    }
    return [...grouped.values()].sort((left, right) => left.provider.localeCompare(right.provider));
  }, [sortedNodeMatrix]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Capability Summary</p>
          <p className="text-xs text-gray-500">AI capability availability across local runtime and cloud API.</p>
        </div>
        <div className="space-y-1">
          {capabilitySummary.map((item) => {
            const available = item.localAvailable || item.cloudAvailable;
            const sourceLabel = item.localAvailable
              ? `Available (local-runtime${item.localProvider ? `, ${item.localProvider}` : ''})`
              : item.cloudAvailable
                ? 'Available (cloud API fallback)'
                : 'Unavailable';
            return (
              <div
                key={`cap-summary-${item.capability}`}
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
                    item.localAvailable
                      ? 'text-emerald-900'
                      : item.cloudAvailable
                        ? 'text-amber-900'
                        : 'text-gray-600'
                  }`}>
                    {item.capability}
                  </span>
                  <span className={`ml-2 text-[11px] ${
                    item.localAvailable
                      ? 'text-emerald-700'
                      : item.cloudAvailable
                        ? 'text-amber-700'
                        : 'text-gray-500'
                  }`}>
                    {sourceLabel}
                  </span>
                </div>
                {!available && onNavigate ? (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => onNavigate('models')}>
                      Install Model
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onNavigate('cloud-api')}>
                      Add API Key
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Provider Runtime Status</p>
            <p className="text-xs text-gray-500">Managed LocalAI/Nexa diagnostics without exposing secrets.</p>
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
                {' · '}available={summary.available}/{summary.total}
                {summary.reasonCodes.size > 0
                  ? ` · reasonCodes=${[...summary.reasonCodes].join(',')}`
                  : ''}
                {summary.policyGates.size > 0
                  ? ` · policyGate=${[...summary.policyGates].join(',')}`
                  : ''}
                {summary.npuStates.size > 0
                  ? ` · npuState=${[...summary.npuStates].join(',')}`
                  : ''}
              </p>
            ))}
          </div>
        ) : null}
        {!nodeMatrixExpanded ? null : sortedNodeMatrix.length === 0 ? (
          <p className="text-[11px] text-slate-600">No node availability data. Run Refresh to probe LocalAI runtime.</p>
        ) : (
          <div className="space-y-1">
            {sortedNodeMatrix.map((row) => (
              <div key={`node-matrix-${row.nodeId}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                {(() => {
                  const nexaGate = row.providerHints?.nexa;
                  const hostReady = nexaGate?.hostNpuReady;
                  const modelCandidate = nexaGate?.modelProbeHasNpuCandidate;
                  const policyAllows = nexaGate?.policyGateAllowsNpu;
                  const npuUsable = nexaGate?.npuUsable;
                  const gateReason = String(nexaGate?.gateReason || '').trim();
                  const gateDetail = String(nexaGate?.gateDetail || '').trim();
                  const hasNpuGateEvidence = typeof hostReady === 'boolean'
                    || typeof modelCandidate === 'boolean'
                    || typeof policyAllows === 'boolean'
                    || typeof npuUsable === 'boolean';
                  return (
                    <>
                      <p className="text-[11px] font-medium text-slate-900">
                        {row.capability} · {row.nodeId}
                      </p>
                      <p className="text-[11px] text-slate-700">
                        {row.available ? 'available' : 'unavailable'}
                        {' · '}provider={row.provider || 'localai'}
                        {' · '}adapter={row.adapter}
                        {row.backend ? ` · backend=${row.backend}` : ''}
                      </p>
                      {row.policyGate ? (
                        <p className="text-[11px] text-slate-600">policyGate={row.policyGate}</p>
                      ) : null}
                      {hasNpuGateEvidence ? (
                        <p className="text-[11px] text-slate-600">
                          npuGate: hostReady={String(hostReady)} · modelCandidate={String(modelCandidate)} · policyAllows={String(policyAllows)} · usable={String(npuUsable)}
                        </p>
                      ) : null}
                      {hostReady === true && modelCandidate === false ? (
                        <p className="text-[11px] text-amber-700">NPU intermediate state: host ready but no NPU model candidate from probe.</p>
                      ) : null}
                      {hostReady === false ? (
                        <p className="text-[11px] text-amber-700">NPU intermediate state: host probe not ready.</p>
                      ) : null}
                      {policyAllows === false ? (
                        <p className="text-[11px] text-amber-700">NPU intermediate state: policy gate denied (license/authorization required).</p>
                      ) : null}
                      {gateReason ? (
                        <p className="text-[11px] text-slate-600">gateReason={gateReason}</p>
                      ) : null}
                      {gateDetail ? (
                        <p className="text-[11px] text-slate-600">gateDetail={gateDetail}</p>
                      ) : null}
                      {!row.available && row.reasonCode ? (
                        <p className="text-[11px] text-amber-700">reason={row.reasonCode}</p>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
