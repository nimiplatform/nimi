// @nimi-authority: rule.nimi.desktop.shell-ui.r005

/**
 * Advanced & Diagnostics — four text sub-sections owned by the page header:
 * Services & Components, Activity & Usage, Permissions & Access, Data &
 * Storage.
 *
 * Product Control root replacement and Check & Sync live exclusively in
 * Settings > Data Management. The data pane deep-links there; support and log
 * export stay Support-owned.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PillTabs, Surface, cn } from '@nimiplatform/kit/ui';
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
import { RuntimeDaemonServiceCard } from './runtime-config-daemon-service-card';
import {
  SystemResourcesSection,
  UsageEstimateSection,
} from './runtime-config-diagnostics-load-usage';
import { RuntimeConfigLocalCapabilityEnvironmentPanel } from './runtime-config-local-capability-environment-panel.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import {
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
} from './runtime-config-runtime-page-ui';

type AdvancedDiagnosticsPaneId = 'services' | 'activity' | 'access' | 'data';

type AdvancedDiagnosticsPageProps = {
  model: RuntimeConfigPanelControllerModel;
};

const SUB_PANES: Array<{ id: AdvancedDiagnosticsPaneId; labelKey: string; defaultLabel: string }> = [
  { id: 'services', labelKey: 'runtimeConfig.advanced.servicesTab', defaultLabel: 'Services & Components' },
  { id: 'activity', labelKey: 'runtimeConfig.advanced.activityTab', defaultLabel: 'Activity & Usage' },
  { id: 'access', labelKey: 'runtimeConfig.advanced.accessTab', defaultLabel: 'Permissions & Access' },
  { id: 'data', labelKey: 'runtimeConfig.advanced.dataTab', defaultLabel: 'Data & Storage' },
];

export function AdvancedDiagnosticsPage({ model }: AdvancedDiagnosticsPageProps) {
  const { t } = useTranslation();
  const auditData = useGlobalAuditData(true);
  const [pane, setPane] = useState<AdvancedDiagnosticsPaneId>('services');

  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={t('runtimeConfig.nav.advancedDiagnostics', { defaultValue: 'Advanced & Diagnostics' })}
        description={t('runtimeConfig.advanced.description', {
          defaultValue: 'Runtime services, components, activity, access, and storage for this machine.',
        })}
        actions={(
          <div data-testid="runtime-advanced-subtabs">
            <PillTabs
              size="sm"
              ariaLabel={t('runtimeConfig.nav.advancedDiagnostics', { defaultValue: 'Advanced & Diagnostics' })}
              items={SUB_PANES.map((tab) => ({
                value: tab.id,
                label: t(tab.labelKey, { defaultValue: tab.defaultLabel }),
              }))}
              value={pane}
              onValueChange={(value) => setPane(value as AdvancedDiagnosticsPaneId)}
            />
          </div>
        )}
      />

      {pane === 'services' ? (
        <div data-testid={E2E_IDS.runtimeAdvancedPane('services')} className="grid gap-4">
          <RuntimeDaemonServiceCard model={model} />
          <RuntimeConfigLocalCapabilityEnvironmentPanel
            writesDisabled={model.runtimeWritesDisabled}
            onOpenAiSettings={() => model.onChangePage('aiSettings')}
          />
          <SystemResourcesSection />
          <RuntimeHealthSection
            runtimeHealth={auditData.runtimeHealth}
            loading={auditData.healthLoading}
            error={auditData.healthError}
            streamConnected={auditData.healthStreamConnected}
            streamError={auditData.healthStreamError}
            stale={auditData.healthStale}
            onRefresh={() => void auditData.loadHealth()}
          />
          <details className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 text-xs text-[var(--nimi-text-secondary)]">
            <summary className="cursor-pointer font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.environment.runtimeTechnicalStatus', { defaultValue: 'Runtime technical status' })}
            </summary>
            <p className="mt-1">{t('runtimeConfig.environment.runtimeTechnicalStatusDescription', { defaultValue: 'Daemon, bridge, resource, and configuration diagnostics for support and development.' })}</p>
            <div className="mt-4"><RuntimeOverviewTab model={model} /></div>
          </details>
          <LocalDebugSection collapsed={!auditData.localDebugExpanded} onToggle={auditData.toggleLocalDebug} />
        </div>
      ) : null}

      {pane === 'activity' ? (
        <div data-testid={E2E_IDS.runtimeAdvancedPane('activity')} className="grid gap-4">
          <UsageEstimateSection />
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

      {pane === 'access' ? (
        <div data-testid={E2E_IDS.runtimeAdvancedPane('access')} className="grid gap-4">
          <ExternalAgentAccessPanel />
          <DelegatedCapabilityControlPanel />
          <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'flex items-center justify-between gap-3 px-4 py-3')}>
            <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.overview.vaultEntries', { defaultValue: 'Vault Entries' })}
            </p>
            <p className={cn('text-sm', TOKEN_TEXT_PRIMARY)}>
              <span className="font-semibold tabular-nums">{model.vaultEntryCount}</span>
              {' '}
              <span className={TOKEN_TEXT_MUTED}>{t('runtimeConfig.overview.credentialsStored', { defaultValue: 'credentials stored' })}</span>
            </p>
          </Surface>
        </div>
      ) : null}

      {pane === 'data' ? (
        <div data-testid={E2E_IDS.runtimeAdvancedPane('data')}>
          <EnvironmentDataTab />
        </div>
      ) : null}
    </RuntimePageShell>
  );
}
