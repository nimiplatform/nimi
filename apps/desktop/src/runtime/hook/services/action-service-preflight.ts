import {
  deleteActionVerifyTicket,
  queryActionVerifyTicket,
  upsertActionVerifyTicket,
  purgeActionVerifyTickets,
} from '../../runtime-store/tauri-bridge';
import { ActionPipeline } from '../action-fabric/pipeline.js';
import {
  pipelineNext,
  pipelineStop,
  type ActionExecutionPhase,
  type ActionPipelineStepResult,
} from '../action-fabric/context.js';
import type {
  HookActionHandler,
  HookActionRequestContext,
  HookActionResult,
  HookActionVerifyResult,
} from '../contracts/action.js';
import {
  assertValidContext,
  createExecutionId,
  createVerifyTicket,
  normalizeResult,
  sanitizeActionId,
  sanitizeIsoFromMs,
  sanitizeMode,
  toInputDigest,
  toReasonText,
} from './action-runtime/primitives.js';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  ActionEntry,
  ActionServiceContext,
  InMemoryVerifyTicket,
  PreflightContext,
} from './action-service-types.js';
import {
  recordExecutionLedger,
  finalize,
  resolveUncertainIdempotencyFailure,
  resolveIdempotencyReplay,
  storeIdempotencyRecord,
} from './action-service-ledger.js';

export async function runVerifyPhase(
  ctx: ActionServiceContext,
  input: {
    actionId: string;
    input: Record<string, unknown>;
    requestContext: HookActionRequestContext;
    idempotencyKey?: string;
    ttlSeconds?: number;
    phase: ActionExecutionPhase;
  },
): Promise<HookActionVerifyResult> {
  const actionId = sanitizeActionId(input.actionId);
  const entry = ctx.entries.get(actionId);
  const executionId = createExecutionId(actionId || 'unknown');
  const traceId = String(input.requestContext.traceId || executionId).trim() || executionId;

  if (!entry) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_NOT_FOUND,
      actionHint: 'discover-actions',
    }, executionId, traceId, 'guarded') as HookActionVerifyResult;
  }

  await recordExecutionLedger(ctx, {
    entry,
    requestContext: input.requestContext,
    executionId,
    traceId,
    phase: 'verify',
    status: 'accepted',
    reasonCode: ReasonCode.ACTION_ACCEPTED,
  });

  const preflight = await runPreflightPipeline(ctx, {
    entry,
    input: input.input,
    requestContext: input.requestContext,
    traceId,
    executionId,
    phase: 'verify',
  });
  if (preflight) {
    await recordExecutionLedger(ctx, {
      entry,
      requestContext: input.requestContext,
      executionId,
      traceId,
      phase: 'verify',
      status: 'rejected',
      reasonCode: preflight.reasonCode,
      payload: {
        actionHint: preflight.actionHint,
      },
    });
    return finalize(ctx, entry, input.requestContext, traceId, executionId, 'verify', preflight) as Promise<HookActionVerifyResult>;
  }

  const inputDigest = await toInputDigest(input.input);
  const nowMs = ctx.now();
  const ttlMs = Math.max(5, Math.min(Number(input.ttlSeconds || 0) || 0, 900)) * 1000 || ctx.verifyTicketWindowMs;
  const verifyTicket = createVerifyTicket(entry.descriptor.actionId);
  const expiresAt = sanitizeIsoFromMs(nowMs + ttlMs);
  await upsertActionVerifyTicket({
    ticketId: verifyTicket,
    principalId: input.requestContext.principalId,
    actionId: entry.descriptor.actionId,
    traceId,
    inputDigest,
    issuedAt: sanitizeIsoFromMs(nowMs),
    expiresAt,
  });
  ctx.verifyTicketMemory.set(verifyTicket, {
    ticketId: verifyTicket,
    principalId: input.requestContext.principalId,
    actionId: entry.descriptor.actionId,
    traceId,
    inputDigest,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  });
  await purgeActionVerifyTickets(sanitizeIsoFromMs(nowMs));

  const result = normalizeResult({
    ok: true,
    reasonCode: ReasonCode.ACTION_VERIFIED,
    actionHint: 'commit-with-verify-ticket',
    output: {
      verifyTicket,
      expiresAt,
    },
  }, executionId, traceId, entry.descriptor.executionMode) as HookActionVerifyResult;

  result.verifyTicket = verifyTicket;
  result.expiresAt = expiresAt;
  result.constraints = {
    principalId: input.requestContext.principalId,
    actionId: entry.descriptor.actionId,
    traceId,
  };

  await recordExecutionLedger(ctx, {
    entry,
    requestContext: input.requestContext,
    executionId,
    traceId,
    phase: 'verify',
    status: 'verified',
    reasonCode: result.reasonCode,
    payload: {
      verifyTicket,
      expiresAt,
    },
  });

  return finalize(ctx, entry, input.requestContext, traceId, executionId, 'verify', result) as Promise<HookActionVerifyResult>;
}

