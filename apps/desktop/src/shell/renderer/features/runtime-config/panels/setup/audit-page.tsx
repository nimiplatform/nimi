import { RuntimeHealthSection } from './audit-sections/runtime-health-section.js';
import { GlobalAuditSection } from './audit-sections/global-audit-section.js';
import { UsageStatsSection } from './audit-sections/usage-stats-section.js';
import { LocalDebugSection } from './audit-sections/local-debug-section.js';
import { useGlobalAuditData } from './use-global-audit-data.js';

export function AuditPage() {
  const data = useGlobalAuditData(true);

  return (
    <div className="space-y-4">
      <RuntimeHealthSection
        runtimeHealth={data.runtimeHealth}
        providerHealth={data.providerHealth}
        loading={data.healthLoading}
        error={data.healthError}
        onRefresh={() => void data.loadHealth()}
      />
      <GlobalAuditSection
        events={data.auditEvents}
        loading={data.auditLoading}
        error={data.auditError}
        hasNextPage={!!data.auditNextPageToken}
        filters={data.auditFilters}
        onUpdateFilters={data.updateAuditFilters}
        onRefresh={() => void data.loadAuditEvents()}
        onLoadMore={() => void data.loadNextAuditPage()}
        onExport={(format) => void data.exportAudit(format)}
      />
      <UsageStatsSection
        records={data.usageRecords}
        loading={data.usageLoading}
        error={data.usageError}
        hasNextPage={!!data.usageNextPageToken}
        filters={data.usageFilters}
        summary={data.usageSummary}
        onUpdateFilters={data.updateUsageFilters}
        onRefresh={() => void data.loadUsageStats()}
        onLoadMore={() => void data.loadNextUsagePage()}
      />
      <LocalDebugSection
        collapsed={!data.localDebugExpanded}
        onToggle={data.toggleLocalDebug}
      />
    </div>
  );
}
