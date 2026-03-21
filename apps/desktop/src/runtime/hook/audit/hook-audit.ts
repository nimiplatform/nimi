import type { AuditStats, HookCallRecord } from '../contracts/types.js';

const DEFAULT_MAX_RECORDS = 10_000;

export class HookAuditTrail {
  private readonly records: Array<HookCallRecord | undefined>;
  private readonly maxRecords: number;
  private startIndex = 0;
  private recordCount = 0;

  constructor(maxRecords: number = DEFAULT_MAX_RECORDS) {
    this.maxRecords = maxRecords;
    this.records = new Array<HookCallRecord | undefined>(maxRecords);
  }

  append(record: HookCallRecord): void {
    if (this.maxRecords <= 0) {
      return;
    }

    const writeIndex = (this.startIndex + this.recordCount) % this.maxRecords;
    this.records[writeIndex] = record;
    if (this.recordCount < this.maxRecords) {
      this.recordCount += 1;
      return;
    }

    this.startIndex = (this.startIndex + 1) % this.maxRecords;
  }

  private snapshot(): HookCallRecord[] {
    const result: HookCallRecord[] = [];
    for (let index = 0; index < this.recordCount; index += 1) {
      const record = this.records[(this.startIndex + index) % this.maxRecords];
      if (record) {
        result.push(record);
      }
    }
    return result;
  }

  query(filter?: {
    modId?: string;
    hookType?: HookCallRecord['hookType'];
    target?: string;
    decision?: HookCallRecord['decision'];
    since?: string;
    limit?: number;
  }): HookCallRecord[] {
    let result = this.snapshot();

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

    const limit = filter?.limit && filter.limit > 0 ? filter.limit : undefined;
    return limit ? result.slice(-limit) : result;
  }

  stats(modId?: string): AuditStats {
    const snapshot = this.snapshot();
    const subset = modId
      ? snapshot.filter((r) => r.modId === modId)
      : snapshot;

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
    return this.snapshot();
  }

  clear(): void {
    this.records.fill(undefined);
    this.startIndex = 0;
    this.recordCount = 0;
  }

  get size(): number {
    return this.recordCount;
  }
}
