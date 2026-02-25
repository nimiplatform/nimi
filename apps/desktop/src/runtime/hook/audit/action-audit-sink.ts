import { appendRuntimeAudit, queryRuntimeAudit } from '../../runtime-store/tauri-bridge';
import type { HookActionAuditFilter, HookActionAuditRecord } from '../contracts/action.js';

function toIsoNow(): string {
  return new Date().toISOString();
}

function createAuditId(): string {
  return `hook-action:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

export class HookActionAuditSink {
  private readonly memory: HookActionAuditRecord[] = [];

  async append(record: Omit<HookActionAuditRecord, 'auditId' | 'occurredAt'> & {
    auditId?: string;
    occurredAt?: string;
  }): Promise<HookActionAuditRecord> {
    const normalized: HookActionAuditRecord = {
      auditId: record.auditId || createAuditId(),
      actionId: record.actionId,
      modId: record.modId,
      executionMode: record.executionMode,
      principalId: record.principalId,
      subjectAccountId: record.subjectAccountId,
      traceId: record.traceId,
      reasonCode: record.reasonCode,
      actionHint: record.actionHint,
      outcome: record.outcome,
      occurredAt: record.occurredAt || toIsoNow(),
      payload: record.payload,
    };

    await appendRuntimeAudit({
      id: normalized.auditId,
      modId: normalized.modId,
      stage: 'audit',
      eventType: 'hook.action.commit',
      decision: normalized.outcome === 'allow' ? 'ALLOW' : normalized.outcome === 'deny' ? 'DENY' : 'ALLOW_WITH_WARNING',
      reasonCodes: [normalized.reasonCode],
      payload: {
        actionId: normalized.actionId,
        executionMode: normalized.executionMode,
        principalId: normalized.principalId,
        subjectAccountId: normalized.subjectAccountId,
        traceId: normalized.traceId,
        actionHint: normalized.actionHint,
        outcome: normalized.outcome,
        ...(normalized.payload || {}),
      },
      occurredAt: normalized.occurredAt,
    });

    this.memory.push(normalized);
    if (this.memory.length > 2000) {
      this.memory.splice(0, this.memory.length - 2000);
    }

    return normalized;
  }

  async query(filter?: HookActionAuditFilter): Promise<HookActionAuditRecord[]> {
    const rows = await queryRuntimeAudit({
      modId: filter?.modId,
      stage: 'audit',
      eventType: 'hook.action.commit',
      limit: filter?.limit,
    });

    const persisted = rows
      .map<HookActionAuditRecord | null>((row) => {
        const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? row.payload as Record<string, unknown>
          : {};
        const actionId = normalizeString(payload.actionId);
        const executionMode = normalizeString(payload.executionMode) as HookActionAuditRecord['executionMode'];
        const principalId = normalizeString(payload.principalId);
        const subjectAccountId = normalizeString(payload.subjectAccountId);
        const traceId = normalizeString(payload.traceId);
        const actionHint = normalizeString(payload.actionHint);
        const outcomeRaw = normalizeString(payload.outcome);
        const outcome: HookActionAuditRecord['outcome'] = outcomeRaw === 'allow' || outcomeRaw === 'deny'
          ? outcomeRaw
          : 'error';
        const reasonCode = normalizeString(row.reasonCodes?.[0]);
        if (!row.id || !actionId || !executionMode || !principalId || !subjectAccountId) {
          return null;
        }
        return {
          auditId: row.id,
          actionId,
          modId: normalizeString(row.modId),
          executionMode,
          principalId,
          subjectAccountId,
          traceId,
          reasonCode: reasonCode || 'ACTION_AUDIT_REASON_UNSPECIFIED',
          actionHint: actionHint || 'review-audit',
          outcome,
          occurredAt: normalizeString(row.occurredAt) || toIsoNow(),
          payload: Object.keys(payload).length > 0 ? payload : undefined,
        } satisfies HookActionAuditRecord;
      })
      .filter((item): item is HookActionAuditRecord => item !== null);

    const merged = [...persisted, ...this.memory];
    const unique = Array.from(
      new Map(merged.map((item) => [item.auditId, item])).values(),
    );

    return unique.filter((item) => {
      if (filter?.actionId && item.actionId !== filter.actionId) return false;
      if (filter?.principalId && item.principalId !== filter.principalId) return false;
      if (filter?.traceId && item.traceId !== filter.traceId) return false;
      if (filter?.reasonCode && item.reasonCode !== filter.reasonCode) return false;
      return true;
    });
  }
}
