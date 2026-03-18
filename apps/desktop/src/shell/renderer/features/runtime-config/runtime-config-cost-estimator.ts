import { useEffect, useMemo, useState } from 'react';
import { UsageWindow } from '@nimiplatform/sdk/runtime';
import type { UsageStatRecord } from '@nimiplatform/sdk/runtime';
import { fetchUsageStats } from './runtime-config-audit-sdk-service.js';
import { usePricingIndex, type PricingEntry } from './runtime-config-pricing-index.js';
import type { RuntimeCatalogPricing } from './runtime-config-catalog-sdk-service.js';

export type UsageEstimateBreakdownEntry = {
  label: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  computeMs: number;
  modelId: string;
  estimatedCost: number | null;
  costCurrency: string;
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
  totalEstimatedCost: number | null;
  costCurrency: string;
  pricingLoading: boolean;
  breakdown: UsageEstimateBreakdownEntry[];
};

function toSafeCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

function parsePriceValue(value: string): number | null {
  if (!value || value === 'unknown') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function calculateModelCost(
  usage: { requests: number; inputTokens: number; outputTokens: number; computeMs: number },
  pricing: RuntimeCatalogPricing,
): { cost: number | null; currency: string } {
  if (pricing.currency === 'none') {
    return { cost: 0, currency: 'none' };
  }

  const inputPrice = parsePriceValue(pricing.input);
  const outputPrice = parsePriceValue(pricing.output);

  if (inputPrice === null && outputPrice === null) {
    return { cost: null, currency: pricing.currency };
  }

  const safeInput = inputPrice ?? 0;
  const safeOutput = outputPrice ?? 0;

  let cost: number;
  switch (pricing.unit) {
    case 'token':
      cost = (usage.inputTokens * safeInput + usage.outputTokens * safeOutput) / 1_000_000;
      break;
    case 'char':
      cost = (usage.inputTokens * 4 * safeInput + usage.outputTokens * 4 * safeOutput) / 1_000_000;
      break;
    case 'request':
      cost = usage.requests * safeInput;
      break;
    case 'second':
      cost = (usage.computeMs / 60_000) * safeInput;
      break;
    default:
      return { cost: null, currency: pricing.currency };
  }

  return { cost, currency: pricing.currency };
}

export function mapUsageRecordsToEstimate(records: UsageStatRecord[]): Omit<UsageEstimate, 'loading' | 'error' | 'updatedAt' | 'totalEstimatedCost' | 'costCurrency' | 'pricingLoading'> {
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
      modelId,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      computeMs: 0,
      estimatedCost: null,
      costCurrency: '',
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

function applyPricingToEstimate(
  estimate: ReturnType<typeof mapUsageRecordsToEstimate>,
  pricingIndex: Map<string, PricingEntry>,
): { breakdown: UsageEstimateBreakdownEntry[]; totalEstimatedCost: number | null; costCurrency: string } {
  let totalCost: number | null = 0;
  let detectedCurrency = '';

  const breakdown = estimate.breakdown.map((entry) => {
    const pricingEntry = pricingIndex.get(entry.modelId);
    if (!pricingEntry) {
      return { ...entry, estimatedCost: null, costCurrency: '' };
    }
    const { cost, currency } = calculateModelCost(entry, pricingEntry.pricing);
    if (cost !== null && currency !== 'none') {
      if (!detectedCurrency) detectedCurrency = currency;
      if (detectedCurrency === currency && totalCost !== null) {
        totalCost += cost;
      } else if (detectedCurrency !== currency) {
        totalCost = null;
      }
    }
    return { ...entry, estimatedCost: cost, costCurrency: currency };
  });

  return { breakdown, totalEstimatedCost: totalCost, costCurrency: detectedCurrency || 'USD' };
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

  const baseEstimate = useMemo(() => mapUsageRecordsToEstimate(records), [records]);

  const modelIds = useMemo(
    () => [...new Set(baseEstimate.breakdown.map((entry) => entry.modelId))],
    [baseEstimate.breakdown],
  );
  const pricingState = usePricingIndex(modelIds);

  const withPricing = useMemo(
    () => applyPricingToEstimate(baseEstimate, pricingState.index),
    [baseEstimate, pricingState.index],
  );

  return {
    loading,
    error,
    updatedAt,
    totalRequests: baseEstimate.totalRequests,
    totalInputTokens: baseEstimate.totalInputTokens,
    totalOutputTokens: baseEstimate.totalOutputTokens,
    totalComputeMs: baseEstimate.totalComputeMs,
    totalQueueWaitMs: baseEstimate.totalQueueWaitMs,
    totalEstimatedCost: withPricing.totalEstimatedCost,
    costCurrency: withPricing.costCurrency,
    pricingLoading: pricingState.loading,
    breakdown: withPricing.breakdown,
  };
}
