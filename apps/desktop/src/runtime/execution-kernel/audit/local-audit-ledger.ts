import { appendRuntimeAudit, queryRuntimeAudit } from '../../runtime-store/tauri-bridge';
import type { DecisionResult, KernelStage, LocalAuditRecord } from '../contracts/types';

const KERNEL_STAGES = new Set<KernelStage>([
  'discovery',
  'manifest/compat',
  'signature/auth',
  'dependency/build',
  'sandbox/policy',
  'load',
  'lifecycle',
  'audit',
]);

const DECISION_RESULTS = new Set<DecisionResult>([
  'ALLOW',
  'ALLOW_WITH_WARNING',
  'DENY',
]);

export class LocalAuditLedger {
  private readonly records: LocalAuditRecord[] = [];

  async append(record: LocalAuditRecord): Promise<void> {
    this.records.push(record);
    await appendRuntimeAudit(record);
  }

  async query(filter?: {
    modId?: string;
    stage?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<LocalAuditRecord[]> {
    const persistedRaw = await queryRuntimeAudit(filter);
    const persisted = persistedRaw
      .map((item) => this.normalizePersistedRecord(item))
      .filter((item): item is LocalAuditRecord => item !== null);
    const memory = this.records.filter((item) => this.match(item, filter));
    const merged = [...persisted, ...memory];
    const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values());
    unique.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const limit = filter?.limit && filter.limit > 0 ? filter.limit : 200;
    return unique.slice(0, limit);
  }

  private match(
    record: LocalAuditRecord,
    filter?: {
      modId?: string;
      stage?: string;
      from?: string;
      to?: string;
      limit?: number;
    },
  ): boolean {
    if (!filter) {
      return true;
    }
    if (filter.modId && record.modId !== filter.modId) {
      return false;
    }
    if (filter.stage && record.stage !== filter.stage) {
      return false;
    }
    if (filter.from && record.occurredAt < filter.from) {
      return false;
    }
    if (filter.to && record.occurredAt > filter.to) {
      return false;
    }
    return true;
  }

  private normalizePersistedRecord(record: {
    id?: unknown;
    modId?: unknown;
    stage?: unknown;
    eventType?: unknown;
    decision?: unknown;
    reasonCodes?: unknown;
    payload?: unknown;
    occurredAt?: unknown;
  }): LocalAuditRecord | null {
    const id = typeof record.id === 'string' ? record.id : '';
    const eventType = typeof record.eventType === 'string' ? record.eventType : '';
    const occurredAt = typeof record.occurredAt === 'string' ? record.occurredAt : '';
    if (!id || !eventType || !occurredAt) {
      return null;
    }

    const stage = this.asKernelStage(record.stage);
    const decision = this.asDecisionResult(record.decision);
    const modId = typeof record.modId === 'string' ? record.modId : undefined;
    const reasonCodes = Array.isArray(record.reasonCodes)
      ? record.reasonCodes.filter((item): item is string => typeof item === 'string')
      : undefined;
    const payload =
      record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : undefined;

    return {
      id,
      modId,
      stage,
      eventType,
      decision,
      reasonCodes,
      payload,
      occurredAt,
    };
  }

  private asKernelStage(value: unknown): KernelStage | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    return KERNEL_STAGES.has(value as KernelStage) ? (value as KernelStage) : undefined;
  }

  private asDecisionResult(value: unknown): DecisionResult | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    return DECISION_RESULTS.has(value as DecisionResult) ? (value as DecisionResult) : undefined;
  }
}
