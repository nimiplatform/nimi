import Ajv, { type ValidateFunction } from 'ajv';
import {
  deleteActionVerifyTicket,
  purgeActionExecutionLedger,
  purgeActionIdempotencyRecords,
  purgeActionVerifyTickets,
  queryActionExecutionLedger,
  queryActionIdempotencyRecord,
  queryActionVerifyTicket,
  upsertActionExecutionLedgerRecord,
  upsertActionIdempotencyRecord,
  upsertActionVerifyTicket,
} from '../../runtime-store/tauri-bridge';
import { ActionPipeline } from '../action-fabric/pipeline.js';
import {
  pipelineNext,
  pipelineStop,
  type ActionExecutionPhase,
  type ActionPipelineStepResult,
} from '../action-fabric/context.js';
import type {
  HookActionAuditFilter,
  HookActionCommitRequest,
  HookActionCommitResult,
  HookActionDescriptorView,
  HookActionDiscoverFilter,
  HookActionDryRunRequest,
  HookActionHandler,
  HookActionRegistrationInput,
  HookActionRegistryChangeEvent,
  HookActionRequestContext,
  HookActionResult,
  HookActionVerifyRequest,
  HookActionVerifyResult,
} from '../contracts/action.js';
import type { HookSourceType } from '../contracts/types.js';
import type { PermissionResolver } from './utils.js';
import { createHookError } from '../contracts/errors.js';
import { HookActionAuditSink } from '../audit/action-audit-sink.js';
import { HookActionSocialPreconditionService } from './action-social-precondition.js';
import { assertActionDescriptorFinalState } from '../action-fabric/descriptor-validator.js';
import {
  assertValidContext,
  createExecutionId,
  createVerifyTicket,
  makeIdempotencyKey,
  normalizeResult,
  sanitizeActionId,
  sanitizeIsoFromMs,
  sanitizeMode,
  toInputDigest,
  toReasonText,
  toRecord,
} from './action-runtime/primitives.js';

type ActionEntry = {
  modId: string;
  sourceType: HookSourceType;
  descriptor: HookActionDescriptorView;
  handler: HookActionHandler;
  inputValidator: ValidateFunction;
  outputValidator: ValidateFunction;
};

type InMemoryIdempotencyRecord = {
  principalId: string;
  actionId: string;
  idempotencyKey: string;
  inputDigest: string;
  response: HookActionResult;
  occurredAtMs: number;
};

