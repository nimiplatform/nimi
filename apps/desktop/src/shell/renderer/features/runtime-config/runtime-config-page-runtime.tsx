import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { NimiTabs } from '@nimiplatform/kit/ui';
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

  const sortedNodeMatrix = useMemo(
    () =>
      [...(state.local.nodeMatrix || [])].sort(
        (left, right) =>
          String(left.capability || '').localeCompare(String(right.capability || '')) ||
          String(left.nodeId || '').localeCompare(String(right.nodeId || '')),
      ),
    [state.local.nodeMatrix],
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
      {/* Tab bar: kit underline tabs, non-sticky, flows with page. */}
      <NimiTabs
        className="overflow-x-auto"
        ariaLabel={t('runtimeConfig.sidebar.environment', { defaultValue: 'Environment' })}
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as RuntimeTabKey)}
        items={tabs.map((tab) => ({
          value: tab.key,
          label: (
            <span className="inline-flex items-center gap-1.5">
              {tab.label}
              {tab.badge ? (
                <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--nimi-status-danger-soft-bg)] px-1 text-[length:var(--nimi-type-caption-size)] font-semibold leading-4 text-[var(--nimi-status-danger-soft-text)]">
                  {tab.badge}
                </span>
              ) : null}
            </span>
          ),
        }))}
      />

      {activeTab === 'overview' ? (
        <RuntimeOverviewTab model={model} />
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
