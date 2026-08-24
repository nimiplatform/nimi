/**
 * Environment section — flattened single-level tabs owned by the page header:
 * Local AI, Health, Activity, Access, Data & Storage.
 *
 * Data-root relocation is not an admitted ordinary Desktop feature. The data
 * tab shows the runtime-scoped storage view only; account-level data actions
 * (cache, Web account-management handoff, logout) live exclusively in Settings.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PillTabs } from '@nimiplatform/kit/ui';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell';
import { EnvironmentDataTab } from './runtime-config-environment-data-tab';
import { RuntimeHealthSection } from './runtime-config-runtime-health-section.js';
import { GlobalAuditSection } from './runtime-config-global-audit-section.js';
import { UsageStatsSection } from './runtime-config-usage-stats-section.js';
import { LocalDebugSection } from './runtime-config-local-debug-section.js';
import { useGlobalAuditData } from './runtime-config-use-global-audit-data.js';
import { ExternalAgentAccessPanel } from './runtime-config-external-agent-access';
import { DelegatedCapabilityControlPanel } from './runtime-config-delegated-capability-panel';
import { RuntimeOverviewTab } from './runtime-config-runtime-overview-tab';
import { RuntimeConfigLocalCapabilityEnvironmentPanel } from './runtime-config-local-capability-environment-panel.js';
import { E2E_IDS } from '../../testability/e2e-ids';

type EnvironmentSubTabId = 'localAI' | 'health' | 'activity' | 'access' | 'data';

type EnvironmentPageProps = {
  model: RuntimeConfigPanelControllerModel;
};

const SUB_TABS: Array<{ id: EnvironmentSubTabId; labelKey: string; defaultLabel: string }> = [
  { id: 'localAI', labelKey: 'runtimeConfig.environment.localCapabilityTab', defaultLabel: 'Local AI' },
  { id: 'health', labelKey: 'runtimeConfig.runtime.tabHealth', defaultLabel: 'Health' },
  { id: 'activity', labelKey: 'runtimeConfig.runtime.tabActivity', defaultLabel: 'Activity' },
  { id: 'access', labelKey: 'runtimeConfig.runtime.tabAccess', defaultLabel: 'Access' },
  { id: 'data', labelKey: 'runtimeConfig.environment.tabData', defaultLabel: 'Data & Storage' },
];

export function EnvironmentPage({ model }: EnvironmentPageProps) {
  const { t } = useTranslation();
  const auditData = useGlobalAuditData(true);
  const [subTab, setSubTab] = useState<EnvironmentSubTabId>('localAI');

  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={t('runtimeConfig.sidebar.environment')}
        actions={(
          <div data-testid="runtime-environment-subtabs">
            <PillTabs
              size="sm"
              ariaLabel={t('runtimeConfig.sidebar.environment', { defaultValue: 'Environment' })}
              items={SUB_TABS.map((tab) => ({
                value: tab.id,
                label: t(tab.labelKey, { defaultValue: tab.defaultLabel }),
              }))}
              value={subTab}
              onValueChange={(value) => setSubTab(value as EnvironmentSubTabId)}
            />
          </div>
        )}
      />

      {subTab === 'localAI' ? (
        <div data-testid={E2E_IDS.runtimeEnvironmentPane('localAI')} className="grid gap-4">
          <RuntimeConfigLocalCapabilityEnvironmentPanel
            writesDisabled={model.runtimeWritesDisabled}
            onOpenLoadouts={() => model.onChangePage('loadouts')}
          />
          <details className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 text-xs text-[var(--nimi-text-secondary)]">
            <summary className="cursor-pointer font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.environment.runtimeTechnicalStatus', { defaultValue: 'Runtime technical status' })}
            </summary>
            <p className="mt-1">{t('runtimeConfig.environment.runtimeTechnicalStatusDescription', { defaultValue: 'Daemon, bridge, resource, and configuration diagnostics for support and development.' })}</p>
            <div className="mt-4"><RuntimeOverviewTab model={model} /></div>
          </details>
        </div>
      ) : null}

      {subTab === 'health' ? (
        <div data-testid={E2E_IDS.runtimeEnvironmentPane('health')}>
          <RuntimeHealthSection
            runtimeHealth={auditData.runtimeHealth}
            loading={auditData.healthLoading}
            error={auditData.healthError}
            streamConnected={auditData.healthStreamConnected}
            streamError={auditData.healthStreamError}
            stale={auditData.healthStale}
            onRefresh={() => void auditData.loadHealth()}
          />
        </div>
      ) : null}

      {subTab === 'activity' ? (
        <div data-testid={E2E_IDS.runtimeEnvironmentPane('activity')} className="grid gap-4">
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
        </div>
      ) : null}

      {subTab === 'access' ? (
        <div data-testid={E2E_IDS.runtimeEnvironmentPane('access')} className="grid gap-4">
          <ExternalAgentAccessPanel />
          <DelegatedCapabilityControlPanel />
          <LocalDebugSection collapsed={!auditData.localDebugExpanded} onToggle={auditData.toggleLocalDebug} />
        </div>
      ) : null}

      {subTab === 'data' ? (
        <div data-testid={E2E_IDS.runtimeEnvironmentPane('data')}>
          <EnvironmentDataTab />
        </div>
      ) : null}
    </RuntimePageShell>
  );
}
