import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DesktopAuditEventProjection,
  GetRuntimeHealthResponse,
  UsageStatRecord,
} from '@nimiplatform/sdk/runtime/wire-types';
import { UsageWindow } from '@nimiplatform/sdk/runtime/wire-types';
import {
  fetchDesktopAuditEvents,
  fetchUsageStats,
  resolveDesktopAuditTimeRange,
  type DesktopAuditTimeRange,
} from './runtime-config-audit-sdk-service.js';
import { useRuntimeHealthCoordinatorState } from './runtime-health-coordinator.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type AuditFilters = {
  domain: string;
  callerKind: number;
  timeFrom: string;
  timeTo: string;
};

type UsageFilters = {
  capability: string;
  modelId: string;
  window: number;
};

export function useGlobalAuditData(enabled: boolean) {
  const bindings = useDesktopRendererBindings();
  const sdk = bindings.sdk;
  const healthState = useRuntimeHealthCoordinatorState();

  // --- Section 2: Global Audit ---
  const [auditEvents, setAuditEvents] = useState<DesktopAuditEventProjection[]>([]);
  const [auditNextPageToken, setAuditNextPageToken] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    domain: '',
    callerKind: 0,
    timeFrom: '',
    timeTo: '',
  });
  const auditPageWindowRef = useRef<DesktopAuditTimeRange | null>(null);

  // --- Section 3: Usage ---
  const [usageRecords, setUsageRecords] = useState<UsageStatRecord[]>([]);
  const [usageNextPageToken, setUsageNextPageToken] = useState('');
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageFilters, setUsageFilters] = useState<UsageFilters>({
    capability: '',
    modelId: '',
    window: UsageWindow.HOUR,
  });

  // --- Section 4: Local Debug ---
  const [localDebugExpanded, setLocalDebugExpanded] = useState(false);

  const toggleLocalDebug = useCallback(() => {
    setLocalDebugExpanded((prev) => !prev);
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      await sdk.runtimeHealthCoordinator().forceRefresh('runtime-page-refresh');
    } catch {
      // Keep rendering the shared state snapshot on refresh failure.
    }
  }, [sdk]);

  // --- Audit loading ---
  const loadAuditEvents = useCallback(async (filters?: AuditFilters) => {
    const f = filters ?? auditFilters;
    setAuditLoading(true);
    setAuditError(null);
    setAuditNextPageToken('');
    try {
      const auditWindow = resolveDesktopAuditTimeRange({
        from: f.timeFrom ? new Date(f.timeFrom) : undefined,
        to: f.timeTo ? new Date(f.timeTo) : undefined,
      }, new Date(bindings.clock.now()));
      auditPageWindowRef.current = auditWindow;
      const res = await fetchDesktopAuditEvents(sdk.auditAdmin(), {
        domain: f.domain || undefined,
        callerKind: f.callerKind || undefined,
        ...auditWindow,
        pageSize: 100,
        pageToken: '',
      });
      setAuditEvents(res.events);
      setAuditNextPageToken(res.nextPageToken);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditLoading(false);
    }
  }, [auditFilters]);

  const loadNextAuditPage = useCallback(async () => {
    if (!auditNextPageToken || auditLoading) return;
    const auditWindow = auditPageWindowRef.current;
    if (!auditWindow) {
      setAuditError('Audit pagination window is unavailable. Refresh the audit list.');
      return;
    }
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await fetchDesktopAuditEvents(sdk.auditAdmin(), {
        domain: auditFilters.domain || undefined,
        callerKind: auditFilters.callerKind || undefined,
        ...auditWindow,
        pageSize: 100,
        pageToken: auditNextPageToken,
      });
      setAuditEvents((prev) => [...prev, ...res.events]);
      setAuditNextPageToken(res.nextPageToken);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditLoading(false);
    }
  }, [auditFilters, auditLoading, auditNextPageToken]);

  // --- Usage loading ---
  const loadUsageStats = useCallback(async (filters?: UsageFilters) => {
    const f = filters ?? usageFilters;
    setUsageLoading(true);
    setUsageError(null);
    try {
      const res = await fetchUsageStats(sdk.auditAdmin(), {
        capability: f.capability || undefined,
        modelId: f.modelId || undefined,
        window: f.window || UsageWindow.HOUR,
        pageSize: 100,
        pageToken: '',
      });
      setUsageRecords(res.records);
      setUsageNextPageToken(res.nextPageToken);
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : String(err));
    } finally {
      setUsageLoading(false);
    }
  }, [usageFilters]);

  const loadNextUsagePage = useCallback(async () => {
    if (!usageNextPageToken || usageLoading) return;
    setUsageLoading(true);
    setUsageError(null);
    try {
      const res = await fetchUsageStats(sdk.auditAdmin(), {
        capability: usageFilters.capability || undefined,
        modelId: usageFilters.modelId || undefined,
        window: usageFilters.window || UsageWindow.HOUR,
        pageSize: 100,
        pageToken: usageNextPageToken,
      });
      setUsageRecords((prev) => [...prev, ...res.records]);
      setUsageNextPageToken(res.nextPageToken);
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : String(err));
    } finally {
      setUsageLoading(false);
    }
  }, [usageFilters, usageLoading, usageNextPageToken]);

  // --- Update filter helpers ---
  const updateAuditFilters = useCallback((patch: Partial<AuditFilters>) => {
    setAuditFilters((prev) => {
      const next = { ...prev, ...patch };
      void loadAuditEvents(next);
      return next;
    });
  }, [loadAuditEvents]);

  const updateUsageFilters = useCallback((patch: Partial<UsageFilters>) => {
    setUsageFilters((prev) => {
      const next = { ...prev, ...patch };
      void loadUsageStats(next);
      return next;
    });
  }, [loadUsageStats]);

  useEffect(() => {
    if (!enabled) return;
    void loadAuditEvents();
    void loadUsageStats();
  }, [enabled, loadHealth, loadAuditEvents, loadUsageStats]);

  // --- Usage summary ---
  const usageSummary = useMemo(() => {
    let totalRequests = 0;
    let totalSuccess = 0;
    let totalErrors = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCompute = 0;
    let totalQueueWait = 0;
    for (const r of usageRecords) {
      totalRequests += Number(r.requestCount) || 0;
      totalSuccess += Number(r.successCount) || 0;
      totalErrors += Number(r.errorCount) || 0;
      totalInput += Number(r.inputTokens) || 0;
      totalOutput += Number(r.outputTokens) || 0;
      totalCompute += Number(r.computeMs) || 0;
      totalQueueWait += Number(r.queueWaitMs) || 0;
    }
    return { totalRequests, totalSuccess, totalErrors, totalInput, totalOutput, totalCompute, totalQueueWait };
  }, [usageRecords]);

  return {
    // Health
    runtimeHealth: enabled ? (healthState.runtimeHealth as GetRuntimeHealthResponse | null) : null,
    healthLoading: enabled ? healthState.refreshing : false,
    healthError: enabled ? (healthState.error || healthState.streamError) : null,
    healthStreamConnected: enabled ? healthState.streamConnected : false,
    healthStreamError: enabled ? healthState.streamError : null,
    healthStale: enabled ? healthState.stale : true,
    loadHealth,

    // Audit
    auditEvents,
    auditNextPageToken,
    auditLoading,
    auditError,
    auditFilters,
    updateAuditFilters,
    loadAuditEvents,
    loadNextAuditPage,

    // Usage
    usageRecords,
    usageNextPageToken,
    usageLoading,
    usageError,
    usageFilters,
    updateUsageFilters,
    loadUsageStats,
    loadNextUsagePage,
    usageSummary,

    // Local Debug
    localDebugExpanded,
    toggleLocalDebug,
  };
}
