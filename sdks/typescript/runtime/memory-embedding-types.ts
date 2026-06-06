import type {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  GetMemoryEmbeddingRuntimeIntentRequest,
  GetMemoryEmbeddingRuntimeIntentResponse,
  InspectMemoryEmbeddingRuntimeRequest,
  InspectMemoryEmbeddingRuntimeResponse,
  MemoryBankLocator,
  MemoryEmbeddingBindingIntentSnapshot,
  RegisterAppRequest,
  RegisterAppResponse,
  RequestMemoryEmbeddingRuntimeBindRequest,
  RequestMemoryEmbeddingRuntimeBindResponse,
  RequestMemoryEmbeddingRuntimeCutoverRequest,
  RequestMemoryEmbeddingRuntimeCutoverResponse,
  RuntimeTypedCallOptions,
  SetMemoryEmbeddingRuntimeIntentRequest,
  SetMemoryEmbeddingRuntimeIntentResponse,
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
  readonly modelId: string;
}

export interface NimiMemoryEmbeddingLocalConfigBindingRef {
  readonly kind: 'local';
  readonly targetId: string;
}

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

export interface NimiMemoryEmbeddingConfigInput {
  readonly scopeRef: NimiMemoryEmbeddingScopeRef;
  readonly targetRef: NimiMemoryEmbeddingRuntimeTargetRef;
}

export interface NimiMemoryEmbeddingConfigSurface {
  get(input: NimiMemoryEmbeddingConfigInput): Promise<NimiMemoryEmbeddingConfig>;
  update(
    input: NimiMemoryEmbeddingConfigInput,
    config: NimiMemoryEmbeddingConfig,
  ): Promise<NimiMemoryEmbeddingConfig>;
  subscribe(
    input: NimiMemoryEmbeddingConfigInput,
    callback: (config: NimiMemoryEmbeddingConfig) => void,
  ): () => void;
}

export type NimiMemoryEmbeddingResolutionState = 'missing' | 'resolved' | 'unresolved' | 'unavailable';
export type NimiMemoryEmbeddingCanonicalBankStatus =
  | 'unbound'
  | 'bound_equivalent'
  | 'bound_profile_mismatch'
  | 'rebuild_pending'
  | 'cutover_ready';

export interface NimiMemoryEmbeddingRuntimeState {
  readonly bindingIntentPresent: boolean;
  readonly bindingSourceKind: NimiMemoryEmbeddingSourceKind | null;
  readonly resolutionState: NimiMemoryEmbeddingResolutionState;
  readonly resolvedProfileIdentity: string | null;
  readonly canonicalBankStatus: NimiMemoryEmbeddingCanonicalBankStatus;
  readonly blockedReasonCode: string | null;
  readonly operationReadiness: {
    readonly bindAllowed: boolean;
    readonly cutoverAllowed: boolean;
  };
}

export type NimiMemoryEmbeddingRuntimeInput = NimiMemoryEmbeddingConfigInput;
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

export interface NimiMemoryEmbeddingConfigClient {
  getMemoryEmbeddingRuntimeIntent(
    request: GetMemoryEmbeddingRuntimeIntentRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetMemoryEmbeddingRuntimeIntentResponse>;
  setMemoryEmbeddingRuntimeIntent(
    request: SetMemoryEmbeddingRuntimeIntentRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<SetMemoryEmbeddingRuntimeIntentResponse>;
}

export interface NimiMemoryEmbeddingAuthClient {
  registerApp(request: RegisterAppRequest, options?: RuntimeTypedCallOptions): Promise<RegisterAppResponse>;
}

export interface NimiMemoryEmbeddingAppAuthClient {
  authorizeExternalPrincipal(
    request: AuthorizeExternalPrincipalRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<AuthorizeExternalPrincipalResponse>;
}

export interface NimiHostMemoryEmbeddingRuntimeClient {
  readonly appId: string;
  readonly memory: NimiMemoryEmbeddingRuntimeClient;
}

export interface NimiHostMemoryEmbeddingConfigClient {
  readonly appId: string;
  readonly memory: NimiMemoryEmbeddingConfigClient;
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

export interface NimiHostMemoryEmbeddingConfigSurfaceOptions {
  readonly runtime: () => NimiMemoryEmbeddingAwaitable<NimiHostMemoryEmbeddingConfigClient>;
  readonly getSubjectUserId: () => NimiMemoryEmbeddingAwaitable<string>;
  readonly withScopes?: <T>(
    scopes: readonly string[],
    operation: (options: RuntimeTypedCallOptions) => Promise<T>,
  ) => Promise<T>;
}

export interface NimiProtectedHostMemoryEmbeddingRuntimeClient extends NimiHostMemoryEmbeddingRuntimeClient {
  readonly auth: NimiMemoryEmbeddingAuthClient;
  readonly appAuth: NimiMemoryEmbeddingAppAuthClient;
}

export interface NimiProtectedHostMemoryEmbeddingConfigClient extends NimiHostMemoryEmbeddingConfigClient {
  readonly auth: NimiMemoryEmbeddingAuthClient;
  readonly appAuth: NimiMemoryEmbeddingAppAuthClient;
}

export interface NimiProtectedHostMemoryEmbeddingRuntimeSurfaceOptions
  extends Omit<NimiHostMemoryEmbeddingRuntimeSurfaceOptions, 'runtime' | 'withScopes'> {
  readonly runtime: () => NimiMemoryEmbeddingAwaitable<NimiProtectedHostMemoryEmbeddingRuntimeClient>;
}

export interface NimiProtectedHostMemoryEmbeddingConfigSurfaceOptions
  extends Omit<NimiHostMemoryEmbeddingConfigSurfaceOptions, 'runtime' | 'withScopes'> {
  readonly runtime: () => NimiMemoryEmbeddingAwaitable<NimiProtectedHostMemoryEmbeddingConfigClient>;
}

export type NimiMemoryEmbeddingIntentSnapshot = MemoryEmbeddingBindingIntentSnapshot;
export type NimiMemoryEmbeddingBankLocator = MemoryBankLocator;
