import { hasTauriInvoke, tauriInvoke } from './tauri-bridge';
import type { ProviderType } from './types';
import { toUsageRecord } from './usage/persist';
import { includeUsageRecord, summarizeUsageRecords } from './usage/aggregate';
import { normalizeUsage as normalizeUsageMetrics } from './usage/session-metrics';

export type UsageRecord = {
  id: string;
  timestamp: string;
  caller: string;
  modelId: string;
  providerType: ProviderType;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  ttftMs?: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  recoveryAction?: string;
};

export type UsageRecordInput = Omit<UsageRecord, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: string;
};

export type UsageQueryFilter = {
  since?: string;
  until?: string;
  caller?: string;
  modelId?: string;
  providerType?: ProviderType;
  success?: boolean;
  limit?: number;
};

export type UsageSummaryPeriod = 'hour' | 'day' | 'week';

export type UsageSummaryRecord = {
  bucket: string;
  modelId: string;
  providerType: ProviderType;
  requestCount: number;
  successCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTtftMs?: number;
  avgLatencyMs: number;
};

export interface UsageTracker {
  record(input: UsageRecordInput): Promise<UsageRecord>;
  query(filter?: UsageQueryFilter): Promise<UsageRecord[]>;
  summary(period: UsageSummaryPeriod, filter?: UsageQueryFilter): Promise<UsageSummaryRecord[]>;
}

export class InMemoryUsageTracker implements UsageTracker {
  private readonly records: UsageRecord[] = [];

  async record(input: UsageRecordInput): Promise<UsageRecord> {
    const record = toUsageRecord(input);
    this.records.push(record);
    return record;
  }

  async query(filter?: UsageQueryFilter): Promise<UsageRecord[]> {
    const matched = this.records.filter((record) => includeUsageRecord(record, filter));
    const sorted = [...matched].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    if (filter?.limit && filter.limit > 0) {
      return sorted.slice(0, filter.limit);
    }
    return sorted;
  }

  async summary(period: UsageSummaryPeriod, filter?: UsageQueryFilter): Promise<UsageSummaryRecord[]> {
    return summarizeUsageRecords(period, this.records, filter);
  }
}

export class TauriUsageTracker implements UsageTracker {
  private readonly fallback = new InMemoryUsageTracker();
  private readonly useTauri: boolean;

  constructor(options?: { forceTauri?: boolean }) {
    this.useTauri = options?.forceTauri ?? hasTauriInvoke();
  }

  async record(input: UsageRecordInput): Promise<UsageRecord> {
    if (!this.useTauri) {
      return this.fallback.record(input);
    }

    const record = toUsageRecord(input);
    await tauriInvoke<void>('usage_insert_record', {
      payload: { record },
    });
    return record;
  }

  async query(filter?: UsageQueryFilter): Promise<UsageRecord[]> {
    if (!this.useTauri) {
      return this.fallback.query(filter);
    }

    return tauriInvoke<UsageRecord[]>('usage_query_records', {
      payload: { filter },
    });
  }

  async summary(period: UsageSummaryPeriod, filter?: UsageQueryFilter): Promise<UsageSummaryRecord[]> {
    if (!this.useTauri) {
      return this.fallback.summary(period, filter);
    }

    return tauriInvoke<UsageSummaryRecord[]>('usage_summary_records', {
      payload: { period, filter },
    });
  }
}

export function normalizeUsage(
  raw: Record<string, unknown> | undefined,
  providerType: ProviderType,
): Pick<UsageRecord, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens'> {
  return normalizeUsageMetrics(raw, providerType);
}
