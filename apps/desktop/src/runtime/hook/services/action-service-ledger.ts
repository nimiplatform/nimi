import {
  purgeActionExecutionLedger,
  purgeActionIdempotencyRecords,
  purgeActionVerifyTickets,
  queryActionExecutionLedger,
  queryActionIdempotencyRecord,
  upsertActionExecutionLedgerRecord,
  upsertActionIdempotencyRecord,
} from '../../runtime-store/tauri-bridge';
import type { ActionExecutionPhase } from '../action-fabric/context.js';
import type {
  HookActionRequestContext,
  HookActionResult,
} from '../contracts/action.js';
import {
  makeIdempotencyKey,
  normalizeResult,
  sanitizeIsoFromMs,
  toRecord,
} from './action-runtime/primitives.js';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  ActionEntry,
  ActionExecutionLedgerStatus,
  ActionServiceContext,
} from './action-service-types.js';
import {
  IDEMPOTENCY_PURGE_INTERVAL_MS,
  LEDGER_PURGE_INTERVAL_MS,
} from './action-service-types.js';

export async function recordExecutionLedger(
  ctx: ActionServiceContext,
  input: {
    entry: ActionEntry;
    requestContext: HookActionRequestContext;
    executionId: string;
    traceId: string;
    phase: ActionExecutionPhase;
    status: ActionExecutionLedgerStatus;
    reasonCode?: string;
    payload?: Record<string, unknown>;
    strict?: boolean;
  },
): Promise<HookActionResult | null> {
  try {
    await upsertActionExecutionLedgerRecord({
      executionId: input.executionId,
      actionId: input.entry.descriptor.actionId,
      principalId: input.requestContext.principalId,
      phase: input.phase,
      status: input.status,
      traceId: input.traceId,
      reasonCode: String(input.reasonCode || '').trim() || undefined,
      payload: input.payload,
      occurredAt: sanitizeIsoFromMs(ctx.now()),
    });
    return null;
  } catch {
    if (!input.strict) {
      return null;
    }
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_RUNTIME_STORE_UNAVAILABLE,
      actionHint: 'retry-later',
    }, input.executionId, input.traceId, input.entry.descriptor.executionMode);
  }
}

export async function finalize(
  ctx: ActionServiceContext,
  entry: ActionEntry,
  requestContext: HookActionRequestContext,
  traceId: string,
  executionId: string,
  phase: ActionExecutionPhase,
  result: HookActionResult,
): Promise<HookActionResult> {
  const audit = await ctx.serviceInput.auditSink.append({
    actionId: entry.descriptor.actionId,
    modId: entry.modId,
    executionMode: entry.descriptor.executionMode,
    principalId: requestContext.principalId,
    subjectAccountId: requestContext.subjectAccountId,
    traceId,
    reasonCode: result.reasonCode,
    actionHint: result.actionHint,
    outcome: result.ok ? 'allow' : 'deny',
    payload: {
      phase,
      executionId,
      operation: entry.descriptor.operation,
      socialPrecondition: entry.descriptor.socialPrecondition,
      principalType: requestContext.principalType,
      mode: requestContext.mode,
      issuer: requestContext.issuer,
      authTokenId: requestContext.authTokenId,
    },
  });

  return {
    ...result,
    auditId: audit.auditId,
  };
}

export async function resolveUncertainIdempotencyFailure(
  ctx: ActionServiceContext,
  input: {
    principalId: string;
    actionId: string;
    idempotencyKey: string;
    inputDigest: string;
    executionId: string;
    traceId: string;
    executionMode: HookActionResult['executionMode'];
  },
): Promise<HookActionResult | null> {
  const records = await queryActionExecutionLedger({
      actionId: input.actionId,
      principalId: input.principalId,
      phase: 'commit',
      status: 'failed',
      limit: 200,
    }).catch(() => null);
  if (!records) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_RUNTIME_STORE_UNAVAILABLE,
      actionHint: 'retry-later',
    }, input.executionId, input.traceId, input.executionMode);
  }

  const hasUncertainFailure = records.some((record) => {
    if (String(record.reasonCode || '').trim() !== 'ACTION_RUNTIME_STORE_UNAVAILABLE') {
      return false;
    }
    const payload = toRecord(record.payload);
    const payloadIdempotencyKey = String(payload.idempotencyKey || '').trim();
    const payloadInputDigest = String(payload.inputDigest || '').trim();
    return payloadIdempotencyKey === input.idempotencyKey
      && payloadInputDigest === input.inputDigest;
  });
  if (!hasUncertainFailure) {
    return null;
  }
  return normalizeResult({
    ok: false,
    reasonCode: ReasonCode.ACTION_RUNTIME_STORE_UNAVAILABLE,
    actionHint: 'retry-later',
  }, input.executionId, input.traceId, input.executionMode);
}

