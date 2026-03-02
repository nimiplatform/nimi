import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GetRuntimeHealthResponse,
  AIProviderHealthSnapshot,
  AuditEventRecord,
  UsageStatRecord,
} from '@nimiplatform/sdk/runtime';
import { UsageWindow } from '@nimiplatform/sdk/runtime';
import {
  fetchGlobalAuditEvents,
  fetchUsageStats,
  fetchRuntimeHealth,
  fetchProviderHealth,
  startAuditExport,
  dateToTimestamp,
} from '../../domain/diagnostics/audit-sdk-service.js';

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
  // --- Section 1: Health ---
  const [runtimeHealth, setRuntimeHealth] = useState<GetRuntimeHealthResponse | null>(null);
  const [providerHealth, setProviderHealth] = useState<AIProviderHealthSnapshot[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // --- Section 2: Global Audit ---
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditNextPageToken, setAuditNextPageToken] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    domain: '',
    callerKind: 0,
    timeFrom: '',
    timeTo: '',
  });

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

  // --- Health loading ---
  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const [healthRes, providerRes] = await Promise.all([
        fetchRuntimeHealth(),
        fetchProviderHealth(),
      ]);
      setRuntimeHealth(healthRes);
      setProviderHealth(providerRes.providers);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : String(err));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // --- Audit loading ---
  const loadAuditEvents = useCallback(async (filters?: AuditFilters) => {
    const f = filters ?? auditFilters;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await fetchGlobalAuditEvents({
        domain: f.domain || undefined,
        callerKind: f.callerKind || undefined,
        fromTime: f.timeFrom ? dateToTimestamp(new Date(f.timeFrom)) : undefined,
        toTime: f.timeTo ? dateToTimestamp(new Date(f.timeTo)) : undefined,
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
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await fetchGlobalAuditEvents({
        domain: auditFilters.domain || undefined,
        callerKind: auditFilters.callerKind || undefined,
        fromTime: auditFilters.timeFrom ? dateToTimestamp(new Date(auditFilters.timeFrom)) : undefined,
        toTime: auditFilters.timeTo ? dateToTimestamp(new Date(auditFilters.timeTo)) : undefined,
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
      const res = await fetchUsageStats({
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
      const res = await fetchUsageStats({
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

  // --- Export audit ---
  const exportAudit = useCallback(async (format: string = 'json') => {
    try {
      const stream = await startAuditExport({ format });
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk.chunk);
        if (chunk.eof) break;
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      const blob = new Blob([merged], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-export-${new Date().toISOString()}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

  // --- Auto-load on mount + health polling ---
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    void loadHealth();
    void loadAuditEvents();
    void loadUsageStats();

    healthTimerRef.current = setInterval(() => {
      void loadHealth();
    }, 10_000);

    return () => {
      if (healthTimerRef.current) clearInterval(healthTimerRef.current);
    };
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
    runtimeHealth,
    providerHealth,
    healthLoading,
    healthError,
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
    exportAudit,

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
