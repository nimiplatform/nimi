import { useCallback, useEffect, useMemo, useState } from 'react';
import { localAiRuntime, type LocalAiAuditEvent } from '@runtime/local-ai-runtime';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import { desktopBridge, type RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import { formatLocaleDateTime } from '@renderer/i18n';
import {
  buildAuditDiagnosticsText,
  filterAuditEvents,
  resolveAuditDetail,
  resolveAuditModality,
  resolveAuditPolicyGate,
  resolveAuditReasonCode,
  resolveAuditSource,
  summarizeAuditReasons,
} from '../domain/diagnostics/audit-view-model';
import { Button, Card } from './primitives';

type DiagnosticsPanelProps = {
  state: RuntimeConfigStateV11;
  runtimeSectionMeta: Record<string, { name: string; description: string }>;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  vaultEntryCount: number;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
  compact?: boolean;
};

type RuntimeDaemonAction = 'start' | 'restart' | 'stop';

function toIsoTimeRangeValue(value: string): string | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function DiagnosticsPanel({
  state,
  runtimeSectionMeta,
  selectedConnector,
  vaultEntryCount,
  updateState,
  compact,
}: DiagnosticsPanelProps) {
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [auditEvents, setAuditEvents] = useState<LocalAiAuditEvent[]>([]);
  const [auditEventType, setAuditEventType] = useState('all');
  const [auditSource, setAuditSource] = useState('all');
  const [auditModality, setAuditModality] = useState('all');
  const [auditReasonCodeQuery, setAuditReasonCodeQuery] = useState('');
  const [auditTimeFrom, setAuditTimeFrom] = useState('');
  const [auditTimeTo, setAuditTimeTo] = useState('');
  const [daemonStatus, setDaemonStatus] = useState<RuntimeBridgeDaemonStatus | null>(null);
  const [daemonBusyAction, setDaemonBusyAction] = useState<RuntimeDaemonAction | null>(null);
  const [daemonError, setDaemonError] = useState('');
  const [daemonUpdatedAt, setDaemonUpdatedAt] = useState<string | null>(null);

  const applyDaemonStatusToRuntimeState = useCallback((
    status: RuntimeBridgeDaemonStatus,
    mode: 'poll' | 'action',
  ) => {
    const checkedAt = new Date().toISOString();
    const stoppedDetail = `runtime daemon stopped (${status.grpcAddr}) · mode=${status.launchMode}${status.lastError ? `: ${status.lastError}` : ''}`;
    const runningDetail = `runtime daemon running (${status.grpcAddr}) · mode=${status.launchMode}`;

    updateState((previous) => {
      if (!status.running) {
        if (
          previous.localRuntime.status === 'unreachable'
          && previous.localRuntime.lastDetail === stoppedDetail
        ) {
          return previous;
        }
        return {
          ...previous,
          localRuntime: {
            ...previous.localRuntime,
            status: 'unreachable',
            lastCheckedAt: checkedAt,
            lastDetail: stoppedDetail,
          },
        };
      }

      if (
        mode === 'action'
        || previous.localRuntime.status === 'unreachable'
      ) {
        return {
          ...previous,
          localRuntime: {
            ...previous.localRuntime,
            status: 'idle',
            lastCheckedAt: checkedAt,
            lastDetail: runningDetail,
          },
        };
      }

      return previous;
    });
  }, [updateState]);

  const loadDaemonStatus = useCallback(async () => {
    try {
      const status = await desktopBridge.getRuntimeBridgeStatus();
      setDaemonStatus(status);
      setDaemonUpdatedAt(new Date().toISOString());
      setDaemonError('');
      applyDaemonStatusToRuntimeState(status, 'poll');
    } catch (error) {
      setDaemonError(error instanceof Error ? error.message : String(error || 'runtime daemon status failed'));
    }
  }, [applyDaemonStatusToRuntimeState]);

  const runDaemonAction = useCallback(async (action: RuntimeDaemonAction) => {
    setDaemonBusyAction(action);
    setDaemonError('');
    try {
      const status = action === 'start'
        ? await desktopBridge.startRuntimeBridge()
        : action === 'restart'
          ? await desktopBridge.restartRuntimeBridge()
          : await desktopBridge.stopRuntimeBridge();
      setDaemonStatus(status);
      setDaemonUpdatedAt(new Date().toISOString());
      applyDaemonStatusToRuntimeState(status, 'action');
    } catch (error) {
      setDaemonError(error instanceof Error ? error.message : String(error || `runtime daemon ${action} failed`));
    } finally {
      setDaemonBusyAction(null);
    }
  }, [applyDaemonStatusToRuntimeState]);

  const loadAudits = useCallback(async (overrides?: Partial<{
    eventType: string;
    source: string;
    modality: string;
    reasonCode: string;
    timeFrom: string;
    timeTo: string;
  }>) => {
    const eventType = overrides?.eventType ?? auditEventType;
    const source = overrides?.source ?? auditSource;
    const modality = overrides?.modality ?? auditModality;
    const reasonCode = (overrides?.reasonCode ?? auditReasonCodeQuery).trim();
    const timeFrom = toIsoTimeRangeValue(overrides?.timeFrom ?? auditTimeFrom);
    const timeTo = toIsoTimeRangeValue(overrides?.timeTo ?? auditTimeTo);
    setLoadingAudits(true);
    try {
      const audits = await localAiRuntime.listAudits({
        limit: 120,
        eventType: eventType && eventType !== 'all' ? eventType : undefined,
        source: source && source !== 'all' ? source : undefined,
        modality: modality && modality !== 'all' ? modality : undefined,
        reasonCode: reasonCode || undefined,
        timeRange: timeFrom || timeTo
          ? { from: timeFrom, to: timeTo }
          : undefined,
      });
      setAuditEvents(audits);
    } finally {
      setLoadingAudits(false);
    }
  }, [auditEventType, auditModality, auditReasonCodeQuery, auditSource, auditTimeFrom, auditTimeTo]);

  useEffect(() => {
    if (state.diagnosticsCollapsed) return;
    void loadAudits();
    const timer = setInterval(() => {
      void loadAudits();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [loadAudits, state.diagnosticsCollapsed]);

  useEffect(() => {
    if (state.diagnosticsCollapsed) return;
    void loadDaemonStatus();
    const timer = setInterval(() => {
      void loadDaemonStatus();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [loadDaemonStatus, state.diagnosticsCollapsed]);

  const activeSectionMeta = runtimeSectionMeta[state.activeSection] || {
    name: state.activeSection,
    description: '',
  };
  const filteredAudits = useMemo(
    () => filterAuditEvents({
      audits: auditEvents,
      eventType: auditEventType,
      source: auditSource,
      modality: auditModality,
      reasonCodeQuery: auditReasonCodeQuery,
      timeRange: {
        from: toIsoTimeRangeValue(auditTimeFrom),
        to: toIsoTimeRangeValue(auditTimeTo),
      },
    }),
    [auditEventType, auditEvents, auditModality, auditReasonCodeQuery, auditSource, auditTimeFrom, auditTimeTo],
  );
  const reasonBuckets = useMemo(
    () => summarizeAuditReasons(filteredAudits),
    [filteredAudits],
  );
  const canManageDaemon = desktopBridge.hasTauriInvoke();
  const daemonRunning = daemonStatus?.running === true;

  if (compact) {
    const recentAudits = filteredAudits.slice(0, 5);
    return (
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Recent Audit Events</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateState((prev) => ({
              ...prev,
              diagnosticsCollapsed: false,
            }))}
          >
            View All
          </Button>
        </div>
        {recentAudits.length === 0 ? (
          <p className="text-xs text-gray-500">No audit events.</p>
        ) : (
          recentAudits.map((event) => (
            <div key={event.id} className="flex items-center justify-between rounded-md border border-gray-100 px-2.5 py-1.5">
              <div>
                <p className="text-[11px] font-medium text-gray-900">{event.eventType}</p>
                <p className="text-[10px] text-gray-500">{event.occurredAt}</p>
              </div>
              <p className="text-[10px] text-gray-500">{resolveAuditSource(event)}</p>
            </div>
          ))
        )}
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Diagnostics</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => updateState((prev) => ({
            ...prev,
            diagnosticsCollapsed: !prev.diagnosticsCollapsed,
          }))}
        >
          {state.diagnosticsCollapsed ? 'Expand' : 'Collapse'}
        </Button>
      </div>

      {!state.diagnosticsCollapsed ? (
        <div className="grid grid-cols-1 gap-2 text-sm text-gray-700 md:grid-cols-2">
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Active Section</p>
            <p className="font-medium">{activeSectionMeta.name}</p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Active Setup Page</p>
            <p className="font-medium">{state.activeSetupPage}</p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3 md:col-span-2">
            <p className="text-xs text-gray-500">Selected Source</p>
            <p className="font-medium">{state.selectedSource}</p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Local Runtime Detail</p>
            <p className="text-xs text-gray-700">{state.localRuntime.lastDetail || '-'}</p>
            <p className="mt-1 text-[11px] text-gray-400">{state.localRuntime.lastCheckedAt ? formatLocaleDateTime(state.localRuntime.lastCheckedAt) : '-'}</p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Connector Detail</p>
            <p className="text-xs text-gray-700">{selectedConnector?.lastDetail || '-'}</p>
            <p className="mt-1 text-[11px] text-gray-400">{selectedConnector?.lastCheckedAt ? formatLocaleDateTime(selectedConnector.lastCheckedAt) : '-'}</p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">API Connectors</p>
            <p className="font-medium">{state.connectors.length}</p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Vault Entries</p>
            <p className="font-medium">{vaultEntryCount}</p>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50 p-3 md:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Runtime Daemon</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                daemonRunning ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {daemonRunning ? 'running' : 'stopped'}
              </span>
            </div>
            <p className="text-xs text-gray-700">
              gRPC: {daemonStatus?.grpcAddr || '127.0.0.1:46371'}
              {daemonStatus?.pid ? ` · pid ${daemonStatus.pid}` : ''}
              {daemonStatus?.managed ? ' · managed' : ''}
              {daemonStatus?.launchMode ? ` · mode ${daemonStatus.launchMode}` : ''}
            </p>
            <p className="text-[11px] text-gray-500">
              last update: {daemonUpdatedAt ? formatLocaleDateTime(daemonUpdatedAt) : '-'}
            </p>
            {daemonError ? (
              <p className="text-[11px] text-red-600">{daemonError}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={daemonBusyAction !== null}
                onClick={() => void loadDaemonStatus()}
              >
                {daemonBusyAction === null ? 'Refresh' : 'Working...'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canManageDaemon || daemonBusyAction !== null || daemonRunning}
                onClick={() => void runDaemonAction('start')}
              >
                Start
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canManageDaemon || daemonBusyAction !== null || !daemonRunning}
                onClick={() => void runDaemonAction('restart')}
              >
                Restart
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canManageDaemon || daemonBusyAction !== null || !daemonRunning}
                onClick={() => void runDaemonAction('stop')}
              >
                Stop
              </Button>
            </div>
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-white p-3 md:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-900">Local AI Audit Timeline</p>
              <div className="flex items-center gap-2">
                <select
                  value={auditEventType}
                  onChange={(event) => {
                    const next = event.target.value;
                    setAuditEventType(next);
                    void loadAudits({ eventType: next });
                  }}
                  className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
                >
                  <option value="all">all</option>
                  <option value="inference_invoked">inference_invoked</option>
                  <option value="inference_failed">inference_failed</option>
                  <option value="fallback_to_token_api">fallback_to_token_api</option>
                  <option value="engine_started">engine_started</option>
                  <option value="engine_stopped">engine_stopped</option>
                  <option value="model_catalog_search_invoked">model_catalog_search_invoked</option>
                  <option value="model_catalog_search_failed">model_catalog_search_failed</option>
                  <option value="engine_pack_download_started">engine_pack_download_started</option>
                  <option value="engine_pack_download_completed">engine_pack_download_completed</option>
                  <option value="engine_pack_download_failed">engine_pack_download_failed</option>
                  <option value="runtime_model_ready_after_install">runtime_model_ready_after_install</option>
                  <option value="dependency_resolve_invoked">dependency_resolve_invoked</option>
                  <option value="dependency_resolve_failed">dependency_resolve_failed</option>
                  <option value="dependency_apply_started">dependency_apply_started</option>
                  <option value="dependency_apply_completed">dependency_apply_completed</option>
                  <option value="dependency_apply_failed">dependency_apply_failed</option>
                  <option value="service_install_started">service_install_started</option>
                  <option value="service_install_completed">service_install_completed</option>
                  <option value="service_install_failed">service_install_failed</option>
                  <option value="node_catalog_listed">node_catalog_listed</option>
                </select>
                <select
                  value={auditSource}
                  onChange={(event) => {
                    const next = event.target.value;
                    setAuditSource(next);
                    void loadAudits({ source: next });
                  }}
                  className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
                >
                  <option value="all">all sources</option>
                  <option value="local-runtime">local-runtime</option>
                  <option value="token-api">token-api</option>
                </select>
                <select
                  value={auditModality}
                  onChange={(event) => {
                    const next = event.target.value;
                    setAuditModality(next);
                    void loadAudits({ modality: next });
                  }}
                  className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
                >
                  <option value="all">all modalities</option>
                  <option value="chat">chat</option>
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="tts">tts</option>
                  <option value="stt">stt</option>
                  <option value="embedding">embedding</option>
                </select>
                <Button variant="secondary" size="sm" disabled={loadingAudits} onClick={() => void loadAudits()}>
                  {loadingAudits ? 'Loading...' : 'Refresh'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const text = buildAuditDiagnosticsText(filteredAudits);
                    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(text);
                    }
                  }}
                >
                  Copy
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (typeof document === 'undefined') return;
                    const text = JSON.stringify(filteredAudits, null, 2);
                    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `local-ai-audits-${new Date().toISOString()}.json`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                value={auditReasonCodeQuery}
                onChange={(event) => {
                  const next = event.target.value;
                  setAuditReasonCodeQuery(next);
                  void loadAudits({ reasonCode: next });
                }}
                placeholder="Filter reasonCode..."
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
              />
              <input
                type="datetime-local"
                value={auditTimeFrom}
                onChange={(event) => {
                  const next = event.target.value;
                  setAuditTimeFrom(next);
                  void loadAudits({ timeFrom: next });
                }}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
              />
              <input
                type="datetime-local"
                value={auditTimeTo}
                onChange={(event) => {
                  const next = event.target.value;
                  setAuditTimeTo(next);
                  void loadAudits({ timeTo: next });
                }}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
              />
            </div>
            {reasonBuckets.length > 0 ? (
              <p className="text-[11px] text-gray-600">
                Reason Buckets: {reasonBuckets.map((item) => `${item.reasonCode}(${item.count})`).join(', ')}
              </p>
            ) : null}
            <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200">
              {filteredAudits.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-500">No audit events.</p>
              ) : (
                filteredAudits.map((event) => (
                  <div key={event.id} className="border-b border-gray-100 px-3 py-2 last:border-b-0">
                    <p className="text-[11px] font-medium text-gray-900">{event.eventType}</p>
                    <p className="text-[11px] text-gray-600">{event.occurredAt}</p>
                    <p className="text-[11px] text-gray-600">source={resolveAuditSource(event)}</p>
                    <p className="text-[11px] text-gray-600">modality={resolveAuditModality(event)}</p>
                    <p className="text-[11px] text-gray-600">reasonCode={resolveAuditReasonCode(event)}</p>
                    <p className="text-[11px] text-gray-600">policyGate={resolveAuditPolicyGate(event)}</p>
                    <p className="text-[11px] text-gray-600">detail={resolveAuditDetail(event)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
