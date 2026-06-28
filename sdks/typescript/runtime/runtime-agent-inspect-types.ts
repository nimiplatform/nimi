import type {
  AgentAutonomyState,
  AgentEvent,
  AgentStateProjection,
  CanonicalMemoryView,
  CancelHookRequest,
  CancelHookResponse,
  DisableAutonomyRequest,
  DisableAutonomyResponse,
  EnableAutonomyRequest,
  EnableAutonomyResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetAgentStateRequest,
  GetAgentStateResponse,
  ListPendingHooksRequest,
  ListPendingHooksResponse,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  RuntimeTypedCallOptions,
  SetAutonomyConfigRequest,
  SetAutonomyConfigResponse,
  SubscribeAgentEventsRequest,
  UpdateAgentStateRequest,
  UpdateAgentStateResponse,
} from '../core-generated/runtime-typed-client';
import type { Struct } from '../core-generated/runtime-protobuf/google/protobuf/struct';
import type {
  NimiRuntimeAgentAppAuthClient,
  NimiRuntimeAgentAuthClient,
  NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import type { RuntimeLocalAgentIdentityInput } from './agent-local-identity';

export interface NimiRuntimeAgentPendingHookInspect {
  readonly hookId: string;
  readonly status: string | null;
  readonly triggerKind: string | null;
  readonly scheduledFor: string | null;
  readonly admittedAt?: string | null;
}

export interface NimiRuntimeAgentInspectEventSummary {
  readonly agentId: string;
  readonly eventType: number;
  readonly eventTypeLabel: string | null;
  readonly sequence: string;
  readonly detailKind: string | null;
  readonly timestamp: string | null;
  readonly summaryText: string | null;
  readonly hookId: string | null;
  readonly hookStatus: string | null;
  readonly lifecycleStatus: string | null;
  readonly budgetExhausted: boolean | null;
  readonly remainingTokens: number | null;
}

export interface NimiRuntimeAgentCanonicalMemoryInspect {
  readonly memoryId: string;
  readonly canonicalClass: string | null;
  readonly kind: string | null;
  readonly summary: string;
  readonly updatedAt: string | null;
  readonly sourceEventId: string | null;
  readonly policyReason: string | null;
  readonly recallScore: number | null;
}

export type NimiRuntimeAgentAutonomyMode = 'off' | 'low' | 'medium' | 'high';

export interface NimiRuntimeAgentPresentationProfileProjection {
  readonly backendKind: 'vrm' | 'live2d' | 'sprite2d' | 'canvas2d' | 'video';
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string | null;
  readonly idlePreset: string | null;
  readonly interactionPolicyRef: string | null;
  readonly defaultVoiceReference: string | null;
}

export interface NimiRuntimeAgentAutonomySnapshot {
  readonly mode: NimiRuntimeAgentAutonomyMode | null;
  readonly enabled: boolean | null;
  readonly budgetExhausted: boolean | null;
  readonly usedTokensInWindow: number | null;
  readonly dailyTokenBudget: number | null;
  readonly maxTokensPerHook: number | null;
  readonly windowStartedAt: string | null;
  readonly suspendedUntil: string | null;
}

export interface NimiRuntimeAgentStateSnapshot {
  readonly executionState: string | null;
  readonly statusText: string | null;
  readonly activeWorldId: string | null;
  readonly activeUserId: string | null;
}

export interface NimiRuntimeAgentInspectSnapshot extends NimiRuntimeAgentStateSnapshot {
  readonly lifecycleStatus: string | null;
  readonly presentationProfile?: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly autonomyMode: NimiRuntimeAgentAutonomyMode | null;
  readonly autonomyEnabled: boolean | null;
  readonly autonomyBudgetExhausted: boolean | null;
  readonly autonomyUsedTokensInWindow: number | null;
  readonly autonomyDailyTokenBudget: number | null;
  readonly autonomyMaxTokensPerHook: number | null;
  readonly autonomyWindowStartedAt: string | null;
  readonly autonomySuspendedUntil: string | null;
  readonly pendingHooksCount: number;
  readonly nextScheduledFor: string | null;
  readonly pendingHooks: readonly NimiRuntimeAgentPendingHookInspect[];
  readonly recentTerminalHooks: readonly NimiRuntimeAgentPendingHookInspect[];
  readonly recentCanonicalMemories: readonly NimiRuntimeAgentCanonicalMemoryInspect[];
}

export interface ProjectNimiRuntimeAgentInspectSnapshotInput {
  readonly agent?: {
    readonly lifecycleStatus?: unknown;
    readonly metadata?: Struct | unknown;
    readonly autonomy?: AgentAutonomyState | null;
  } | null;
  readonly state?: AgentStateProjection | null;
  readonly activeHooks?: readonly NimiRuntimeAgentPendingHookInspect[];
  readonly terminalHooks?: readonly NimiRuntimeAgentPendingHookInspect[];
  readonly recentCanonicalMemories?: readonly CanonicalMemoryView[];
  readonly maxPendingHookPreview?: number;
  readonly maxRecentTerminalHooks?: number;
}

export interface NimiRuntimeAgentStateMutationInput {
  readonly statusText?: string | null;
  readonly worldId?: string | null;
  readonly clearWorldContext?: boolean;
  readonly userId?: string | null;
  readonly clearDyadicContext?: boolean;
}

export interface NimiRuntimeAgentStateUpdateInput extends RuntimeLocalAgentIdentityInput, NimiRuntimeAgentStateMutationInput {
}

export interface NimiRuntimeAgentDisableAutonomyInput extends RuntimeLocalAgentIdentityInput {
  readonly reason: string;
}

export interface NimiRuntimeAgentAutonomyConfigInput extends RuntimeLocalAgentIdentityInput {
  readonly mode: NimiRuntimeAgentAutonomyMode | string;
  readonly dailyTokenBudget: string | number;
  readonly maxTokensPerHook: string | number;
}

export interface NimiRuntimeAgentCancelHookInput extends RuntimeLocalAgentIdentityInput {
  readonly hookId: string;
  readonly reason: string;
}

export interface NimiRuntimeAgentCancelHookResult {
  readonly hookId: string;
  readonly status: string | null;
}

export interface NimiRuntimeAgentEventSubscriptionInput extends RuntimeLocalAgentIdentityInput {
  readonly signal?: AbortSignal;
  readonly onEvent: (event: NimiRuntimeAgentInspectEventSummary) => void | Promise<void>;
}

export interface NimiRuntimeAgentInspectSurface {
  cancelHook(input: NimiRuntimeAgentCancelHookInput): Promise<NimiRuntimeAgentCancelHookResult>;
  disableAutonomy(input: NimiRuntimeAgentDisableAutonomyInput): Promise<NimiRuntimeAgentAutonomySnapshot>;
  enableAutonomy(input: RuntimeLocalAgentIdentityInput): Promise<NimiRuntimeAgentAutonomySnapshot>;
  getPublicInspect(input: RuntimeLocalAgentIdentityInput): Promise<NimiRuntimeAgentInspectSnapshot>;
  getPresentationProfile(input: RuntimeLocalAgentIdentityInput): Promise<NimiRuntimeAgentPresentationProfileProjection | null>;
  setAutonomyConfig(input: NimiRuntimeAgentAutonomyConfigInput): Promise<NimiRuntimeAgentAutonomySnapshot>;
  subscribePublicEvents(input: NimiRuntimeAgentEventSubscriptionInput): Promise<void>;
  updateState(input: NimiRuntimeAgentStateUpdateInput): Promise<NimiRuntimeAgentStateSnapshot>;
}

export interface NimiHostRuntimeAgentInspectClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: {
    getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentResponse>;
    getAgentState(request: GetAgentStateRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentStateResponse>;
    listPendingHooks(request: ListPendingHooksRequest, options?: RuntimeTypedCallOptions): Promise<ListPendingHooksResponse>;
    queryAgentMemory(request: QueryAgentMemoryRequest, options?: RuntimeTypedCallOptions): Promise<QueryAgentMemoryResponse>;
    updateAgentState?(
      request: UpdateAgentStateRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<UpdateAgentStateResponse>;
    enableAutonomy?(request: EnableAutonomyRequest, options?: RuntimeTypedCallOptions): Promise<EnableAutonomyResponse>;
    disableAutonomy?(request: DisableAutonomyRequest, options?: RuntimeTypedCallOptions): Promise<DisableAutonomyResponse>;
    setAutonomyConfig?(
      request: SetAutonomyConfigRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<SetAutonomyConfigResponse>;
    cancelHook?(request: CancelHookRequest, options?: RuntimeTypedCallOptions): Promise<CancelHookResponse>;
    subscribeAgentEvents?(
      request: SubscribeAgentEventsRequest,
      options?: RuntimeTypedCallOptions,
    ): AsyncIterable<AgentEvent>;
  };
}

export interface NimiHostRuntimeAgentInspectSurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentInspectClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
  readonly maxPendingHookPreview?: number;
  readonly maxRecentTerminalHooks?: number;
  readonly maxRecentCanonicalMemories?: number;
}