export async function runPhase(
  ctx: ActionServiceContext,
  input: {
    actionId: string;
    input: Record<string, unknown>;
    requestContext: HookActionRequestContext;
    idempotencyKey?: string;
    verifyTicket?: string;
    phase: Exclude<ActionExecutionPhase, 'verify'>;
  },
): Promise<HookActionResult> {
  const actionId = sanitizeActionId(input.actionId);
  const entry = ctx.entries.get(actionId);
  const executionId = createExecutionId(actionId || 'unknown');
  const traceId = String(input.requestContext.traceId || executionId).trim() || executionId;

  if (!entry) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_NOT_FOUND,
      actionHint: 'discover-actions',
    }, executionId, traceId, 'guarded');
  }

  if (input.phase === 'commit') {
    const ledgerFailure = await recordExecutionLedger(ctx, {
      entry,
      requestContext: input.requestContext,
      executionId,
      traceId,
      phase: 'commit',
      status: 'accepted',
      reasonCode: ReasonCode.ACTION_ACCEPTED,
      strict: true,
    });
    if (ledgerFailure) {
      return ledgerFailure;
    }
  }

  const preflight = await runPreflightPipeline(ctx, {
    entry,
    input: input.input,
    requestContext: input.requestContext,
    traceId,
    executionId,
    phase: input.phase,
  });
  if (preflight) {
    if (input.phase === 'commit') {
      await recordExecutionLedger(ctx, {
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'rejected',
        reasonCode: preflight.reasonCode,
        payload: {
          actionHint: preflight.actionHint,
        },
      });
    }
    return finalize(ctx, entry, input.requestContext, traceId, executionId, input.phase, preflight);
  }

  if (input.phase === 'dry-run' && (!entry.descriptor.supportsDryRun || entry.descriptor.executionMode === 'opaque')) {
    return finalize(ctx, entry, input.requestContext, traceId, executionId, 'dry-run', normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_DRY_RUN_UNSUPPORTED,
      actionHint: 'use-verify-commit',
    }, executionId, traceId, entry.descriptor.executionMode));
  }

  const isWriteAction = entry.descriptor.operation === 'write';
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const inputDigest = isWriteAction ? await toInputDigest(input.input) : '';

  if (isWriteAction && !idempotencyKey) {
    if (input.phase === 'commit') {
      await recordExecutionLedger(ctx, {
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'rejected',
        reasonCode: ReasonCode.ACTION_IDEMPOTENCY_KEY_REQUIRED,
      });
    }
    return finalize(ctx, entry, input.requestContext, traceId, executionId, input.phase, normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_IDEMPOTENCY_KEY_REQUIRED,
      actionHint: 'add-idempotency-key',
    }, executionId, traceId, entry.descriptor.executionMode));
  }

  if (input.phase === 'commit' && isWriteAction && idempotencyKey) {
    const uncertain = await resolveUncertainIdempotencyFailure(ctx, {
      principalId: input.requestContext.principalId,
      actionId: entry.descriptor.actionId,
      idempotencyKey,
      inputDigest,
      executionId,
      traceId,
      executionMode: entry.descriptor.executionMode,
    });
    if (uncertain) {
      await recordExecutionLedger(ctx, {
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'failed',
        reasonCode: uncertain.reasonCode,
        payload: {
          actionHint: uncertain.actionHint,
          idempotencyKey,
          inputDigest,
        },
      });
      return finalize(ctx, entry, input.requestContext, traceId, executionId, 'commit', uncertain);
    }

    const replayed = await resolveIdempotencyReplay(ctx, {
      principalId: input.requestContext.principalId,
      actionId: entry.descriptor.actionId,
      idempotencyKey,
      inputDigest,
      executionId,
      traceId,
      executionMode: entry.descriptor.executionMode,
    });
    if (replayed) {
      const ledgerFailure = await recordExecutionLedger(ctx, {
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'replayed',
        reasonCode: replayed.reasonCode,
        payload: {
          actionHint: replayed.actionHint,
        },
        strict: true,
      });
      if (ledgerFailure) {
        return ledgerFailure;
      }
      return finalize(ctx, entry, input.requestContext, traceId, executionId, 'commit', replayed);
    }
  }

  if (input.phase === 'commit') {
    const verifyCheck = await assertVerifyTicket(ctx, {
      entry,
      requestContext: input.requestContext,
      traceId,
      inputDigest,
      verifyTicket: input.verifyTicket,
    });
    if (verifyCheck) {
      await recordExecutionLedger(ctx, {
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'rejected',
        reasonCode: verifyCheck.reasonCode,
        payload: {
          actionHint: verifyCheck.actionHint,
        },
      });
      return finalize(ctx, entry, input.requestContext, traceId, executionId, 'commit', verifyCheck);
    }
  }

  if (input.phase === 'commit') {
    const ledgerFailure = await recordExecutionLedger(ctx, {
      entry,
      requestContext: input.requestContext,
      executionId,
      traceId,
      phase: 'commit',
      status: 'executing',
      reasonCode: ReasonCode.ACTION_EXECUTING,
      strict: true,
    });
    if (ledgerFailure) {
      return ledgerFailure;
    }
  }

  const handlerPipeline = new ActionPipeline<{
    entry: ActionEntry;
    actionInput: Record<string, unknown>;
    requestContext: HookActionRequestContext;
    phase: Exclude<ActionExecutionPhase, 'verify'>;
    idempotencyKey?: string;
    executionId: string;
    traceId: string;
    handlerOutput?: Awaited<ReturnType<HookActionHandler>>;
    result?: HookActionResult;
  }, HookActionResult>();

  handlerPipeline.use('idempotency', () => pipelineNext);

  handlerPipeline.use('execute', async (pCtx) => {
    try {
      pCtx.handlerOutput = await pCtx.entry.handler({
        dryRun: pCtx.phase === 'dry-run',
        actionId: pCtx.entry.descriptor.actionId,
        modId: pCtx.entry.modId,
        sourceType: pCtx.entry.sourceType,
        input: pCtx.actionInput,
        context: pCtx.requestContext,
        idempotencyKey: pCtx.idempotencyKey || undefined,
      });
    } catch (error) {
      return pipelineStop(normalizeResult({
        ok: false,
        reasonCode: ReasonCode.ACTION_EXECUTION_FAILED,
        actionHint: error instanceof Error ? error.message : String(error || 'runtime execute failed'),
      }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode));
    }

    let result = normalizeResult(pCtx.handlerOutput || {
      ok: false,
      reasonCode: ReasonCode.ACTION_EXECUTION_FAILED,
      actionHint: 'handler returned empty output',
    }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode);
    if (result.ok && !pCtx.entry.outputValidator(result.output || {})) {
      result = normalizeResult({
        ok: false,
        reasonCode: ReasonCode.ACTION_OUTPUT_SCHEMA_INVALID,
        actionHint: toReasonText(pCtx.entry.outputValidator),
      }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode);
    }
    pCtx.result = result;
    return pipelineNext;
  });

  handlerPipeline.use('audit', async (pCtx) => {
    const result = pCtx.result || normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_EXECUTION_FAILED,
      actionHint: 'missing-result',
    }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode);
    return pipelineStop(result);
  });

  const handlerContext = {
    entry,
    actionInput: input.input,
    requestContext: input.requestContext,
    phase: input.phase,
    idempotencyKey,
    executionId,
    traceId,
  };

  const runResult = await handlerPipeline.run(handlerContext);
  const result = runResult || normalizeResult({
    ok: false,
    reasonCode: ReasonCode.ACTION_EXECUTION_FAILED,
    actionHint: 'pipeline-empty-result',
  }, executionId, traceId, entry.descriptor.executionMode);
  if (result.ok && result.reasonCode === ReasonCode.ACTION_COMMITTED && input.phase === 'dry-run') {
    result.reasonCode = 'ACTION_DRY_RUN_READY';
    result.actionHint = 'review-dry-run';
  }

  if (input.phase === 'commit' && isWriteAction && idempotencyKey) {
    try {
      await storeIdempotencyRecord(ctx, {
        principalId: input.requestContext.principalId,
        actionId: entry.descriptor.actionId,
        idempotencyKey,
        inputDigest,
        response: result,
      });
    } catch {
      await recordExecutionLedger(ctx, {
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'failed',
        reasonCode: ReasonCode.ACTION_RUNTIME_STORE_UNAVAILABLE,
        payload: {
          actionHint: 'retry-later',
          idempotencyKey,
          inputDigest,
        },
        strict: true,
      });
      return normalizeResult({
        ok: false,
        reasonCode: ReasonCode.ACTION_RUNTIME_STORE_UNAVAILABLE,
        actionHint: 'retry-later',
      }, executionId, traceId, entry.descriptor.executionMode);
    }
  }

  if (input.phase === 'commit') {
    const ledgerFailure = await recordExecutionLedger(ctx, {
      entry,
      requestContext: input.requestContext,
      executionId,
      traceId,
      phase: 'commit',
      status: result.ok ? 'committed' : 'failed',
      reasonCode: result.reasonCode,
      payload: {
        actionHint: result.actionHint,
        executionMode: result.executionMode,
      },
      strict: true,
    });
    if (ledgerFailure) {
      return ledgerFailure;
    }
  }

  const finalized = await finalize(ctx, entry, input.requestContext, traceId, executionId, input.phase, result);

  if (input.phase === 'commit' && input.verifyTicket) {
    ctx.verifyTicketMemory.delete(input.verifyTicket);
    await deleteActionVerifyTicket(input.verifyTicket);
  }

  return finalized;
}

