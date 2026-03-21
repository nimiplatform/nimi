import Ajv, { type ValidateFunction } from 'ajv';
import type {
  HookActionAuditFilter,
  HookActionCommitRequest,
  HookActionCommitResult,
  HookActionDescriptorView,
  HookActionDiscoverFilter,
  HookActionDryRunRequest,
  HookActionRegistrationInput,
  HookActionRegistryChangeEvent,
  HookActionResult,
  HookActionVerifyRequest,
  HookActionVerifyResult,
} from '../contracts/action.js';
import { createHookError } from '../contracts/errors.js';
import { assertActionDescriptorFinalState } from '../action-fabric/descriptor-validator.js';
import {
  sanitizeActionId,
  toRecord,
} from './action-runtime/primitives.js';
import type {
  ActionEntry,
  ActionServiceContext,
  InMemoryIdempotencyRecord,
  InMemoryVerifyTicket,
} from './action-service-types.js';
import {
  DEFAULT_IDEMPOTENCY_WINDOW_MS,
  DEFAULT_VERIFY_TICKET_WINDOW_MS,
} from './action-service-types.js';
import { runPhase, runVerifyPhase } from './action-service-preflight.js';
import { emitRuntimeLog } from '@runtime/telemetry/logger';

export type { ActionServiceInput } from './action-service-types.js';

export class HookRuntimeActionService {
  private readonly ctx: ActionServiceContext;

  constructor(context: import('./action-service-types.js').ActionServiceInput) {
    const entries = new Map<string, ActionEntry>();
    const registryListeners = new Set<(event: HookActionRegistryChangeEvent) => void>();
    const ajv = new Ajv({
      allErrors: true,
      strict: false,
      allowUnionTypes: true,
    });
    const idempotencyMemory = new Map<string, InMemoryIdempotencyRecord>();
    const verifyTicketMemory = new Map<string, InMemoryVerifyTicket>();
    const now = context.now || Date.now;
    const idempotencyWindowMs = context.idempotencyWindowMs || DEFAULT_IDEMPOTENCY_WINDOW_MS;
    const verifyTicketWindowMs = context.verifyTicketWindowMs || DEFAULT_VERIFY_TICKET_WINDOW_MS;

    this.ctx = {
      entries,
      registryListeners,
      ajv,
      idempotencyMemory,
      verifyTicketMemory,
      now,
      idempotencyWindowMs,
      verifyTicketWindowMs,
      lastPurgeAtMs: 0,
      lastLedgerPurgeAtMs: 0,
      serviceInput: context,
    };
  }

  subscribeActionRegistryChanges(
    listener: (event: HookActionRegistryChangeEvent) => void,
  ): () => void {
    this.ctx.registryListeners.add(listener);
    return () => {
      this.ctx.registryListeners.delete(listener);
    };
  }

  private emitRegistryChange(event: HookActionRegistryChangeEvent): void {
    for (const listener of this.ctx.registryListeners) {
      try {
        listener(event);
      } catch (error) {
        // Listener failures must not block action registry mutation.
        emitRuntimeLog({
          level: 'warn',
          area: 'hook-action',
          message: 'registry-listener-failed',
          details: {
            error: error instanceof Error ? error.message : String(error || 'unknown error'),
          },
        });
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
      inputValidator = this.ctx.ajv.compile(input.descriptor.inputSchema || {});
      outputValidator = this.ctx.ajv.compile(input.descriptor.outputSchema || {});
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

    this.ctx.entries.set(actionId, {
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
    const current = this.ctx.entries.get(actionId);
    if (!current || current.modId !== input.modId) {
      return false;
    }
    this.ctx.entries.delete(actionId);
    this.emitRegistryChange({
      type: 'unregistered',
      actionId,
      modId: current.modId,
    });
    return true;
  }

  discoverActions(filter?: HookActionDiscoverFilter): HookActionDescriptorView[] {
    const result = Array.from(this.ctx.entries.values()).map((item) => item.descriptor);
    return result.filter((item) => {
      if (filter?.modId && item.modId !== filter.modId) return false;
      if (filter?.executionMode && item.executionMode !== filter.executionMode) return false;
      if (!filter?.includeOpaque && item.executionMode === 'opaque') return false;
      return true;
    });
  }

  async dryRunAction(input: HookActionDryRunRequest): Promise<HookActionResult> {
    return runPhase(this.ctx, {
      actionId: input.actionId,
      input: toRecord(input.input),
      requestContext: input.context,
      idempotencyKey: input.idempotencyKey,
      phase: 'dry-run',
    });
  }

  async verifyAction(input: HookActionVerifyRequest): Promise<HookActionVerifyResult> {
    return runVerifyPhase(this.ctx, {
      actionId: input.actionId,
      input: toRecord(input.input),
      requestContext: input.context,
      idempotencyKey: input.idempotencyKey,
      ttlSeconds: input.ttlSeconds,
      phase: 'verify',
    });
  }

  async commitAction(input: HookActionCommitRequest): Promise<HookActionCommitResult> {
    return runPhase(this.ctx, {
      actionId: input.actionId,
      input: toRecord(input.input),
      requestContext: input.context,
      idempotencyKey: input.idempotencyKey,
      verifyTicket: String(input.verifyTicket || '').trim() || undefined,
      phase: 'commit',
    });
  }

  queryActionAudit(filter?: HookActionAuditFilter): Promise<import('../contracts/action.js').HookActionAuditRecord[]> {
    return this.ctx.serviceInput.auditSink.query(filter);
  }
}
