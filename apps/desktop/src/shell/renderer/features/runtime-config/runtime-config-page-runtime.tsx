import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectNimiRuntimeRouteCapabilityCoverageList } from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { cn } from '@nimiplatform/kit/ui';
import { RuntimeHealthSection } from './runtime-config-runtime-health-section.js';
import { GlobalAuditSection } from './runtime-config-global-audit-section.js';
import { UsageStatsSection } from './runtime-config-usage-stats-section.js';
import { LocalDebugSection } from './runtime-config-local-debug-section.js';
import { useGlobalAuditData } from './runtime-config-use-global-audit-data.js';
import { ExternalAgentAccessPanel } from './runtime-config-external-agent-access';
import { DelegatedCapabilityControlPanel } from './runtime-config-delegated-capability-panel';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePageShell } from './runtime-config-page-shell';
import { RuntimeOverviewTab } from './runtime-config-runtime-overview-tab';
import { RuntimeNodeCapabilityMatrix } from './runtime-config-runtime-node-matrix';

type RuntimeTabKey = 'overview' | 'health' | 'activity' | 'access';

type RuntimePageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function RuntimePage({ model, state }: RuntimePageProps) {
  const { t } = useTranslation();
  const auditData = useGlobalAuditData(true);
  const [nodeMatrixExpanded, setNodeMatrixExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<RuntimeTabKey>('overview');

  const capabilitySummary = useMemo(() => {
    return projectNimiRuntimeRouteCapabilityCoverageList({
      localNodes: state.local.nodeMatrix,
      localModels: state.local.models,
      connectors: state.connectors,
    });
  }, [state]);

  const sortedNodeMatrix = useMemo(
    () =>
      [...(state.local.nodeMatrix || [])].sort(
        (left, right) =>
          String(left.capability || '').localeCompare(String(right.capability || '')) ||
          String(left.nodeId || '').localeCompare(String(right.nodeId || '')),
      ),
    [state.local.nodeMatrix],
  );

  const availableCapabilityCount = useMemo(
    () => capabilitySummary.filter((item) => item.localAvailable || item.cloudAvailable).length,
    [capabilitySummary],
  );

  const unhealthyProviderCount = useMemo(() => {
    return auditData.providerHealth.filter((snapshot) => {
      const stateValue = String(snapshot.state || '').toLowerCase();
      return stateValue !== '' && stateValue !== 'healthy' && stateValue !== 'idle';
    }).length;
  }, [auditData.providerHealth]);

  const tabs: Array<{ key: RuntimeTabKey; label: string; badge?: number }> = [
    { key: 'overview', label: t('runtimeConfig.runtime.tabOverview', { defaultValue: 'Overview' }) },
    {
      key: 'health',
      label: t('runtimeConfig.runtime.tabHealth', { defaultValue: 'Health' }),
      badge: unhealthyProviderCount > 0 ? unhealthyProviderCount : undefined,
    },
    { key: 'activity', label: t('runtimeConfig.runtime.tabActivity', { defaultValue: 'Activity' }) },
    { key: 'access', label: t('runtimeConfig.runtime.tabAccess', { defaultValue: 'Access' }) },
  ];

  return (
    <RuntimePageShell>
      {/* Tab bar: underline-style, non-sticky, flows with page. */}
      <div className="relative flex items-center gap-7 border-b border-[var(--nimi-border-subtle)] overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={`runtime-tab-${tab.key}`}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'group relative shrink-0 px-0.5 py-2.5 text-sm font-medium transition-all duration-200 ease-out',
                isActive
                  ? 'text-[var(--nimi-text-primary)]'
                  : 'text-[var(--nimi-text-muted)] hover:-translate-y-[1px] hover:text-[var(--nimi-text-primary)]',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {tab.badge ? (
                  <span className={cn(
                    'inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 transition-colors',
                    isActive
                      ? 'bg-[var(--nimi-status-danger)] text-white'
                      : 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
                  )}>
                    {tab.badge}
                  </span>
                ) : null}
              </span>
              {!isActive ? (
                <span className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] origin-center scale-x-0 rounded-full bg-[var(--nimi-text-muted)] opacity-0 transition-all duration-200 ease-out group-hover:scale-x-100 group-hover:opacity-40" />
              ) : (
                <span className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[var(--nimi-action-primary-bg)]" />
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' ? (
        <RuntimeOverviewTab
          model={model}
          capabilitySummary={capabilitySummary}
          availableCapabilityCount={availableCapabilityCount}
          onOpenHealth={() => setActiveTab('health')}
        />
      ) : null}

      {activeTab === 'health' ? (
        <>
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

          <RuntimeNodeCapabilityMatrix
            rows={sortedNodeMatrix}
            expanded={nodeMatrixExpanded}
            onToggleExpanded={() => setNodeMatrixExpanded((prev) => !prev)}
          />
        </>
      ) : null}

      {activeTab === 'activity' ? (
        <>
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
        </>
      ) : null}

      {activeTab === 'access' ? (
        <>
          {/* External Agent Access */}
          <ExternalAgentAccessPanel />

          <DelegatedCapabilityControlPanel />

          {/* Local Debug */}
          <LocalDebugSection collapsed={!auditData.localDebugExpanded} onToggle={auditData.toggleLocalDebug} />
        </>
      ) : null}
    </RuntimePageShell>
  );
}