export async function runPreflightPipeline(
  ctx: ActionServiceContext,
  input: PreflightContext,
): Promise<HookActionResult | null> {
  const pipeline = new ActionPipeline<PreflightContext, HookActionResult>();

  pipeline.use('auth', async (pCtx): Promise<ActionPipelineStepResult<HookActionResult>> => {
    const ctxCheck = assertValidContext(pCtx.requestContext);
    if (!ctxCheck.ok) {
      return pipelineStop(normalizeResult({
        ok: false,
        reasonCode: ctxCheck.reasonCode,
        actionHint: ctxCheck.actionHint,
      }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode));
    }

    if (pCtx.entry.descriptor.executionMode === 'opaque' && pCtx.entry.descriptor.riskLevel === 'high') {
      return pipelineStop(normalizeResult({
        ok: false,
        reasonCode: ReasonCode.ACTION_OPAQUE_HIGH_RISK_FORBIDDEN,
        actionHint: 'use-full-or-guarded',
      }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode));
    }

    if (pCtx.requestContext.principalType === 'external-agent' && ctx.serviceInput.verifyExternalAgentContext) {
      const mode = sanitizeMode(pCtx.requestContext.mode);
      const verified = await ctx.serviceInput.verifyExternalAgentContext({
        principalId: String(pCtx.requestContext.principalId || '').trim(),
        subjectAccountId: String(pCtx.requestContext.subjectAccountId || '').trim(),
        mode,
        issuer: String(pCtx.requestContext.issuer || '').trim(),
        authTokenId: String(pCtx.requestContext.authTokenId || '').trim(),
        bridgeExecutionId: String(pCtx.requestContext.bridgeExecutionId || '').trim() || undefined,
      });
      if (!verified) {
        return pipelineStop(normalizeResult({
          ok: false,
          reasonCode: ReasonCode.ACTION_CONTEXT_INVALID,
          actionHint: 'reauthorize-external-agent',
        }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode));
      }
    }

    return pipelineNext;
  });

  pipeline.use('schema', (pCtx) => {
    if (!pCtx.entry.inputValidator(pCtx.input)) {
      return pipelineStop(normalizeResult({
        ok: false,
        reasonCode: ReasonCode.ACTION_INPUT_SCHEMA_INVALID,
        actionHint: toReasonText(pCtx.entry.inputValidator),
      }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode));
    }
    return pipelineNext;
  });

  pipeline.use('permission', (pCtx) => {
    try {
      evaluateActionPermissions(ctx, pCtx.entry, pCtx.phase);
    } catch {
      return pipelineStop(normalizeResult({
        ok: false,
        reasonCode: ReasonCode.ACTION_PERMISSION_DENIED,
        actionHint: 'request-permission',
      }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode));
    }
    return pipelineNext;
  });

  pipeline.use('social precondition', async (pCtx) => {
    const socialResult = await ctx.serviceInput.socialPreconditionService.evaluate({
      descriptor: pCtx.entry.descriptor,
      context: pCtx.requestContext,
      input: pCtx.input,
    });
    if (!socialResult.ok) {
      return pipelineStop(normalizeResult({
        ok: false,
        reasonCode: socialResult.reasonCode,
        actionHint: socialResult.actionHint,
      }, pCtx.executionId, pCtx.traceId, pCtx.entry.descriptor.executionMode));
    }
    return pipelineNext;
  });

  return pipeline.run(input);
}

