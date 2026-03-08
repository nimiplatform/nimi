import { useEffect, useMemo, useState } from 'react';
import { UsageWindow } from '@nimiplatform/sdk/runtime';
import type { UsageStatRecord } from '@nimiplatform/sdk/runtime';
import { fetchUsageStats } from './runtime-config-audit-sdk-service.js';

export type UsageEstimateBreakdownEntry = {
  label: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  computeMs: number;
};

export type UsageEstimate = {
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalComputeMs: number;
  totalQueueWaitMs: number;
  breakdown: UsageEstimateBreakdownEntry[];
};

function toSafeCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

export function mapUsageRecordsToEstimate(records: UsageStatRecord[]): Omit<UsageEstimate, 'loading' | 'error' | 'updatedAt'> {
  let totalRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalComputeMs = 0;
  let totalQueueWaitMs = 0;
  const grouped = new Map<string, UsageEstimateBreakdownEntry>();

  for (const record of records) {
    const requests = toSafeCount(record.requestCount);
    const inputTokens = toSafeCount(record.inputTokens);
    const outputTokens = toSafeCount(record.outputTokens);
    const computeMs = toSafeCount(record.computeMs);
    const queueWaitMs = toSafeCount(record.queueWaitMs);
    totalRequests += requests;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalComputeMs += computeMs;
    totalQueueWaitMs += queueWaitMs;

    const capability = String(record.capability || 'unknown').trim() || 'unknown';
    const modelId = String(record.modelId || 'unknown').trim() || 'unknown';
    const label = `${capability} · ${modelId}`;
    const existing = grouped.get(label) || {
      label,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      computeMs: 0,
    };
    existing.requests += requests;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.computeMs += computeMs;
    grouped.set(label, existing);
  }

  const breakdown = [...grouped.values()]
    .sort((left, right) => right.requests - left.requests)
    .slice(0, 6);

  return {
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    totalComputeMs,
    totalQueueWaitMs,
    breakdown,
  };
}

async function loadUsageRecords(window: UsageWindow): Promise<UsageStatRecord[]> {
  const output: UsageStatRecord[] = [];
  let pageToken = '';
  for (let i = 0; i < 20; i += 1) {
    const response = await fetchUsageStats({
      window,
      pageSize: 100,
      pageToken,
    });
    output.push(...response.records);
    pageToken = String(response.nextPageToken || '').trim();
    if (!pageToken) {
      break;
    }
  }
  return output;
}

export function useUsageEstimate(
  usageWindow: UsageWindow = UsageWindow.DAY,
  pollIntervalMs = 15000,
): UsageEstimate {
  const [records, setRecords] = useState<UsageStatRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await loadUsageRecords(usageWindow);
        if (canceled) {
          return;
        }
        setRecords(next);
        setUpdatedAt(new Date().toISOString());
      } catch (loadError) {
        if (canceled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void load();
    const timer = globalThis.setInterval(() => {
      void load();
    }, Math.max(5000, pollIntervalMs));

    return () => {
      canceled = true;
      globalThis.clearInterval(timer);
    };
  }, [pollIntervalMs, usageWindow]);

  const estimate = useMemo(() => mapUsageRecordsToEstimate(records), [records]);
  return {
    loading,
    error,
    updatedAt,
    ...estimate,
  };
}
