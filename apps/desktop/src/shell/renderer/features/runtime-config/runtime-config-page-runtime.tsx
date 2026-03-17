import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { CAPABILITIES_V11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { desktopBridge } from '@renderer/bridge';
import { Tooltip } from '@renderer/components/tooltip.js';
import { formatLocaleDateTime } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import { RuntimeHealthSection } from './runtime-config-runtime-health-section.js';
import { GlobalAuditSection } from './runtime-config-global-audit-section.js';
import { UsageStatsSection } from './runtime-config-usage-stats-section.js';
import { LocalDebugSection } from './runtime-config-local-debug-section.js';
import { useGlobalAuditData } from './runtime-config-use-global-audit-data.js';
import { ExternalAgentAccessPanel } from './runtime-config-external-agent-access';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
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
  const { t } = useTranslation();
  const auditData = useGlobalAuditData(true);
  const [nodeMatrixExpanded, setNodeMatrixExpanded] = useState(false);

  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const canManageDaemon = desktopBridge.hasTauriInvoke();
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  });

  // Capability summary
  const capabilitySummary = useMemo(() => {
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
  }, [state]);

  // Node matrix
  const sortedNodeMatrix = useMemo(
    () =>
      [...(state.local.nodeMatrix || [])].sort(
        (left, right) =>
          String(left.capability || '').localeCompare(String(right.capability || '')) ||
          String(left.nodeId || '').localeCompare(String(right.nodeId || '')),
      ),
    [state.local.nodeMatrix],
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
      const provider = String(row.provider || 'llama').trim() || 'llama';
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
      grouped.set(provider, current);
    }
    return [...grouped.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }, [sortedNodeMatrix]);

  return (
    <div className="space-y-8">
      {/* Endpoint */}
      <section>
        <SectionTitle description={t('runtimeConfig.runtime.localEndpointDescription', { defaultValue: 'Local runtime endpoint configuration.' })}>
          {t('runtimeConfig.runtime.localEndpoint', { defaultValue: 'Local Runtime Endpoint' })}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <Input
            label={t('runtimeConfig.runtime.endpointUrl', { defaultValue: 'Endpoint URL' })}
            value={state.local.endpoint}
            onChange={(endpoint) => {
              model.updateState((prev) => ({
                ...prev,
                local: { ...prev.local, endpoint },
              }));
            }}
            placeholder={t('runtimeConfig.runtime.endpointPlaceholder', { defaultValue: 'http://host:port[/base-path]' })}
          />
        </SurfaceCard>
      </section>

      {/* Daemon Lifecycle */}
      <section>
        <SectionTitle description={t('runtimeConfig.runtime.daemonLifecycleDesc', { defaultValue: 'Manage the local AI runtime daemon process.' })}>
          {t('runtimeConfig.runtime.daemonLifecycle', { defaultValue: 'Daemon Lifecycle' })}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {t('runtimeConfig.runtime.runtimeDaemonStatus', { defaultValue: 'Local AI runtime daemon status' })}
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                daemonRunning ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {daemonRunning
                ? t('runtimeConfig.overview.running', { defaultValue: 'running' })
                : t('runtimeConfig.overview.stopped', { defaultValue: 'stopped' })}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div
              className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>
                {t('runtimeConfig.overview.grpc', { defaultValue: 'gRPC' })}
              </p>
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
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>
                {t('runtimeConfig.runtime.mode', { defaultValue: 'Mode' })}
              </p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>
                {model.runtimeDaemonStatus?.launchMode || '-'}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${daemonRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <p className={`text-xs ${daemonRunning ? 'text-green-600' : 'text-red-600'}`}>
                {t('runtimeConfig.overview.lastCheck', { defaultValue: 'Last check' })}
              </p>
              <p className={`text-sm font-medium ${daemonRunning ? 'text-green-900' : 'text-red-900'}`}>
                {model.runtimeDaemonUpdatedAt ? formatLocaleDateTime(model.runtimeDaemonUpdatedAt) : '-'}
              </p>
            </div>
          </div>

          {daemonIssue ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-sm font-medium text-amber-900">{daemonIssue.title}</p>
              <p className="mt-1 text-xs text-amber-800">{daemonIssue.message}</p>
              <p className="mt-2 text-[11px] text-amber-700">{daemonIssue.rawError}</p>
            </div>
          ) : model.runtimeDaemonError ? <p className="mt-3 text-xs text-red-600">{model.runtimeDaemonError}</p> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void model.refreshRuntimeDaemonStatus()}>
              {daemonBusy
                ? t('runtimeConfig.overview.working', { defaultValue: 'Working...' })
                : t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy || daemonRunning} onClick={() => void model.startRuntimeDaemon()}>
              {t('runtimeConfig.overview.start', { defaultValue: 'Start' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy || !daemonRunning} onClick={() => void model.restartRuntimeDaemon()}>
              {t('runtimeConfig.overview.restart', { defaultValue: 'Restart' })}
            </Button>
            <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy || !daemonRunning} onClick={() => void model.stopRuntimeDaemon()}>
              {t('runtimeConfig.overview.stop', { defaultValue: 'Stop' })}
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
        streamConnected={auditData.healthStreamConnected}
        streamError={auditData.healthStreamError}
        stale={auditData.healthStale}
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
        <SectionTitle description={t('runtimeConfig.runtime.capabilitySummaryDesc', { defaultValue: 'AI capability availability across local runtime and cloud API.' })}>
          {t('runtimeConfig.runtime.capabilitySummary', { defaultValue: 'Capability Summary' })}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {capabilitySummary.map((item) => {
              const sourceLabel = item.localAvailable
                ? t('runtimeConfig.overview.capabilitySourceLocal', {
                  providerSuffix: item.localProvider ? ` (${item.localProvider})` : '',
                  defaultValue: 'local{{providerSuffix}}',
                })
                : item.cloudAvailable
                  ? t('runtimeConfig.overview.capabilitySourceCloudFallback', { defaultValue: 'cloud API fallback' })
                  : t('runtimeConfig.overview.capabilitySourceUnavailable', { defaultValue: 'unavailable' });
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
                          title={t('runtimeConfig.runtime.installModel', { defaultValue: 'Install Model' })}
                          onClick={() => model.onChangePage('local')}
                        />
                        <IconButton
                          icon={<KeyIcon />}
                          title={t('runtimeConfig.runtime.addApiKey', { defaultValue: 'Add API Key' })}
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
        <SectionTitle description={t('runtimeConfig.runtime.providerStatusDesc', { defaultValue: 'Managed llama/media diagnostics.' })}>
          {t('runtimeConfig.runtime.providerStatus', { defaultValue: 'Provider Runtime Status' })}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-500">
              {t('runtimeConfig.runtime.localRuntimeProviderStatus', { defaultValue: 'Local runtime provider status' })}
            </div>
            <StatusBadge status={state.local.status} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-[#F7F9FC] p-3 ring-1 ring-black/5">
              <p className="text-xs text-gray-500">{t('runtimeConfig.runtime.lastCheckLabel', { defaultValue: 'Last Check' })}</p>
              <p className="text-sm font-medium text-gray-800">
                {state.local.lastCheckedAt ? formatLocaleDateTime(state.local.lastCheckedAt) : '-'}
              </p>
            </div>
            <div className="rounded-xl bg-[#F7F9FC] p-3 ring-1 ring-black/5 md:col-span-2">
              <p className="text-xs text-gray-500">{t('runtimeConfig.runtime.detail', { defaultValue: 'Detail' })}</p>
              <p className="text-sm font-medium text-gray-800">{state.local.lastDetail || '-'}</p>
            </div>
          </div>
        </SurfaceCard>
      </section>

      {/* Node Matrix */}
      <section>
        <SectionTitle description={t('runtimeConfig.runtime.nodeMatrixDesc', { defaultValue: 'Detailed node capability availability matrix.' })}>
          {t('runtimeConfig.runtime.nodeMatrix', { defaultValue: 'Node Capability Matrix' })}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left mb-3"
            onClick={() => setNodeMatrixExpanded((prev) => !prev)}
          >
            <span className="text-sm font-medium text-gray-900">
              {t('runtimeConfig.runtime.nodeMatrixShort', { defaultValue: 'Node Matrix' })}
            </span>
            <span className="text-xs text-gray-500">
              {nodeMatrixExpanded
                ? t('runtimeConfig.runtime.collapse', { defaultValue: 'Collapse' })
                : t('runtimeConfig.runtime.expand', { defaultValue: 'Expand' })}
            </span>
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
            <p className="text-sm text-gray-500">
              {t('runtimeConfig.runtime.noNodeAvailabilityData', {
                defaultValue: 'No node availability data. Run Refresh to probe the local runtime.',
              })}
            </p>
          ) : (
            <div className="space-y-2">
              {sortedNodeMatrix.map((row) => {
                const runtimeSupportClass = String(row.providerHints?.extra?.runtime_support_class || '').trim();
                const runtimeSupportDetail = String(row.providerHints?.extra?.runtime_support_detail || '').trim();
                return (
                  <div key={`node-matrix-${row.nodeId}`} className="rounded-xl bg-[#F7F9FC] p-3 ring-1 ring-black/5">
                    <p className="text-xs font-medium text-gray-900">
                      {row.capability} · {row.nodeId}
                    </p>
                    <p className="text-xs text-gray-700">
                      {row.available ? 'available' : 'unavailable'} · provider={row.provider || 'llama'} · adapter={
                        row.adapter
                      }
                      {row.backend ? ` · backend=${row.backend}` : ''}
                      {runtimeSupportClass ? ` · runtimeSupport=${runtimeSupportClass}` : ''}
                    </p>
                    {runtimeSupportDetail ? (
                      <p className="text-xs text-gray-600">runtimeSupportDetail={runtimeSupportDetail}</p>
                    ) : null}
                    {row.policyGate ? <p className="text-xs text-gray-600">policyGate={row.policyGate}</p> : null}
                    {!row.available && row.reasonCode ? (
                      <p className="text-xs text-amber-700">reason={row.reasonCode}</p>
                    ) : null}
                    {(runtimeSupportClass === 'attached_only' || runtimeSupportClass === 'unsupported') ? (
                      <p className="text-xs text-amber-700">
                        Managed local engine is unavailable on this host. Configure an attached endpoint to use this provider.
                      </p>
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