export async function assertVerifyTicket(
  ctx: ActionServiceContext,
  input: {
    entry: ActionEntry;
    requestContext: HookActionRequestContext;
    traceId: string;
    inputDigest: string;
    verifyTicket?: string;
  },
): Promise<HookActionResult | null> {
  const verifyPolicy = input.entry.descriptor.verifyPolicy || 'optional';
  const mustVerify = verifyPolicy === 'required'
    || input.entry.descriptor.operation === 'write';

  if (!mustVerify) {
    return null;
  }

  const ticketId = String(input.verifyTicket || '').trim();
  if (!ticketId) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_VERIFY_REQUIRED,
      actionHint: 'run-verify-first',
    }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
  }

  const memoryTicket = ctx.verifyTicketMemory.get(ticketId);
  const persistedTicket = memoryTicket
    ? null
    : await queryActionVerifyTicket({ ticketId });
  const ticket = memoryTicket || (persistedTicket
    ? {
      ticketId: persistedTicket.ticketId,
      principalId: persistedTicket.principalId,
      actionId: persistedTicket.actionId,
      traceId: persistedTicket.traceId,
      inputDigest: persistedTicket.inputDigest,
      issuedAtMs: Date.parse(persistedTicket.issuedAt),
      expiresAtMs: Date.parse(persistedTicket.expiresAt),
    } satisfies InMemoryVerifyTicket
    : null);
  if (!ticket) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_VERIFY_TICKET_INVALID,
      actionHint: 'run-verify-first',
    }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
  }

  if (!Number.isFinite(ticket.expiresAtMs) || ticket.expiresAtMs <= ctx.now()) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_VERIFY_TICKET_EXPIRED,
      actionHint: 'run-verify-again',
    }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
  }

  if (ticket.principalId !== input.requestContext.principalId
    || ticket.actionId !== input.entry.descriptor.actionId
    || ticket.traceId !== input.traceId
    || ticket.inputDigest !== input.inputDigest) {
    return normalizeResult({
      ok: false,
      reasonCode: ReasonCode.ACTION_VERIFY_TICKET_INVALID,
      actionHint: 'run-verify-again',
    }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
  }

  return null;
}

export function evaluateActionPermissions(
  ctx: ActionServiceContext,
  entry: ActionEntry,
  phase: ActionExecutionPhase,
): void {
  const startedAt = ctx.now();
  const phaseTarget = phase === 'dry-run'
    ? `action.dry-run.${entry.descriptor.actionId}`
    : phase === 'verify'
      ? `action.verify.${entry.descriptor.actionId}`
      : `action.commit.${entry.descriptor.actionId}`;

  ctx.serviceInput.evaluatePermission({
    modId: entry.modId,
    sourceType: entry.sourceType,
    hookType: 'action',
    target: phaseTarget,
    capabilityKey: phaseTarget,
    startedAt,
  });

  for (const requiredCapability of entry.descriptor.requiredCapabilities) {
    ctx.serviceInput.evaluatePermission({
      modId: entry.modId,
      sourceType: entry.sourceType,
      hookType: 'action',
      target: `action.required.${entry.descriptor.actionId}`,
      capabilityKey: requiredCapability,
      startedAt,
    });
  }
}
