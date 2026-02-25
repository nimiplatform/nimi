import type { AuditStats, HookCallRecord } from '../contracts/types.js';

const DEFAULT_MAX_RECORDS = 10_000;

export class HookAuditTrail {
  private readonly records: HookCallRecord[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords: number = DEFAULT_MAX_RECORDS) {
    this.maxRecords = maxRecords;
  }

  append(record: HookCallRecord): void {
    if (this.records.length >= this.maxRecords) {
      // Evict oldest 20% to avoid constant shifting
      const evictCount = Math.max(1, Math.floor(this.maxRecords * 0.2));
      this.records.splice(0, evictCount);
    }
    this.records.push(record);
  }

  query(filter?: {
    modId?: string;
    hookType?: HookCallRecord['hookType'];
    target?: string;
    decision?: HookCallRecord['decision'];
    since?: string;
    limit?: number;
  }): HookCallRecord[] {
    let result = this.records;

    if (filter) {
      result = result.filter((item) => {
        if (filter.modId && item.modId !== filter.modId) return false;
        if (filter.hookType && item.hookType !== filter.hookType) return false;
        if (filter.target && item.target !== filter.target) return false;
        if (filter.decision && item.decision !== filter.decision) return false;
        if (filter.since && item.timestamp < filter.since) return false;
        return true;
      });
    }

    if (filter?.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  stats(modId?: string): AuditStats {
    const subset = modId
      ? this.records.filter((r) => r.modId === modId)
      : this.records;

    const byHookType: Record<string, { calls: number; denials: number }> = {};
    const byMod: Record<string, { calls: number; denials: number }> = {};
    let allowCount = 0;
    let denyCount = 0;
    let totalLatency = 0;
    let maxLatency = 0;

    for (const rec of subset) {
      if (rec.decision === 'DENY') {
        denyCount += 1;
      } else {
        allowCount += 1;
      }

      totalLatency += rec.latencyMs;
      if (rec.latencyMs > maxLatency) maxLatency = rec.latencyMs;

      const ht = byHookType[rec.hookType] ?? { calls: 0, denials: 0 };
      ht.calls += 1;
      if (rec.decision === 'DENY') ht.denials += 1;
      byHookType[rec.hookType] = ht;

      const bm = byMod[rec.modId] ?? { calls: 0, denials: 0 };
      bm.calls += 1;
      if (rec.decision === 'DENY') bm.denials += 1;
      byMod[rec.modId] = bm;
    }

    return {
      totalCalls: subset.length,
      allowCount,
      denyCount,
      avgLatencyMs: subset.length > 0 ? totalLatency / subset.length : 0,
      maxLatencyMs: maxLatency,
      byHookType,
      byMod,
    };
  }

  export(): HookCallRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }

  get size(): number {
    return this.records.length;
  }
}
