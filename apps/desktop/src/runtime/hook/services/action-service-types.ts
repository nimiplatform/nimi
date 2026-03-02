import type Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import type {
  HookActionDescriptorView,
  HookActionHandler,
  HookActionRegistryChangeEvent,
  HookActionRequestContext,
  HookActionResult,
} from '../contracts/action.js';
import type { HookSourceType } from '../contracts/types.js';
import type { PermissionResolver } from './utils.js';
import type { HookActionAuditSink } from '../audit/action-audit-sink.js';
import type { HookActionSocialPreconditionService } from './action-social-precondition.js';
import type { ActionExecutionPhase } from '../action-fabric/context.js';

export type ActionEntry = {
  modId: string;
  sourceType: HookSourceType;
  descriptor: HookActionDescriptorView;
  handler: HookActionHandler;
  inputValidator: ValidateFunction;
  outputValidator: ValidateFunction;
};

export type InMemoryIdempotencyRecord = {
  principalId: string;
  actionId: string;
  idempotencyKey: string;
  inputDigest: string;
  response: HookActionResult;
  occurredAtMs: number;
};

export type InMemoryVerifyTicket = {
  ticketId: string;
  principalId: string;
  actionId: string;
  traceId: string;
  inputDigest: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type PreflightContext = {
  entry: ActionEntry;
  input: Record<string, unknown>;
  requestContext: HookActionRequestContext;
  traceId: string;
  executionId: string;
  phase: ActionExecutionPhase;
};

export type ActionExecutionLedgerStatus =
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

export const DEFAULT_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_VERIFY_TICKET_WINDOW_MS = 15 * 60 * 1000;
export const IDEMPOTENCY_PURGE_INTERVAL_MS = 15 * 60 * 1000;
export const LEDGER_PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Minimal context interface passed to extracted standalone functions.
 * Captures the internal state and dependencies that private methods
 * of HookRuntimeActionService previously accessed via `this`.
 */
export interface ActionServiceContext {
  readonly entries: Map<string, ActionEntry>;
  readonly registryListeners: Set<(event: HookActionRegistryChangeEvent) => void>;
  readonly ajv: Ajv;
  readonly idempotencyMemory: Map<string, InMemoryIdempotencyRecord>;
  readonly verifyTicketMemory: Map<string, InMemoryVerifyTicket>;
  readonly now: () => number;
  readonly idempotencyWindowMs: number;
  readonly verifyTicketWindowMs: number;
  lastPurgeAtMs: number;
  lastLedgerPurgeAtMs: number;
  readonly serviceInput: ActionServiceInput;
}