type InMemoryVerifyTicket = {
  ticketId: string;
  principalId: string;
  actionId: string;
  traceId: string;
  inputDigest: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

type PreflightContext = {
  entry: ActionEntry;
  input: Record<string, unknown>;
  requestContext: HookActionRequestContext;
  traceId: string;
  executionId: string;
  phase: ActionExecutionPhase;
};

type ActionExecutionLedgerStatus =
  | 'accepted'
  | 'executing'
  | 'verified'
  | 'committed'
  | 'failed'
  | 'replayed'
  | 'rejected';

export interface ActionServiceInput {
  evaluatePermission: PermissionResolver;
  auditSink: HookActionAuditSink;
  socialPreconditionService: HookActionSocialPreconditionService;
  verifyExternalAgentContext?: (input: {
    principalId: string;
    subjectAccountId: string;
    mode: 'delegated' | 'autonomous';
    issuer: string;
    authTokenId: string;
    bridgeExecutionId?: string;
  }) => Promise<boolean>;
  now?: () => number;
  idempotencyWindowMs?: number;
  verifyTicketWindowMs?: number;
}

const DEFAULT_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VERIFY_TICKET_WINDOW_MS = 15 * 60 * 1000;
const IDEMPOTENCY_PURGE_INTERVAL_MS = 15 * 60 * 1000;
const LEDGER_PURGE_INTERVAL_MS = 60 * 60 * 1000;

export class HookRuntimeActionService {
  private readonly entries = new Map<string, ActionEntry>();
  private readonly registryListeners = new Set<(event: HookActionRegistryChangeEvent) => void>();
  private readonly ajv: Ajv;
  private readonly idempotencyMemory = new Map<string, InMemoryIdempotencyRecord>();
  private readonly verifyTicketMemory = new Map<string, InMemoryVerifyTicket>();
  private readonly now: () => number;
  private readonly idempotencyWindowMs: number;
  private readonly verifyTicketWindowMs: number;
  private lastPurgeAtMs = 0;
  private lastLedgerPurgeAtMs = 0;

  constructor(private readonly context: ActionServiceInput) {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      allowUnionTypes: true,
    });
    this.now = context.now || Date.now;
    this.idempotencyWindowMs = context.idempotencyWindowMs || DEFAULT_IDEMPOTENCY_WINDOW_MS;
    this.verifyTicketWindowMs = context.verifyTicketWindowMs || DEFAULT_VERIFY_TICKET_WINDOW_MS;
  }

  subscribeActionRegistryChanges(
    listener: (event: HookActionRegistryChangeEvent) => void,
  ): () => void {
    this.registryListeners.add(listener);
    return () => {
      this.registryListeners.delete(listener);
    };
  }

  private emitRegistryChange(event: HookActionRegistryChangeEvent): void {
    for (const listener of this.registryListeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not block action registry mutation.
      }
    }
  }

  registerActionV1(input: HookActionRegistrationInput): HookActionDescriptorView {
    const actionId = sanitizeActionId(input.descriptor.actionId);
    if (!actionId) {
      throw createHookError('HOOK_CONTRACT_INVALID_EXTENSION', 'actionId is required');
    }

    const operation = input.descriptor.operation === 'write' ? 'write' : 'read';
    const socialPrecondition = input.descriptor.socialPrecondition === 'human-agent-active'
      ? 'human-agent-active'
      : 'none';

    let inputValidator: ValidateFunction;
    let outputValidator: ValidateFunction;
    try {
      inputValidator = this.ajv.compile(input.descriptor.inputSchema || {});
      outputValidator = this.ajv.compile(input.descriptor.outputSchema || {});
    } catch (error) {
      throw createHookError(
        'HOOK_CONTRACT_INVALID_EXTENSION',
        `schema compile failed: ${error instanceof Error ? error.message : String(error || 'unknown')}`,
        { actionId },
      );
    }

    const descriptor: HookActionDescriptorView = {
      ...input.descriptor,
      actionId,
      operation,
      socialPrecondition,
      verifyPolicy: input.descriptor.verifyPolicy || (operation === 'write' ? 'required' : 'optional'),
      idempotencyPolicy: operation === 'write' ? 'required-for-write' : input.descriptor.idempotencyPolicy,
      compensationPolicy: input.descriptor.compensationPolicy || 'optional',
      auditPolicy: 'always-persist',
      modId: input.modId,
      sourceType: input.sourceType || 'sideload',
      requiredCapabilities: Array.from(new Set((input.requiredCapabilities || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean))),
    };

    try {
      assertActionDescriptorFinalState(actionId, descriptor);
    } catch (error) {
      throw createHookError(
        'HOOK_CONTRACT_INVALID_EXTENSION',
        error instanceof Error ? error.message : String(error || 'descriptor matrix invalid'),
        { actionId },
      );
    }

    this.entries.set(actionId, {
      modId: descriptor.modId,
      sourceType: descriptor.sourceType,
      descriptor,
      handler: input.handler,
      inputValidator,
      outputValidator,
    });
    this.emitRegistryChange({
      type: 'registered',
      actionId,
      modId: descriptor.modId,
    });

    return descriptor;
  }

  unregisterAction(input: { modId: string; actionId: string }): boolean {
    const actionId = sanitizeActionId(input.actionId);
    if (!actionId) return false;
    const current = this.entries.get(actionId);
    if (!current || current.modId !== input.modId) {
      return false;
    }
    this.entries.delete(actionId);
    this.emitRegistryChange({
      type: 'unregistered',
      actionId,
      modId: current.modId,
    });
    return true;
  }

  discoverActions(filter?: HookActionDiscoverFilter): HookActionDescriptorView[] {
    const result = Array.from(this.entries.values()).map((item) => item.descriptor);
    return result.filter((item) => {
      if (filter?.modId && item.modId !== filter.modId) return false;
      if (filter?.executionMode && item.executionMode !== filter.executionMode) return false;
      if (!filter?.includeOpaque && item.executionMode === 'opaque') return false;
      return true;
    });
  }

  async dryRunAction(input: HookActionDryRunRequest): Promise<HookActionResult> {
    return this.runPhase({
      actionId: input.actionId,
      input: toRecord(input.input),
      requestContext: input.context,
      idempotencyKey: input.idempotencyKey,
      phase: 'dry-run',
    });
  }

  async verifyAction(input: HookActionVerifyRequest): Promise<HookActionVerifyResult> {
    return this.runVerifyPhase({
      actionId: input.actionId,
      input: toRecord(input.input),
      requestContext: input.context,
      idempotencyKey: input.idempotencyKey,
      ttlSeconds: input.ttlSeconds,
      phase: 'verify',
    });
  }

  async commitAction(input: HookActionCommitRequest): Promise<HookActionCommitResult> {
    return this.runPhase({
      actionId: input.actionId,
      input: toRecord(input.input),
      requestContext: input.context,
      idempotencyKey: input.idempotencyKey,
      verifyTicket: String(input.verifyTicket || '').trim() || undefined,
      phase: 'commit',
    });
  }

  queryActionAudit(filter?: HookActionAuditFilter): Promise<import('../contracts/action.js').HookActionAuditRecord[]> {
    return this.context.auditSink.query(filter);
  }

  private async runVerifyPhase(input: {
    actionId: string;
    input: Record<string, unknown>;
    requestContext: HookActionRequestContext;
    idempotencyKey?: string;
    ttlSeconds?: number;
    phase: ActionExecutionPhase;
  }): Promise<HookActionVerifyResult> {
    const actionId = sanitizeActionId(input.actionId);
    const entry = this.entries.get(actionId);
    const executionId = createExecutionId(actionId || 'unknown');
    const traceId = String(input.requestContext.traceId || executionId).trim() || executionId;

    if (!entry) {
      return normalizeResult({
        ok: false,
        reasonCode: 'ACTION_NOT_FOUND',
        actionHint: 'discover-actions',
      }, executionId, traceId, 'guarded') as HookActionVerifyResult;
    }

    await this.recordExecutionLedger({
      entry,
      requestContext: input.requestContext,
      executionId,
      traceId,
      phase: 'verify',
      status: 'accepted',
      reasonCode: 'ACTION_ACCEPTED',
    });

    const preflight = await this.runPreflightPipeline({
      entry,
      input: input.input,
      requestContext: input.requestContext,
      traceId,
      executionId,
      phase: 'verify',
    });
    if (preflight) {
      await this.recordExecutionLedger({
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
      return this.finalize(entry, input.requestContext, traceId, executionId, 'verify', preflight) as Promise<HookActionVerifyResult>;
    }

    const inputDigest = await toInputDigest(input.input);
    const nowMs = this.now();
    const ttlMs = Math.max(5, Math.min(Number(input.ttlSeconds || 0) || 0, 900)) * 1000 || this.verifyTicketWindowMs;
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
    this.verifyTicketMemory.set(verifyTicket, {
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
      reasonCode: 'ACTION_VERIFIED',
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

    await this.recordExecutionLedger({
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

    return this.finalize(entry, input.requestContext, traceId, executionId, 'verify', result) as Promise<HookActionVerifyResult>;
  }

  private async runPhase(input: {
    actionId: string;
    input: Record<string, unknown>;
    requestContext: HookActionRequestContext;
    idempotencyKey?: string;
    verifyTicket?: string;
    phase: Exclude<ActionExecutionPhase, 'verify'>;
  }): Promise<HookActionResult> {
    const actionId = sanitizeActionId(input.actionId);
    const entry = this.entries.get(actionId);
    const executionId = createExecutionId(actionId || 'unknown');
    const traceId = String(input.requestContext.traceId || executionId).trim() || executionId;

    if (!entry) {
      return normalizeResult({
        ok: false,
        reasonCode: 'ACTION_NOT_FOUND',
        actionHint: 'discover-actions',
      }, executionId, traceId, 'guarded');
    }

    if (input.phase === 'commit') {
      const ledgerFailure = await this.recordExecutionLedger({
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'accepted',
        reasonCode: 'ACTION_ACCEPTED',
        strict: true,
      });
      if (ledgerFailure) {
        return ledgerFailure;
      }
    }

    const preflight = await this.runPreflightPipeline({
      entry,
      input: input.input,
      requestContext: input.requestContext,
      traceId,
      executionId,
      phase: input.phase,
    });
    if (preflight) {
      if (input.phase === 'commit') {
        await this.recordExecutionLedger({
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
      return this.finalize(entry, input.requestContext, traceId, executionId, input.phase, preflight);
    }

    if (input.phase === 'dry-run' && (!entry.descriptor.supportsDryRun || entry.descriptor.executionMode === 'opaque')) {
      return this.finalize(entry, input.requestContext, traceId, executionId, 'dry-run', normalizeResult({
        ok: false,
        reasonCode: 'ACTION_DRY_RUN_UNSUPPORTED',
        actionHint: 'use-verify-commit',
      }, executionId, traceId, entry.descriptor.executionMode));
    }

    const isWriteAction = entry.descriptor.operation === 'write';
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    const inputDigest = isWriteAction ? await toInputDigest(input.input) : '';

    if (isWriteAction && !idempotencyKey) {
      if (input.phase === 'commit') {
        await this.recordExecutionLedger({
          entry,
          requestContext: input.requestContext,
          executionId,
          traceId,
          phase: 'commit',
          status: 'rejected',
          reasonCode: 'ACTION_IDEMPOTENCY_KEY_REQUIRED',
        });
      }
      return this.finalize(entry, input.requestContext, traceId, executionId, input.phase, normalizeResult({
        ok: false,
        reasonCode: 'ACTION_IDEMPOTENCY_KEY_REQUIRED',
        actionHint: 'add-idempotency-key',
      }, executionId, traceId, entry.descriptor.executionMode));
    }

    if (input.phase === 'commit' && isWriteAction && idempotencyKey) {
      const uncertain = await this.resolveUncertainIdempotencyFailure({
        principalId: input.requestContext.principalId,
        actionId: entry.descriptor.actionId,
        idempotencyKey,
        inputDigest,
        executionId,
        traceId,
        executionMode: entry.descriptor.executionMode,
      });
      if (uncertain) {
        await this.recordExecutionLedger({
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
        return this.finalize(entry, input.requestContext, traceId, executionId, 'commit', uncertain);
      }

      const replayed = await this.resolveIdempotencyReplay({
        principalId: input.requestContext.principalId,
        actionId: entry.descriptor.actionId,
        idempotencyKey,
        inputDigest,
        executionId,
        traceId,
        executionMode: entry.descriptor.executionMode,
      });
      if (replayed) {
        const ledgerFailure = await this.recordExecutionLedger({
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
        return this.finalize(entry, input.requestContext, traceId, executionId, 'commit', replayed);
      }
    }

    if (input.phase === 'commit') {
      const verifyCheck = await this.assertVerifyTicket({
        entry,
        requestContext: input.requestContext,
        traceId,
        inputDigest,
        verifyTicket: input.verifyTicket,
      });
      if (verifyCheck) {
        await this.recordExecutionLedger({
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
        return this.finalize(entry, input.requestContext, traceId, executionId, 'commit', verifyCheck);
      }
    }

    if (input.phase === 'commit') {
      const ledgerFailure = await this.recordExecutionLedger({
        entry,
        requestContext: input.requestContext,
        executionId,
        traceId,
        phase: 'commit',
        status: 'executing',
        reasonCode: 'ACTION_EXECUTING',
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

    handlerPipeline.use('execute', async (ctx) => {
      try {
        ctx.handlerOutput = await ctx.entry.handler({
          dryRun: ctx.phase === 'dry-run',
          actionId: ctx.entry.descriptor.actionId,
          modId: ctx.entry.modId,
          sourceType: ctx.entry.sourceType,
          input: ctx.actionInput,
          context: ctx.requestContext,
          idempotencyKey: ctx.idempotencyKey || undefined,
        });
      } catch (error) {
        return pipelineStop(normalizeResult({
          ok: false,
          reasonCode: 'ACTION_EXECUTION_FAILED',
          actionHint: error instanceof Error ? error.message : String(error || 'runtime execute failed'),
        }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode));
      }

      let result = normalizeResult(ctx.handlerOutput || {
        ok: false,
        reasonCode: 'ACTION_EXECUTION_FAILED',
        actionHint: 'handler returned empty output',
      }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode);
      if (result.ok && !ctx.entry.outputValidator(result.output || {})) {
        result = normalizeResult({
          ok: false,
          reasonCode: 'ACTION_OUTPUT_SCHEMA_INVALID',
          actionHint: toReasonText(ctx.entry.outputValidator),
        }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode);
      }
      ctx.result = result;
      return pipelineNext;
    });

    handlerPipeline.use('audit', async (ctx) => {
      const result = ctx.result || normalizeResult({
        ok: false,
        reasonCode: 'ACTION_EXECUTION_FAILED',
        actionHint: 'missing-result',
      }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode);
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
      reasonCode: 'ACTION_EXECUTION_FAILED',
      actionHint: 'pipeline-empty-result',
    }, executionId, traceId, entry.descriptor.executionMode);
    if (result.ok && result.reasonCode === 'ACTION_COMMITTED' && input.phase === 'dry-run') {
      result.reasonCode = 'ACTION_DRY_RUN_READY';
      result.actionHint = 'review-dry-run';
    }

    if (input.phase === 'commit' && isWriteAction && idempotencyKey) {
      try {
        await this.storeIdempotencyRecord({
          principalId: input.requestContext.principalId,
          actionId: entry.descriptor.actionId,
          idempotencyKey,
          inputDigest,
          response: result,
        });
      } catch {
        await this.recordExecutionLedger({
          entry,
          requestContext: input.requestContext,
          executionId,
          traceId,
          phase: 'commit',
          status: 'failed',
          reasonCode: 'ACTION_RUNTIME_STORE_UNAVAILABLE',
          payload: {
            actionHint: 'retry-later',
            idempotencyKey,
            inputDigest,
          },
          strict: true,
        });
        return normalizeResult({
          ok: false,
          reasonCode: 'ACTION_RUNTIME_STORE_UNAVAILABLE',
          actionHint: 'retry-later',
        }, executionId, traceId, entry.descriptor.executionMode);
      }
    }

    if (input.phase === 'commit') {
      const ledgerFailure = await this.recordExecutionLedger({
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

    const finalized = await this.finalize(entry, input.requestContext, traceId, executionId, input.phase, result);

    if (input.phase === 'commit' && input.verifyTicket) {
      this.verifyTicketMemory.delete(input.verifyTicket);
      await deleteActionVerifyTicket(input.verifyTicket);
    }

    return finalized;
  }

  private async runPreflightPipeline(input: PreflightContext): Promise<HookActionResult | null> {
    const pipeline = new ActionPipeline<PreflightContext, HookActionResult>();

    pipeline.use('auth', async (ctx): Promise<ActionPipelineStepResult<HookActionResult>> => {
      const ctxCheck = assertValidContext(ctx.requestContext);
      if (!ctxCheck.ok) {
        return pipelineStop(normalizeResult({
          ok: false,
          reasonCode: ctxCheck.reasonCode,
          actionHint: ctxCheck.actionHint,
        }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode));
      }

      if (ctx.entry.descriptor.executionMode === 'opaque' && ctx.entry.descriptor.riskLevel === 'high') {
        return pipelineStop(normalizeResult({
          ok: false,
          reasonCode: 'ACTION_OPAQUE_HIGH_RISK_FORBIDDEN',
          actionHint: 'use-full-or-guarded',
        }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode));
      }

      if (ctx.requestContext.principalType === 'external-agent' && this.context.verifyExternalAgentContext) {
        const mode = sanitizeMode(ctx.requestContext.mode);
        const verified = await this.context.verifyExternalAgentContext({
          principalId: String(ctx.requestContext.principalId || '').trim(),
          subjectAccountId: String(ctx.requestContext.subjectAccountId || '').trim(),
          mode,
          issuer: String(ctx.requestContext.issuer || '').trim(),
          authTokenId: String(ctx.requestContext.authTokenId || '').trim(),
          bridgeExecutionId: String(ctx.requestContext.bridgeExecutionId || '').trim() || undefined,
        });
        if (!verified) {
          return pipelineStop(normalizeResult({
            ok: false,
            reasonCode: 'ACTION_CONTEXT_INVALID',
            actionHint: 'reauthorize-external-agent',
          }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode));
        }
      }

      return pipelineNext;
    });

    pipeline.use('schema', (ctx) => {
      if (!ctx.entry.inputValidator(ctx.input)) {
        return pipelineStop(normalizeResult({
          ok: false,
          reasonCode: 'ACTION_INPUT_SCHEMA_INVALID',
          actionHint: toReasonText(ctx.entry.inputValidator),
        }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode));
      }
      return pipelineNext;
    });

    pipeline.use('permission', (ctx) => {
      try {
        this.evaluateActionPermissions(ctx.entry, ctx.phase);
      } catch {
        return pipelineStop(normalizeResult({
          ok: false,
          reasonCode: 'ACTION_PERMISSION_DENIED',
          actionHint: 'request-permission',
        }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode));
      }
      return pipelineNext;
    });

    pipeline.use('social precondition', async (ctx) => {
      const socialResult = await this.context.socialPreconditionService.evaluate({
        descriptor: ctx.entry.descriptor,
        context: ctx.requestContext,
        input: ctx.input,
      });
      if (!socialResult.ok) {
        return pipelineStop(normalizeResult({
          ok: false,
          reasonCode: socialResult.reasonCode,
          actionHint: socialResult.actionHint,
        }, ctx.executionId, ctx.traceId, ctx.entry.descriptor.executionMode));
      }
      return pipelineNext;
    });

    return pipeline.run(input);
  }

  private async assertVerifyTicket(input: {
    entry: ActionEntry;
    requestContext: HookActionRequestContext;
    traceId: string;
    inputDigest: string;
    verifyTicket?: string;
  }): Promise<HookActionResult | null> {
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
        reasonCode: 'ACTION_VERIFY_REQUIRED',
        actionHint: 'run-verify-first',
      }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
    }

    const memoryTicket = this.verifyTicketMemory.get(ticketId);
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
        reasonCode: 'ACTION_VERIFY_TICKET_INVALID',
        actionHint: 'run-verify-first',
      }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
    }

    if (!Number.isFinite(ticket.expiresAtMs) || ticket.expiresAtMs <= this.now()) {
      return normalizeResult({
        ok: false,
        reasonCode: 'ACTION_VERIFY_TICKET_EXPIRED',
        actionHint: 'run-verify-again',
      }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
    }

    if (ticket.principalId !== input.requestContext.principalId
      || ticket.actionId !== input.entry.descriptor.actionId
      || ticket.traceId !== input.traceId
      || ticket.inputDigest !== input.inputDigest) {
      return normalizeResult({
        ok: false,
        reasonCode: 'ACTION_VERIFY_TICKET_INVALID',
        actionHint: 'run-verify-again',
      }, createExecutionId(input.entry.descriptor.actionId), input.traceId, input.entry.descriptor.executionMode);
    }

    return null;
  }

  private evaluateActionPermissions(entry: ActionEntry, phase: ActionExecutionPhase): void {
    const startedAt = this.now();
    const phaseTarget = phase === 'dry-run'
      ? `action.dry-run.${entry.descriptor.actionId}`
      : phase === 'verify'
        ? `action.verify.${entry.descriptor.actionId}`
        : `action.commit.${entry.descriptor.actionId}`;

    this.context.evaluatePermission({
      modId: entry.modId,
      sourceType: entry.sourceType,
      hookType: 'action',
      target: phaseTarget,
      capabilityKey: phaseTarget,
      startedAt,
    });

    for (const requiredCapability of entry.descriptor.requiredCapabilities) {
      this.context.evaluatePermission({
        modId: entry.modId,
        sourceType: entry.sourceType,
        hookType: 'action',
        target: `action.required.${entry.descriptor.actionId}`,
        capabilityKey: requiredCapability,
        startedAt,
      });
    }
  }

  private async recordExecutionLedger(input: {
    entry: ActionEntry;
    requestContext: HookActionRequestContext;
    executionId: string;
    traceId: string;
    phase: ActionExecutionPhase;
    status: ActionExecutionLedgerStatus;
    reasonCode?: string;
    payload?: Record<string, unknown>;
    strict?: boolean;
  }): Promise<HookActionResult | null> {
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
        occurredAt: sanitizeIsoFromMs(this.now()),
      });
      return null;
    } catch {
      if (!input.strict) {
        return null;
      }
      return normalizeResult({
        ok: false,
        reasonCode: 'ACTION_RUNTIME_STORE_UNAVAILABLE',
        actionHint: 'retry-later',
      }, input.executionId, input.traceId, input.entry.descriptor.executionMode);
    }
  }

  private async finalize(
    entry: ActionEntry,
    requestContext: HookActionRequestContext,
    traceId: string,
    executionId: string,
    phase: ActionExecutionPhase,
    result: HookActionResult,
  ): Promise<HookActionResult> {
    const audit = await this.context.auditSink.append({
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

  private async resolveUncertainIdempotencyFailure(input: {
    principalId: string;
    actionId: string;
    idempotencyKey: string;
    inputDigest: string;
    executionId: string;
    traceId: string;
    executionMode: HookActionResult['executionMode'];
  }): Promise<HookActionResult | null> {
    let records: Array<{
      reasonCode?: string;
      payload?: Record<string, unknown>;
    }> = [];
    try {
      records = await queryActionExecutionLedger({
        actionId: input.actionId,
        principalId: input.principalId,
        phase: 'commit',
        status: 'failed',
        limit: 200,
      });
    } catch {
      return normalizeResult({
        ok: false,
        reasonCode: 'ACTION_RUNTIME_STORE_UNAVAILABLE',
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
      reasonCode: 'ACTION_RUNTIME_STORE_UNAVAILABLE',
      actionHint: 'retry-later',
    }, input.executionId, input.traceId, input.executionMode);
  }

  private async resolveIdempotencyReplay(input: {
    principalId: string;
    actionId: string;
    idempotencyKey: string;
    inputDigest: string;
    executionId: string;
    traceId: string;
    executionMode: HookActionResult['executionMode'];
  }): Promise<HookActionResult | null> {
    await this.purgeExpiredIdempotency();
    const nowMs = this.now();
    const key = makeIdempotencyKey(input);

    const memory = this.idempotencyMemory.get(key);
    if (memory && nowMs - memory.occurredAtMs <= this.idempotencyWindowMs) {
      if (memory.inputDigest !== input.inputDigest) {
        return normalizeResult({
          ok: false,
          reasonCode: 'ACTION_IDEMPOTENCY_KEY_CONFLICT',
          actionHint: 'use-new-idempotency-key',
        }, input.executionId, input.traceId, input.executionMode);
      }
      return normalizeResult({
        ok: memory.response.ok,
        reasonCode: 'ACTION_IDEMPOTENCY_REPLAYED',
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
        reasonCode: 'ACTION_IDEMPOTENCY_KEY_CONFLICT',
        actionHint: 'use-new-idempotency-key',
      }, input.executionId, input.traceId, input.executionMode);
    }

    const occurredAtMs = Date.parse(persisted.occurredAt);
    if (!Number.isFinite(occurredAtMs) || nowMs - occurredAtMs > this.idempotencyWindowMs) {
      return null;
    }

    const response = toRecord(persisted.response);
    const replayOutput = response.output && typeof response.output === 'object' && !Array.isArray(response.output)
      ? response.output as Record<string, unknown>
      : undefined;
    return normalizeResult({
      ok: Boolean(response.ok),
      reasonCode: 'ACTION_IDEMPOTENCY_REPLAYED',
      actionHint: 'replayed-previous-response',
      output: replayOutput,
      warnings: Array.isArray(response.warnings)
        ? response.warnings.map((item) => String(item || '').trim()).filter(Boolean)
        : undefined,
    }, input.executionId, input.traceId, input.executionMode);
  }

  private async storeIdempotencyRecord(input: {
    principalId: string;
    actionId: string;
    idempotencyKey: string;
    inputDigest: string;
    response: HookActionResult;
  }): Promise<void> {
    await this.purgeExpiredIdempotency();
    const nowMs = this.now();
    const key = makeIdempotencyKey(input);
    this.idempotencyMemory.set(key, {
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

  private async purgeExpiredIdempotency(): Promise<void> {
    const nowMs = this.now();
    if (nowMs - this.lastPurgeAtMs < IDEMPOTENCY_PURGE_INTERVAL_MS) {
      if (nowMs - this.lastLedgerPurgeAtMs >= LEDGER_PURGE_INTERVAL_MS) {
        await purgeActionExecutionLedger(sanitizeIsoFromMs(nowMs - this.idempotencyWindowMs));
        this.lastLedgerPurgeAtMs = nowMs;
      }
      return;
    }

    const thresholdMs = nowMs - this.idempotencyWindowMs;
    for (const [key, value] of this.idempotencyMemory.entries()) {
      if (value.occurredAtMs < thresholdMs) {
        this.idempotencyMemory.delete(key);
      }
    }
    for (const [ticketId, ticket] of this.verifyTicketMemory.entries()) {
      if (ticket.expiresAtMs <= nowMs) {
        this.verifyTicketMemory.delete(ticketId);
      }
    }

    await purgeActionIdempotencyRecords(sanitizeIsoFromMs(thresholdMs));
    await purgeActionVerifyTickets(sanitizeIsoFromMs(nowMs));
    if (nowMs - this.lastLedgerPurgeAtMs >= LEDGER_PURGE_INTERVAL_MS) {
      await purgeActionExecutionLedger(sanitizeIsoFromMs(thresholdMs));
      this.lastLedgerPurgeAtMs = nowMs;
    }
    this.lastPurgeAtMs = nowMs;
  }
}
