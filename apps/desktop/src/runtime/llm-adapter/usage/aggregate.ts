import type {
  UsageQueryFilter,
  UsageRecord,
  UsageSummaryPeriod,
  UsageSummaryRecord,
} from '../usage-tracker';

function periodWindowMs(period: UsageSummaryPeriod) {
  if (period === 'hour') return 3_600_000;
  if (period === 'day') return 86_400_000;
  return 7 * 86_400_000;
}

function hourBucket(iso: string, period: UsageSummaryPeriod) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    return iso;
  }
  if (period === 'hour') {
    date.setMinutes(0, 0, 0);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date.toISOString();
}

export function includeUsageRecord(record: UsageRecord, filter?: UsageQueryFilter) {
  if (!filter) {
    return true;
  }

  if (filter.since && record.timestamp < filter.since) {
    return false;
  }
  if (filter.until && record.timestamp > filter.until) {
    return false;
  }
  if (filter.caller && record.caller !== filter.caller) {
    return false;
  }
  if (filter.modelId && record.modelId !== filter.modelId) {
    return false;
  }
  if (filter.providerType && record.providerType !== filter.providerType) {
    return false;
  }
  if (typeof filter.success === 'boolean' && record.success !== filter.success) {
    return false;
  }

  return true;
}

export function summarizeUsageRecords(
  period: UsageSummaryPeriod,
  records: UsageRecord[],
  filter?: UsageQueryFilter,
): UsageSummaryRecord[] {
  const now = Date.now();
  const windowMs = periodWindowMs(period);
  const since = new Date(now - windowMs).toISOString();

  const effectiveFilter: UsageQueryFilter = {
    ...filter,
    since: filter?.since ?? since,
  };

  const filteredRecords = records
    .filter((record) => includeUsageRecord(record, effectiveFilter))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const buckets = new Map<string, UsageSummaryRecord & { ttftCount: number; ttftTotal: number }>();

  for (const record of filteredRecords) {
    const key = `${hourBucket(record.timestamp, period)}|${record.modelId}|${record.providerType}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.requestCount += 1;
      existing.successCount += record.success ? 1 : 0;
      existing.errorCount += record.success ? 0 : 1;
      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
      existing.totalTokens += record.totalTokens;
      existing.avgLatencyMs += record.latencyMs;
      if (typeof record.ttftMs === 'number') {
        existing.ttftTotal += record.ttftMs;
        existing.ttftCount += 1;
      }
      continue;
    }

    buckets.set(key, {
      bucket: hourBucket(record.timestamp, period),
      modelId: record.modelId,
      providerType: record.providerType,
      requestCount: 1,
      successCount: record.success ? 1 : 0,
      errorCount: record.success ? 0 : 1,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      totalTokens: record.totalTokens,
      avgLatencyMs: record.latencyMs,
      avgTtftMs: undefined,
      ttftCount: typeof record.ttftMs === 'number' ? 1 : 0,
      ttftTotal: typeof record.ttftMs === 'number' ? record.ttftMs : 0,
    });
  }

  return Array.from(buckets.values())
    .map((item) => ({
      bucket: item.bucket,
      modelId: item.modelId,
      providerType: item.providerType,
      requestCount: item.requestCount,
      successCount: item.successCount,
      errorCount: item.errorCount,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
      avgLatencyMs: Number((item.avgLatencyMs / item.requestCount).toFixed(2)),
      avgTtftMs: item.ttftCount > 0 ? Number((item.ttftTotal / item.ttftCount).toFixed(2)) : undefined,
    }))
    .sort((a, b) => (a.bucket < b.bucket ? 1 : -1));
}