export async function resolveIdempotencyReplay(
  ctx: ActionServiceContext,
  input: {
    principalId: string;
    actionId: string;
    idempotencyKey: string;
    inputDigest: string;
    executionId: string;
    traceId: string;
    executionMode: HookActionResult['executionMode'];
  },
): Promise<HookActionResult | null> {
  await purgeExpiredIdempotency(ctx);
  const nowMs = ctx.now();
  const key = makeIdempotencyKey(input);

  const memory = ctx.idempotencyMemory.get(key);
  if (memory && nowMs - memory.occurredAtMs <= ctx.idempotencyWindowMs) {
    if (memory.inputDigest !== input.inputDigest) {
      return normalizeResult({
        ok: false,
        reasonCode: ReasonCode.ACTION_IDEMPOTENCY_KEY_CONFLICT,
        actionHint: 'use-new-idempotency-key',
      }, input.executionId, input.traceId, input.executionMode);
    }
    return normalizeResult({
      ok: memory.response.ok,
      reasonCode: ReasonCode.ACTION_IDEMPOTENCY_REPLAYED,
      actionHint: 'replayed-previous-response',
      output: memory.response.output,
      warnings: memory.response.warnings,
    }, input.executionId, input.traceId, input.executionMode);
  }

  const persisted = await queryActionIdempotencyRecord({
    principalId: input.principalId,
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!persisted) {
    return null;
  }

  if (String(persisted.inputDigest || '').trim() !== input.inputDigest) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_IDEMPOTENCY_KEY_CONFLICT,
      actionHint: 'use-new-idempotency-key',
    }, input.executionId, input.traceId, input.executionMode);
  }

  const occurredAtMs = Date.parse(persisted.occurredAt);
  if (!Number.isFinite(occurredAtMs) || nowMs - occurredAtMs > ctx.idempotencyWindowMs) {
    return null;
  }

  const response = toRecord(persisted.response);
  const replayOutput = response.output && typeof response.output === 'object' && !Array.isArray(response.output)
    ? response.output as Record<string, unknown>
    : undefined;
  return normalizeResult({
    ok: Boolean(response.ok),
    reasonCode: ReasonCode.ACTION_IDEMPOTENCY_REPLAYED,
    actionHint: 'replayed-previous-response',
    output: replayOutput,
    warnings: Array.isArray(response.warnings)
      ? response.warnings.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
  }, input.executionId, input.traceId, input.executionMode);
}

export async function storeIdempotencyRecord(
  ctx: ActionServiceContext,
  input: {
    principalId: string;
    actionId: string;
    idempotencyKey: string;
    inputDigest: string;
    response: HookActionResult;
  },
): Promise<void> {
  await purgeExpiredIdempotency(ctx);
  const nowMs = ctx.now();
  const key = makeIdempotencyKey(input);
  ctx.idempotencyMemory.set(key, {
    principalId: input.principalId,
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    inputDigest: input.inputDigest,
    response: input.response,
    occurredAtMs: nowMs,
  });

  await upsertActionIdempotencyRecord({
    principalId: input.principalId,
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    inputDigest: input.inputDigest,
    occurredAt: sanitizeIsoFromMs(nowMs),
    response: {
      ok: input.response.ok,
      reasonCode: input.response.reasonCode,
      actionHint: input.response.actionHint,
      executionId: input.response.executionId,
      traceId: input.response.traceId,
      auditId: input.response.auditId,
      output: input.response.output,
      executionMode: input.response.executionMode,
      warnings: input.response.warnings,
    },
  });
}

export async function purgeExpiredIdempotency(ctx: ActionServiceContext): Promise<void> {
  const nowMs = ctx.now();
  if (nowMs - ctx.lastPurgeAtMs < IDEMPOTENCY_PURGE_INTERVAL_MS) {
    if (nowMs - ctx.lastLedgerPurgeAtMs >= LEDGER_PURGE_INTERVAL_MS) {
      await purgeActionExecutionLedger(sanitizeIsoFromMs(nowMs - ctx.idempotencyWindowMs));
      ctx.lastLedgerPurgeAtMs = nowMs;
    }
    return;
  }

  const thresholdMs = nowMs - ctx.idempotencyWindowMs;
  for (const [key, value] of ctx.idempotencyMemory.entries()) {
    if (value.occurredAtMs < thresholdMs) {
      ctx.idempotencyMemory.delete(key);
    }
  }
  for (const [ticketId, ticket] of ctx.verifyTicketMemory.entries()) {
    if (ticket.expiresAtMs <= nowMs) {
      ctx.verifyTicketMemory.delete(ticketId);
    }
  }

  await purgeActionIdempotencyRecords(sanitizeIsoFromMs(thresholdMs));
  await purgeActionVerifyTickets(sanitizeIsoFromMs(nowMs));
  if (nowMs - ctx.lastLedgerPurgeAtMs >= LEDGER_PURGE_INTERVAL_MS) {
    await purgeActionExecutionLedger(sanitizeIsoFromMs(thresholdMs));
    ctx.lastLedgerPurgeAtMs = nowMs;
  }
  ctx.lastPurgeAtMs = nowMs;
}
