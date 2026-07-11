import type {
  InspectMemoryEmbeddingRuntimeRequest,
  InspectMemoryEmbeddingRuntimeResponse,
  MemoryBankLocator,
  RequestMemoryEmbeddingRuntimeBindRequest,
  RequestMemoryEmbeddingRuntimeBindResponse,
  RequestMemoryEmbeddingRuntimeCutoverRequest,
  RequestMemoryEmbeddingRuntimeCutoverResponse,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';

export type NimiMemoryEmbeddingSourceKind = 'cloud' | 'local';

export interface NimiMemoryEmbeddingScopeRef {
  readonly kind: string;
  readonly ownerId: string;
  readonly surfaceId?: string;
}

export interface NimiMemoryEmbeddingCloudConfigBindingRef {
  readonly kind: 'cloud';
  readonly connectorId: string;
  readonly remoteModelCatalogId: string;
  readonly providerModelId: string;
  readonly provider: string;
}

export type NimiMemoryEmbeddingLocalConfigBindingRef =
  | {
  readonly kind: 'local';
      readonly profileBindingId: string;
      readonly readinessRef?: never;
    }
  | {
      readonly kind: 'local';
      readonly readinessRef: string;
      readonly profileBindingId?: never;
    };

export type NimiMemoryEmbeddingBindingRef =
  | NimiMemoryEmbeddingCloudConfigBindingRef
  | NimiMemoryEmbeddingLocalConfigBindingRef;

export interface NimiMemoryEmbeddingConfig {
  readonly scopeRef: NimiMemoryEmbeddingScopeRef;
  readonly sourceKind: NimiMemoryEmbeddingSourceKind | null;
  readonly bindingRef: NimiMemoryEmbeddingBindingRef | null;
  readonly revisionToken: string;
  readonly updatedAt: string;
}

export interface NimiMemoryEmbeddingRuntimeTargetRef {
  readonly kind: 'agent-core';
  readonly localAgentRef: string;
}

export interface NimiMemoryEmbeddingRuntimeInput {
  readonly targetRef: NimiMemoryEmbeddingRuntimeTargetRef;
}

export type NimiMemoryEmbeddingResolutionState = 'missing' | 'resolved' | 'unresolved' | 'unavailable';
export type NimiMemoryEmbeddingCanonicalBankStatus =
  | 'unbound'
  | 'bound_equivalent'
  | 'bound_profile_mismatch'
  | 'rebuild_pending'
  | 'cutover_ready';

export interface NimiMemoryEmbeddingRuntimeState {
  readonly textEmbedIntentPresent: boolean;
  readonly textEmbedSourceKind: NimiMemoryEmbeddingSourceKind | null;
  readonly configRevision: number;
  readonly resolutionState: NimiMemoryEmbeddingResolutionState;
  readonly resolvedProfileIdentity: string | null;
  readonly canonicalBankStatus: NimiMemoryEmbeddingCanonicalBankStatus;
  readonly blockedReasonCode: string | null;
  readonly operationReadiness: {
    readonly bindAllowed: boolean;
    readonly cutoverAllowed: boolean;
  };
}

export type NimiMemoryEmbeddingBindOutcome = 'bound' | 'already_bound' | 'staged_rebuild' | 'rejected';
export type NimiMemoryEmbeddingCutoverOutcome = 'cutover_committed' | 'already_current' | 'not_ready' | 'rejected';

export interface NimiMemoryEmbeddingBindResult {
  readonly outcome: NimiMemoryEmbeddingBindOutcome;
  readonly blockedReasonCode: string | null;
  readonly canonicalBankStatusAfter: NimiMemoryEmbeddingCanonicalBankStatus;
  readonly pendingCutover: boolean;
}

export interface NimiMemoryEmbeddingCutoverResult {
  readonly outcome: NimiMemoryEmbeddingCutoverOutcome;
  readonly blockedReasonCode: string | null;
  readonly canonicalBankStatusAfter: NimiMemoryEmbeddingCanonicalBankStatus;
}

export interface NimiMemoryEmbeddingRuntimeSurface {
  inspect(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingRuntimeState>;
  requestBind(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingBindResult>;
  requestCutover(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingCutoverResult>;
}

export interface NimiMemoryEmbeddingRuntimeClient {
  inspectMemoryEmbeddingRuntime(
    request: InspectMemoryEmbeddingRuntimeRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<InspectMemoryEmbeddingRuntimeResponse>;
  requestMemoryEmbeddingRuntimeBind(
    request: RequestMemoryEmbeddingRuntimeBindRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<RequestMemoryEmbeddingRuntimeBindResponse>;
  requestMemoryEmbeddingRuntimeCutover(
    request: RequestMemoryEmbeddingRuntimeCutoverRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<RequestMemoryEmbeddingRuntimeCutoverResponse>;
}

export interface NimiHostMemoryEmbeddingRuntimeClient {
  readonly appId: string;
  readonly memory: NimiMemoryEmbeddingRuntimeClient;
}

export type NimiMemoryEmbeddingAwaitable<T> = T | Promise<T>;

export interface NimiHostMemoryEmbeddingRuntimeSurfaceOptions {
  readonly runtime: () => NimiMemoryEmbeddingAwaitable<NimiHostMemoryEmbeddingRuntimeClient>;
  readonly getSubjectUserId: () => NimiMemoryEmbeddingAwaitable<string>;
  readonly withScopes?: <T>(
    scopes: readonly string[],
    operation: (options: RuntimeTypedCallOptions) => Promise<T>,
  ) => Promise<T>;
  readonly unavailableReasonCode?: string;
}

export interface NimiProtectedHostMemoryEmbeddingRuntimeClient extends NimiHostMemoryEmbeddingRuntimeClient {}

export interface NimiProtectedHostMemoryEmbeddingRuntimeSurfaceOptions
  extends Omit<NimiHostMemoryEmbeddingRuntimeSurfaceOptions, 'runtime'> {
  readonly runtime: () => NimiMemoryEmbeddingAwaitable<NimiProtectedHostMemoryEmbeddingRuntimeClient>;
}
export type NimiMemoryEmbeddingBankLocator = MemoryBankLocator;
