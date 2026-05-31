import type { AIScopeRef } from '../scope/ai-scope.js';
import type { MemoryEmbeddingSourceKind } from './memory-embedding-config.js';

export type MemoryEmbeddingResolutionState =
  | 'missing'
  | 'resolved'
  | 'unresolved'
  | 'unavailable';

export type MemoryEmbeddingCanonicalBankStatus =
  | 'unbound'
  | 'bound_equivalent'
  | 'bound_profile_mismatch'
  | 'rebuild_pending'
  | 'cutover_ready';

export type MemoryEmbeddingRuntimeState = {
  bindingIntentPresent: boolean;
  bindingSourceKind: MemoryEmbeddingSourceKind | null;
  resolutionState: MemoryEmbeddingResolutionState;
  resolvedProfileIdentity: string | null;
  canonicalBankStatus: MemoryEmbeddingCanonicalBankStatus;
  blockedReasonCode: string | null;
  operationReadiness: {
    bindAllowed: boolean;
    cutoverAllowed: boolean;
  };
  traceId?: string;
};

export type MemoryEmbeddingRuntimeTargetRef = {
  kind: 'agent-core';
  agentId: string;
};

export type MemoryEmbeddingRuntimeInput = {
  scopeRef: AIScopeRef;
  targetRef: MemoryEmbeddingRuntimeTargetRef;
};

export type MemoryEmbeddingBindOutcome =
  | 'bound'
  | 'already_bound'
  | 'staged_rebuild'
  | 'rejected';

export type MemoryEmbeddingBindResult = {
  outcome: MemoryEmbeddingBindOutcome;
  blockedReasonCode: string | null;
  canonicalBankStatusAfter: MemoryEmbeddingCanonicalBankStatus;
  pendingCutover: boolean;
  traceId?: string;
};

export type MemoryEmbeddingCutoverOutcome =
  | 'cutover_committed'
  | 'already_current'
  | 'not_ready'
  | 'rejected';

export type MemoryEmbeddingCutoverResult = {
  outcome: MemoryEmbeddingCutoverOutcome;
  blockedReasonCode: string | null;
  canonicalBankStatusAfter: MemoryEmbeddingCanonicalBankStatus;
  traceId?: string;
};

export type MemoryEmbeddingRuntimeSurface = {
  inspect(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingRuntimeState>;
  requestBind(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingBindResult>;
  requestCutover(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingCutoverResult>;
};
