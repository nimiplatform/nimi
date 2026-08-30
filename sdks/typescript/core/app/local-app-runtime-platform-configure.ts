import type {
  NimiSharedLocalAgentAIConfigOptionsQuery,
  NimiSharedLocalAgentAIConfigOptionsResult,
  NimiAIConfigOverwriteInput,
  NimiSharedLocalAgentAIConfigOverwriteResult,
  NimiSharedLocalAgentAIConfigSnapshot,
  NimiSharedLocalAgentCapabilityParticipation,
  NimiCapabilityAIConfig,
} from '../ai/capability-configuration.js';
import { validateCapabilityIntents } from './local-app-runtime-platform-ai-config.js';
import {
  AIConfigEffectiveState,
  AgentContextProjectionReasonCode,
  AgentConversationSummaryStatus,
  AgentExecutionState,
  AgentLifecycleStatus,
  AgentLocalSourceContextState,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentPresentationAssetRole,
  AgentPresentationBackendKind,
  AgentSourceCognitionStatus,
  AgentTurnContextLaneId,
  AgentTurnContextLaneState,
  AgentTurnContextState,
  AgentTurnContextTruncationReason,
  CognitionMemoryEpistemicStatus,
  CognitionMemoryLifecycle,
  CognitionMemoryOutcome,
  LocalAgentCapabilityParticipationRole,
  LocalAppAgentManagerActionAvailabilityState,
  LocalAppAgentManagerActionUnavailableReason,
  LocalAppAgentManagerProductAction,
  LocalAppAgentAutonomyMode,
  ReasonCode,
  type CommitLocalAppAgentPresentationRequest,
  type CorrectLocalAppAgentMemoryRequest,
  type CorrectLocalAppAgentMemoryResponse,
  type DeleteAllLocalAppAgentMemoryRequest,
  type DeleteAllLocalAppAgentMemoryResponse,
  type ForgetLocalAppAgentMemoryRequest,
  type ForgetLocalAppAgentMemoryResponse,
  type GetAgentPresentationAssetRequest,
  type GetAgentPresentationAssetResponse,
  type GetLocalAppAgentAutonomySnapshotRequest,
  type GetLocalAppAgentManagerSnapshotRequest,
  type GetLocalAppAgentManagerSnapshotResponse,
  type GetLocalAppAgentPresentationSnapshotRequest,
  type GetLocalAppSharedLocalAgentAIConfigRequest,
  type GetLocalAppSharedLocalAgentAIConfigResponse,
  type InspectLocalAppAgentMemoryRequest,
  type InspectLocalAppAgentMemoryResponse,
  type ListLocalAppSharedLocalAgentAIConfigOptionsRequest,
  type ListLocalAppSharedLocalAgentAIConfigOptionsResponse,
  type LocalAppAgentAutonomyProjection as RuntimeLocalAppAgentAutonomyProjection,
  type LocalAppAgentAutonomySnapshotResponse,
  type LocalAppAgentCommitPresentationResponse,
  type LocalAppAgentPresentationProjection as RuntimeLocalAppAgentPresentationProjection,
  type LocalAppAgentPresentationSnapshotResponse,
  type LocalAppAgentUpdateAutonomyResponse,
  type LocalAppSharedLocalAgentAIConfigProjection,
  type OverwriteLocalAppSharedLocalAgentAIConfigRequest,
  type OverwriteLocalAppSharedLocalAgentAIConfigResponse,
  type RuntimeTypedCallOptions,
  type TextBehaviorCapabilityProjection,
  type SetLocalAppAgentMemoryEnabledRequest,
  type SetLocalAppAgentMemoryEnabledResponse,
  type UpdateLocalAppAgentAutonomyRequest,
} from '../../core-generated/runtime-typed-client.js';
import { projectNimiTextBehaviorCapabilities } from '../../runtime/text-behavior-projections.js';
import {
  validateAgentHandle,
  type NimiLocalAppAgentHandle,
} from './local-app-runtime-platform-conversation.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  localAppError,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAgentAutonomyMode = 'off' | 'low' | 'medium' | 'high';
export type NimiLocalAppAgentPresentationBackendKind = 'vrm' | 'live2d' | 'sprite2d' | 'canvas2d' | 'video';
export type NimiLocalAppRevision = string;

export type NimiLocalAppTimestamp = {
  readonly seconds: string;
  readonly nanos: number;
};

export type NimiLocalAppDuration = {
  readonly seconds: string;
  readonly nanos: number;
};

export type NimiLocalAppAgentAutonomyConfig = {
  readonly dailyTokenBudget: number;
  readonly maxTokensPerHook: number;
  readonly minHookInterval?: NimiLocalAppDuration;
  readonly suspendUntil?: NimiLocalAppTimestamp;
  readonly mode: NimiLocalAppAgentAutonomyMode;
};

export type NimiLocalAppAgentAutonomyProjection = {
  readonly enabled: boolean;
  readonly config: NimiLocalAppAgentAutonomyConfig | null;
  readonly usedTokensInWindow: number;
  readonly windowStartedAt?: NimiLocalAppTimestamp;
  readonly budgetExhausted: boolean;
  readonly suspendedUntil?: NimiLocalAppTimestamp;
  readonly autonomyRevision: NimiLocalAppRevision;
};

export type NimiLocalAppAgentAutonomyIntent = {
  readonly enabled?: boolean;
  readonly config?: NimiLocalAppAgentAutonomyConfig;
};

export type NimiLocalAppAgentPresentationProfile = {
  readonly backendKind: NimiLocalAppAgentPresentationBackendKind | null;
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string;
  readonly idlePreset: string;
  readonly interactionPolicyRef: string;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly backgroundAssetRef: string;
  readonly revision: NimiLocalAppRevision;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r112
export type NimiLocalAppAgentResourcePackSelection = {
  readonly assetRef: string;
  readonly targetId: 'zhiyu-experience-surface';
  readonly targetVersion: 1;
};

export type NimiLocalAppAgentPresentationProjection = {
  readonly profile: NimiLocalAppAgentPresentationProfile | null;
  readonly previousProfile: NimiLocalAppAgentPresentationProfile | null;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly presentationRevision: NimiLocalAppRevision;
  readonly resourcePackSelection: NimiLocalAppAgentResourcePackSelection | null;
};

type NimiLocalAppAgentPresentationMaterialBase = {
  readonly fileName: string;
  readonly content: Uint8Array;
  readonly sha256: string;
};

export type NimiLocalAppAgentPresentationAssetMaterial =
  | (NimiLocalAppAgentPresentationMaterialBase & {
    readonly role: 'avatar' | 'background';
    readonly mediaType: string;
  })
  | (NimiLocalAppAgentPresentationMaterialBase & {
    readonly role: 'resource-pack';
    readonly mediaType: 'application/vnd.nimi.resource-pack+zip';
  });

type NimiLocalAppAgentPresentationAssetBase = {
  readonly assetRef: string;
  readonly fileName: string;
  readonly content: Uint8Array;
  readonly sha256: string;
};

export type NimiLocalAppAgentPresentationAsset =
  | (NimiLocalAppAgentPresentationAssetBase & {
    readonly role: 'avatar';
    readonly backendKind: NimiLocalAppAgentPresentationBackendKind;
    readonly mediaType: string;
  })
  | (NimiLocalAppAgentPresentationAssetBase & {
    readonly role: 'resource-pack';
    readonly mediaType: 'application/vnd.nimi.resource-pack+zip';
  });

export type NimiLocalAppAgentPresentationAppearanceIntent = {
  readonly backendKind?: NimiLocalAppAgentPresentationBackendKind;
  readonly avatarAssetRef?: string;
  readonly expressionProfileRef?: string;
  readonly idlePreset?: string;
  readonly interactionPolicyRef?: string;
  readonly defaultVoiceReference?: string;
  readonly avatarAutoplay?: boolean;
  readonly backgroundAssetRef?: string;
};

export type NimiLocalAppAgentResourcePackApplyIntent = {
  readonly selectImportedResourcePack: true;
};

export type NimiLocalAppAgentResourcePackClearIntent = {
  readonly clearResourcePackSelection: true;
};

export type NimiLocalAppAgentPresentationIntent =
  | NimiLocalAppAgentPresentationAppearanceIntent
  | NimiLocalAppAgentResourcePackApplyIntent
  | NimiLocalAppAgentResourcePackClearIntent;

export type NimiLocalAppAgentScopedInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
};

export type NimiLocalAppAutonomySnapshotInput = NimiLocalAppAgentScopedInput;

export type NimiLocalAppAutonomyUpdateInput = NimiLocalAppAgentScopedInput & {
  readonly expectedAutonomyRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentAutonomyIntent;
};

export type NimiLocalAppPresentationSnapshotInput = NimiLocalAppAgentScopedInput;

export type NimiLocalAppPresentationAssetReadInput = NimiLocalAppAgentScopedInput & {
  readonly assetRef: string;
};

export type NimiLocalAppPresentationCommitInput = NimiLocalAppAgentScopedInput & {
  readonly expectedPresentationRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentPresentationIntent;
  readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
};

export type NimiLocalAppAgentMemoryItem = Readonly<{
  memoryId: string;
  content: string;
  epistemicStatus: 'explicit' | 'inferred' | 'consolidated';
  lifecycle: 'current' | 'superseded' | 'conflicted';
  occurredAt: string;
  updatedAt: string;
  sourceExplanation: string;
}>;

export type NimiLocalAppAgentMemoryProjection = Readonly<{
  outcome: 'unconfigured' | 'building' | 'ready' | 'no_hits' | 'unavailable' | 'failed' | 'invalid' | 'pending' | 'committed' | 'conflict' | 'forgotten' | 'deleted' | 'no_effect' | 'admitted' | 'rejected';
  enabled: boolean;
  adoptionRequired: boolean;
  items: readonly NimiLocalAppAgentMemoryItem[];
  currentCount: number;
  supersededCount: number;
  forgottenCount: number;
  nextPageToken: string | null;
}>;

export type NimiLocalAppAgentMemoryInspectInput = NimiLocalAppAgentScopedInput & {
  readonly limit?: number;
  readonly pageToken?: string;
};

export type NimiLocalAppAgentMemoryMutationResult = Readonly<{
  outcome: NimiLocalAppAgentMemoryProjection['outcome'];
  affectedMemoryIds: readonly string[];
  projection: NimiLocalAppAgentMemoryProjection;
}>;

export type NimiLocalAppAgentLifecycleStatus =
  | 'initializing'
  | 'active'
  | 'suspended'
  | 'terminating'
  | 'terminated';

export type NimiLocalAppAgentExecutionState =
  | 'idle'
  | 'chat-active'
  | 'life-pending'
  | 'life-running'
  | 'suspended';

export type NimiLocalAppAgentManagerSourceState =
  | 'not_materialized'
  | 'validating'
  | 'ready'
  | 'invalid'
  | 'deleted';

export type NimiLocalAppAgentManagerContextState =
  | 'not_composed'
  | 'ready'
  | 'context_capacity_exceeded'
  | 'invalid';

export type NimiLocalAppAgentManagerReasonCode =
  | 'none'
  | 'source_not_materialized'
  | 'source_validation_pending'
  | 'source_snapshot_invalid'
  | 'context_not_composed'
  | 'context_capacity_exceeded'
  | 'context_manifest_invalid';

export type NimiLocalAppAgentManagerCoverageSection =
  | 'identity'
  | 'presentation'
  | 'biography'
  | 'psychology'
  | 'knowledge'
  | 'relationships'
  | 'capabilities'
  | 'interaction_profile'
  | 'assets'
  | 'authoring'
  | 'world_core'
  | 'bound_entity'
  | 'dependency_closure';

export type NimiLocalAppAgentManagerCoverageState =
  | 'complete'
  | 'not_applicable'
  | 'optional_omitted'
  | 'invalid';

export type NimiLocalAppAgentManagerLaneId =
  | 'runtime_policy'
  | 'output_contract'
  | 'source_identity'
  | 'source_behavior'
  | 'world_context'
  | 'relationship_context'
  | 'source_knowledge'
  | 'canonical_memory'
  | 'conversation_history'
  | 'capability_context'
  | 'current_user_turn'
  | 'cognition_source'
  | 'conversation_summary'
  | 'private_recall';

export type NimiLocalAppAgentManagerLaneState =
  | 'included'
  | 'empty'
  | 'omitted'
  | 'truncated'
  | 'invalid';

export type NimiLocalAppAgentManagerTruncationReason =
  | 'none'
  | 'input_budget_exhausted'
  | 'optional_content_omitted'
  | 'context_capacity_exceeded';

export type NimiLocalAppAgentManagerSourceCognitionStatus =
  | 'unconfigured'
  | 'building'
  | 'ready'
  | 'unavailable'
  | 'failure'
  | 'no_hits'
  | 'no_result';

export type NimiLocalAppAgentManagerConversationSummaryStatus =
  | 'absent'
  | 'ready'
  | 'failed'
  | 'omitted'
  | 'unavailable';

export type NimiLocalAppAgentManagerCoverageProjection = Readonly<{
  section: NimiLocalAppAgentManagerCoverageSection;
  state: NimiLocalAppAgentManagerCoverageState;
  requiredCount: number;
  resolvedCount: number;
  omittedCount: number;
}>;

export type NimiLocalAppAgentManagerSourceProjection = Readonly<{
  ready: boolean;
  state: NimiLocalAppAgentManagerSourceState;
  reasonCode: NimiLocalAppAgentManagerReasonCode;
  capturedAt: NimiLocalAppTimestamp | null;
  coverageSections: readonly NimiLocalAppAgentManagerCoverageProjection[];
  lorebookReady: boolean;
  lorebookItemCount: number;
  lorebookEstimatedTokens: string;
}>;

export type NimiLocalAppAgentManagerLaneProjection = Readonly<{
  laneId: NimiLocalAppAgentManagerLaneId;
  state: NimiLocalAppAgentManagerLaneState;
  includedItemCount: number;
  omittedItemCount: number;
  truncatedItemCount: number;
  allocatedTokens: string;
  usedTokens: string;
}>;

export type NimiLocalAppAgentManagerTruncationProjection = Readonly<{
  reason: NimiLocalAppAgentManagerTruncationReason;
  omittedItemCount: number;
  truncatedItemCount: number;
}>;

export type NimiLocalAppAgentManagerContextProjection = Readonly<{
  ready: boolean;
  state: NimiLocalAppAgentManagerContextState;
  reasonCode: NimiLocalAppAgentManagerReasonCode;
  lanes: readonly NimiLocalAppAgentManagerLaneProjection[];
  inputBudgetTokens: string;
  usedTokens: string;
  requiredInputTokens: string;
  requiredContextWindowTokens: string;
  truncation: readonly NimiLocalAppAgentManagerTruncationProjection[];
  transcriptTurnCount: number;
  memoryItemCount: number;
  mediaCount: number;
  toolCount: number;
  sourceAdapterStatus: NimiLocalAppAgentManagerSourceCognitionStatus;
  sourceSelectionStatus: NimiLocalAppAgentManagerSourceCognitionStatus;
  conversationSummaryStatus: NimiLocalAppAgentManagerConversationSummaryStatus;
  privateRecallCount: number;
}>;

export const NIMI_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTIONS = [
  'getSharedAIConfig',
  'overwriteSharedAIConfig',
  'readAutonomy',
  'updateAutonomy',
  'inspectMemory',
  'correctMemory',
  'forgetMemory',
  'switchMemory',
  'deleteAllMemory',
  'replaceAppearance',
  'restorePreviousAppearance',
] as const;

export type NimiLocalAppAgentManagerProductAction =
  typeof NIMI_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTIONS[number];

export type NimiLocalAppAgentManagerActionUnavailableReason =
  | 'operation-unavailable'
  | 'owner-unavailable'
  | 'memory-disabled'
  | 'memory-adoption-required'
  | 'previous-presentation-unavailable';

export type NimiLocalAppAgentManagerActionAvailability =
  | Readonly<{ state: 'available'; reason: null }>
  | Readonly<{
      state: 'unavailable';
      reason: NimiLocalAppAgentManagerActionUnavailableReason;
    }>;

export type NimiLocalAppAgentManagerActionAvailabilityProjection = Readonly<
  Record<NimiLocalAppAgentManagerProductAction, NimiLocalAppAgentManagerActionAvailability>
>;

/**
 * Safe Agent Center owner snapshot for covered Apps. It intentionally carries
 * no raw Agent/account/source identity, hashes, prompt or reasoning material,
 * provider/model/storage facts, or owner generations.
 */
export type NimiLocalAppAgentManagerSnapshot = Readonly<{
  lifecycleStatus: NimiLocalAppAgentLifecycleStatus;
  executionState: NimiLocalAppAgentExecutionState;
  statusText: string;
  currentEmotion: string;
  source: NimiLocalAppAgentManagerSourceProjection | null;
  context: NimiLocalAppAgentManagerContextProjection | null;
  actionAvailability: NimiLocalAppAgentManagerActionAvailabilityProjection;
}>;

export type NimiLocalAppAgentManagerSnapshotInput = NimiLocalAppAgentScopedInput & {
  readonly conversationAnchorId?: string;
};

export type NimiLocalAppAgentConfigureShell = {
  readonly sharedAIConfig: {
    readonly get: () => Promise<unknown>;
    readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<unknown>;
    readonly listOptions: (query: NimiSharedLocalAgentAIConfigOptionsQuery) => Promise<unknown>;
  };
  readonly autonomy: {
    readonly snapshot: (input: { readonly agentHandle: string }) => Promise<unknown>;
    readonly update: (input: {
      readonly agentHandle: string;
      readonly expectedAutonomyRevision: string;
      readonly intent: NimiLocalAppAgentAutonomyIntent;
    }) => Promise<unknown>;
  };
  readonly presentation: {
    readonly snapshot: (input: { readonly agentHandle: string }) => Promise<unknown>;
    readonly readAsset: (input: { readonly agentHandle: string; readonly assetRef: string }) => Promise<unknown>;
    readonly commit: (input: {
      readonly agentHandle: string;
      readonly expectedPresentationRevision: string;
      readonly intent: NimiLocalAppAgentPresentationIntent;
      readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
    }) => Promise<unknown>;
  };
  readonly memory: {
    readonly inspect: (input: {
      readonly agentHandle: string;
      readonly limit: number;
      readonly pageToken: string;
    }) => Promise<unknown>;
    readonly correct: (input: { readonly agentHandle: string; readonly memoryId: string; readonly correctedContent: string }) => Promise<unknown>;
    readonly forget: (input: { readonly agentHandle: string; readonly memoryIds: readonly string[]; readonly confirmed: true }) => Promise<unknown>;
    readonly setEnabled: (input: { readonly agentHandle: string; readonly enabled: boolean }) => Promise<unknown>;
    readonly deleteAll: (input: { readonly agentHandle: string; readonly confirmed: true }) => Promise<unknown>;
  };
  readonly manager: {
    readonly snapshot: (input: {
      readonly agentHandle: string;
      readonly conversationAnchorId?: string;
    }) => Promise<unknown>;
  };
};

type AgentConfigureRuntimeUnary<Request, Response> = (
  request: Request,
  options?: RuntimeTypedCallOptions,
) => Promise<Response>;

/**
 * Structural Runtime transport used by Desktop and any other Host Control
 * Plane placement. The adapter below only translates generated wire shapes;
 * it creates no first-party product semantics or identity sideband.
 */
export interface NimiLocalAppAgentConfigureRuntime {
  readonly getLocalAppAgentManagerSnapshot: AgentConfigureRuntimeUnary<
    GetLocalAppAgentManagerSnapshotRequest,
    GetLocalAppAgentManagerSnapshotResponse
  >;
  readonly getLocalAppSharedLocalAgentAIConfig: AgentConfigureRuntimeUnary<
    GetLocalAppSharedLocalAgentAIConfigRequest,
    GetLocalAppSharedLocalAgentAIConfigResponse
  >;
  readonly overwriteLocalAppSharedLocalAgentAIConfig: AgentConfigureRuntimeUnary<
    OverwriteLocalAppSharedLocalAgentAIConfigRequest,
    OverwriteLocalAppSharedLocalAgentAIConfigResponse
  >;
  readonly listLocalAppSharedLocalAgentAIConfigOptions: AgentConfigureRuntimeUnary<
    ListLocalAppSharedLocalAgentAIConfigOptionsRequest,
    ListLocalAppSharedLocalAgentAIConfigOptionsResponse
  >;
  readonly getLocalAppAgentAutonomySnapshot: AgentConfigureRuntimeUnary<
    GetLocalAppAgentAutonomySnapshotRequest,
    LocalAppAgentAutonomySnapshotResponse
  >;
  readonly updateLocalAppAgentAutonomy: AgentConfigureRuntimeUnary<
    UpdateLocalAppAgentAutonomyRequest,
    LocalAppAgentUpdateAutonomyResponse
  >;
  readonly getLocalAppAgentPresentationSnapshot: AgentConfigureRuntimeUnary<
    GetLocalAppAgentPresentationSnapshotRequest,
    LocalAppAgentPresentationSnapshotResponse
  >;
  readonly getAgentPresentationAsset: AgentConfigureRuntimeUnary<
    GetAgentPresentationAssetRequest,
    GetAgentPresentationAssetResponse
  >;
  readonly commitLocalAppAgentPresentation: AgentConfigureRuntimeUnary<
    CommitLocalAppAgentPresentationRequest,
    LocalAppAgentCommitPresentationResponse
  >;
  readonly inspectLocalAppAgentMemory: AgentConfigureRuntimeUnary<
    InspectLocalAppAgentMemoryRequest,
    InspectLocalAppAgentMemoryResponse
  >;
  readonly correctLocalAppAgentMemory: AgentConfigureRuntimeUnary<
    CorrectLocalAppAgentMemoryRequest,
    CorrectLocalAppAgentMemoryResponse
  >;
  readonly forgetLocalAppAgentMemory: AgentConfigureRuntimeUnary<
    ForgetLocalAppAgentMemoryRequest,
    ForgetLocalAppAgentMemoryResponse
  >;
  readonly setLocalAppAgentMemoryEnabled: AgentConfigureRuntimeUnary<
    SetLocalAppAgentMemoryEnabledRequest,
    SetLocalAppAgentMemoryEnabledResponse
  >;
  readonly deleteAllLocalAppAgentMemory: AgentConfigureRuntimeUnary<
    DeleteAllLocalAppAgentMemoryRequest,
    DeleteAllLocalAppAgentMemoryResponse
  >;
}

export type NimiLocalAppAgentConfigureClient = {
  readonly sharedAIConfig: {
    readonly get: () => Promise<NimiSharedLocalAgentAIConfigSnapshot>;
    readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
    readonly listOptions: (query: NimiSharedLocalAgentAIConfigOptionsQuery) => Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
  };
  readonly autonomy: {
    readonly snapshot: (
      input: NimiLocalAppAutonomySnapshotInput,
    ) => Promise<NimiLocalAppAgentAutonomyProjection>;
    readonly update: (
      input: NimiLocalAppAutonomyUpdateInput,
    ) => Promise<NimiLocalAppAgentAutonomyProjection>;
  };
  readonly presentation: {
    readonly snapshot: (
      input: NimiLocalAppPresentationSnapshotInput,
    ) => Promise<NimiLocalAppAgentPresentationProjection>;
    readonly readAsset: (
      input: NimiLocalAppPresentationAssetReadInput,
    ) => Promise<NimiLocalAppAgentPresentationAsset>;
    readonly commit: (
      input: NimiLocalAppPresentationCommitInput,
    ) => Promise<NimiLocalAppAgentPresentationProjection>;
  };
  readonly memory: {
    readonly inspect: (input: NimiLocalAppAgentMemoryInspectInput) => Promise<NimiLocalAppAgentMemoryProjection>;
    readonly correct: (input: NimiLocalAppAgentScopedInput & { readonly memoryId: string; readonly correctedContent: string }) => Promise<NimiLocalAppAgentMemoryMutationResult>;
    readonly forget: (input: NimiLocalAppAgentScopedInput & { readonly memoryIds: readonly string[]; readonly confirmed: true }) => Promise<NimiLocalAppAgentMemoryMutationResult>;
    readonly setEnabled: (input: NimiLocalAppAgentScopedInput & { readonly enabled: boolean }) => Promise<NimiLocalAppAgentMemoryMutationResult>;
    readonly deleteAll: (input: NimiLocalAppAgentScopedInput & { readonly confirmed: true }) => Promise<NimiLocalAppAgentMemoryMutationResult>;
  };
  readonly manager: {
    readonly snapshot: (
      input: NimiLocalAppAgentManagerSnapshotInput,
    ) => Promise<NimiLocalAppAgentManagerSnapshot>;
  };
};

const MAX_AGENT_CONFIGURE_TEXT_BYTES = 512;
const MAX_AGENT_MEMORY_PAGE_SIZE = 100;
const MAX_AGENT_MEMORY_PAGE_TOKEN_BYTES = 1024;
const MAX_PRESENTATION_IMPORTED_ASSETS = 2;
const MAX_PRESENTATION_ASSET_CONTENT_BYTES = 64 * 1024 * 1024;
const MAX_RESOURCE_PACK_CONTENT_BYTES = 2 * 1024 * 1024;
const RESOURCE_PACK_MEDIA_TYPE = 'application/vnd.nimi.resource-pack+zip' as const;
const RESOURCE_PACK_TARGET_ID = 'zhiyu-experience-surface' as const;
const RESOURCE_PACK_TARGET_VERSION = 1 as const;
const SHARED_PRESET_VOICE_OPTIONS_LIMIT = 100;
const SHARED_PRESET_VOICE_ID_MAX_SCALARS = 128;
const SHARED_PRESET_VOICE_NAME_MAX_SCALARS = 256;
const SHARED_PRESET_VOICE_LANGS_LIMIT = 32;
const SHARED_PRESET_VOICE_LANG_MAX_SCALARS = 64;
const SHARED_VOICE_ASSET_OPTIONS_LIMIT = 100;
const SHARED_VOICE_ASSET_ID_MAX_SCALARS = 128;

const AUTONOMY_MODES = new Set<NimiLocalAppAgentAutonomyMode>(['off', 'low', 'medium', 'high']);
const PRESENTATION_BACKENDS = new Set<NimiLocalAppAgentPresentationBackendKind>([
  'vrm',
  'live2d',
  'sprite2d',
  'canvas2d',
  'video',
]);
const MANAGER_LIFECYCLE_STATUSES = new Set<NimiLocalAppAgentLifecycleStatus>([
  'initializing', 'active', 'suspended', 'terminating', 'terminated',
]);
const MANAGER_EXECUTION_STATES = new Set<NimiLocalAppAgentExecutionState>([
  'idle', 'chat-active', 'life-pending', 'life-running', 'suspended',
]);
const MANAGER_SOURCE_STATES = new Set<NimiLocalAppAgentManagerSourceState>([
  'not_materialized', 'validating', 'ready', 'invalid', 'deleted',
]);
const MANAGER_CONTEXT_STATES = new Set<NimiLocalAppAgentManagerContextState>([
  'not_composed', 'ready', 'context_capacity_exceeded', 'invalid',
]);
const MANAGER_REASON_CODES = new Set<NimiLocalAppAgentManagerReasonCode>([
  'none', 'source_not_materialized', 'source_validation_pending', 'source_snapshot_invalid',
  'context_not_composed', 'context_capacity_exceeded', 'context_manifest_invalid',
]);
const MANAGER_COVERAGE_SECTIONS = new Set<NimiLocalAppAgentManagerCoverageSection>([
  'identity', 'presentation', 'biography', 'psychology', 'knowledge', 'relationships',
  'capabilities', 'interaction_profile', 'assets', 'authoring', 'world_core', 'bound_entity',
  'dependency_closure',
]);
const MANAGER_COVERAGE_STATES = new Set<NimiLocalAppAgentManagerCoverageState>([
  'complete', 'not_applicable', 'optional_omitted', 'invalid',
]);
const MANAGER_LANE_IDS = new Set<NimiLocalAppAgentManagerLaneId>([
  'runtime_policy', 'output_contract', 'source_identity', 'source_behavior', 'world_context',
  'relationship_context', 'source_knowledge', 'canonical_memory', 'conversation_history',
  'capability_context', 'current_user_turn', 'cognition_source', 'conversation_summary',
  'private_recall',
]);
const MANAGER_LANE_STATES = new Set<NimiLocalAppAgentManagerLaneState>([
  'included', 'empty', 'omitted', 'truncated', 'invalid',
]);
const MANAGER_TRUNCATION_REASONS = new Set<NimiLocalAppAgentManagerTruncationReason>([
  'none', 'input_budget_exhausted', 'optional_content_omitted', 'context_capacity_exceeded',
]);
const MANAGER_SOURCE_COGNITION_STATUSES = new Set<NimiLocalAppAgentManagerSourceCognitionStatus>([
  'unconfigured', 'building', 'ready', 'unavailable', 'failure', 'no_hits', 'no_result',
]);
const MANAGER_CONVERSATION_SUMMARY_STATUSES = new Set<NimiLocalAppAgentManagerConversationSummaryStatus>([
  'absent', 'ready', 'failed', 'omitted', 'unavailable',
]);

/**
 * Agent configuration operations for a protected Local App session. The shared
 * LocalAgent subsystem AIConfig resolves its singular owner inside Runtime and
 * carries no Agent handle; autonomy and presentation stay handle-addressed with
 * their own independent revision CAS. Presentation restore rides the commit
 * carrier's previousProfile projection.
 */
export function createNimiLocalAppAgentConfigureRuntimeShell(
  runtime: NimiLocalAppAgentConfigureRuntime,
): NimiLocalAppAgentConfigureShell {
  return Object.freeze({
    manager: Object.freeze({
      snapshot: async (input: Parameters<NimiLocalAppAgentConfigureShell['manager']['snapshot']>[0]) => projectRuntimeManagerSnapshot(
        requireWireProjection(
          (await runtime.getLocalAppAgentManagerSnapshot(input)).snapshot,
          'Agent Center manager snapshot',
        ),
      ),
    }),
    sharedAIConfig: Object.freeze({
      get: async () => projectRuntimeSharedAIConfig(
        requireWireProjection(
          (await runtime.getLocalAppSharedLocalAgentAIConfig({})).projection,
          'shared LocalAgent AIConfig',
        ),
      ),
      overwrite: async (input: Parameters<NimiLocalAppAgentConfigureShell['sharedAIConfig']['overwrite']>[0]) => {
        const response = await runtime.overwriteLocalAppSharedLocalAgentAIConfig({
          capabilities: [...input.capabilities],
          expectedRevision: input.expectedRevision,
        });
        const projection = projectRuntimeSharedAIConfig(
          requireWireProjection(response.projection, 'shared LocalAgent AIConfig overwrite'),
        );
        const overwriteProjection = {
          config: projection.config,
          revision: projection.revision,
          participation: projection.participation,
        };
        if (response.committed) return { outcome: 'committed', ...overwriteProjection };
        if (response.reasonCode === ReasonCode.AGENT_AI_CONFIG_REVISION_CONFLICT) {
          return { outcome: 'conflict', ...overwriteProjection, reasonCode: 'AGENT_AI_CONFIG_REVISION_CONFLICT' };
        }
        return localAppProjectionError('shared LocalAgent AIConfig overwrite outcome');
      },
      listOptions: async (query: Parameters<NimiLocalAppAgentConfigureShell['sharedAIConfig']['listOptions']>[0]) => projectRuntimeSharedAIConfigOptions(
        await runtime.listLocalAppSharedLocalAgentAIConfigOptions(runtimeSharedOptionsQuery(query)),
      ),
    }),
    autonomy: Object.freeze({
      snapshot: async (input: Parameters<NimiLocalAppAgentConfigureShell['autonomy']['snapshot']>[0]) => projectRuntimeAutonomy(
        requireWireProjection(
          (await runtime.getLocalAppAgentAutonomySnapshot(input)).projection,
          'agent autonomy projection',
        ),
      ),
      update: async (input: Parameters<NimiLocalAppAgentConfigureShell['autonomy']['update']>[0]) => projectRuntimeAutonomy(
        requireWireProjection(
          (await runtime.updateLocalAppAgentAutonomy({
            agentHandle: input.agentHandle,
            expectedAutonomyRevision: input.expectedAutonomyRevision,
            intent: {
              ...(input.intent.enabled === undefined ? {} : { enabled: input.intent.enabled }),
              ...(input.intent.config ? { config: runtimeAutonomyConfig(input.intent.config) } : {}),
            },
          })).projection,
          'agent autonomy update projection',
        ),
      ),
    }),
    presentation: Object.freeze({
      snapshot: async (input: Parameters<NimiLocalAppAgentConfigureShell['presentation']['snapshot']>[0]) => projectRuntimePresentation(
        requireWireProjection(
          (await runtime.getLocalAppAgentPresentationSnapshot(input)).projection,
          'agent presentation projection',
        ),
      ),
      readAsset: async (input: Parameters<NimiLocalAppAgentConfigureShell['presentation']['readAsset']>[0]) => (
        projectRuntimePresentationAsset(await runtime.getAgentPresentationAsset(input))
      ),
      commit: async (input: Parameters<NimiLocalAppAgentConfigureShell['presentation']['commit']>[0]) => projectRuntimePresentation(
        requireWireProjection(
          (await runtime.commitLocalAppAgentPresentation({
            agentHandle: input.agentHandle,
            expectedPresentationRevision: input.expectedPresentationRevision,
            intent: runtimePresentationIntent(input.intent),
            importedAssets: input.importedAssets.map((asset: NimiLocalAppAgentPresentationAssetMaterial) => ({
              role: runtimePresentationAssetRole(asset.role),
              fileName: asset.fileName,
              mediaType: asset.mediaType,
              content: asset.content,
              sha256: asset.sha256,
            })),
          })).projection,
          'agent presentation commit projection',
        ),
      ),
    }),
    memory: Object.freeze({
      inspect: async (input: Parameters<NimiLocalAppAgentConfigureShell['memory']['inspect']>[0]) => projectRuntimeMemory(
        requireWireProjection(
          (await runtime.inspectLocalAppAgentMemory({
            agentHandle: input.agentHandle,
            limit: input.limit,
            pageToken: input.pageToken,
          })).projection,
          'agent Memory projection',
        ),
      ),
      correct: async (input: Parameters<NimiLocalAppAgentConfigureShell['memory']['correct']>[0]) => projectRuntimeMemoryMutation(
        await runtime.correctLocalAppAgentMemory(input),
      ),
      forget: async (input: Parameters<NimiLocalAppAgentConfigureShell['memory']['forget']>[0]) => projectRuntimeMemoryMutation(
        await runtime.forgetLocalAppAgentMemory({ ...input, memoryIds: [...input.memoryIds] }),
      ),
      setEnabled: async (input: Parameters<NimiLocalAppAgentConfigureShell['memory']['setEnabled']>[0]) => projectRuntimeMemoryMutation(
        await runtime.setLocalAppAgentMemoryEnabled(input),
      ),
      deleteAll: async (input: Parameters<NimiLocalAppAgentConfigureShell['memory']['deleteAll']>[0]) => projectRuntimeMemoryMutation(
        await runtime.deleteAllLocalAppAgentMemory(input),
      ),
    }),
  });
}

export function createNimiLocalAppAgentConfigureClient(
  shell: NimiLocalAppAgentConfigureShell,
): NimiLocalAppAgentConfigureClient {
  return Object.freeze({
    sharedAIConfig: Object.freeze({
      get: async (): Promise<NimiSharedLocalAgentAIConfigSnapshot> => projectSharedAIConfigSnapshot(await shell.sharedAIConfig.get()),
      overwrite: async (input: NimiAIConfigOverwriteInput): Promise<NimiSharedLocalAgentAIConfigOverwriteResult> => {
        validateCapabilityIntents(input.capabilities);
        decimalRevision(input.expectedRevision, 'expectedRevision', true);
        return projectSharedAIConfigOverwrite(await shell.sharedAIConfig.overwrite(input));
      },
      listOptions: async (query: NimiSharedLocalAgentAIConfigOptionsQuery): Promise<NimiSharedLocalAgentAIConfigOptionsResult> => {
        assertExactKeys(query, query.kind === 'preset-voices' || query.kind === 'voice-assets'
          ? ['kind']
          : query.kind === 'cloud-targets'
            ? ['kind', 'capabilityContract', 'connectorRef', 'search']
            : ['kind', 'capabilityContract', 'search'], 'shared AIConfig options query');
        if (!['local-loadouts', 'cloud-connectors', 'cloud-targets', 'preset-voices', 'voice-assets'].includes(query.kind)) return localAppProjectionError('shared AIConfig options kind');
        if (query.kind !== 'preset-voices' && query.kind !== 'voice-assets' && (typeof query.capabilityContract !== 'string' || !query.capabilityContract.trim()
          || query.capabilityContract.trim() !== query.capabilityContract
          || (query.kind === 'cloud-targets' && (!query.connectorRef || query.connectorRef.trim() !== query.connectorRef))
          || (query.search !== undefined && (typeof query.search !== 'string' || query.search.trim() !== query.search)))) {
          return localAppProjectionError('shared AIConfig options query');
        }
        return projectSharedAIConfigOptions(await shell.sharedAIConfig.listOptions(query));
      },
    }),
    autonomy: Object.freeze({
      snapshot: async (
        input: NimiLocalAppAutonomySnapshotInput,
      ): Promise<NimiLocalAppAgentAutonomyProjection> => projectAutonomy(
        await shell.autonomy.snapshot(agentScopedPayload(input, 'autonomy snapshot')),
      ),
      update: async (
        input: NimiLocalAppAutonomyUpdateInput,
      ): Promise<NimiLocalAppAgentAutonomyProjection> => {
        assertExactKeys(
          input,
          ['agentHandle', 'expectedAutonomyRevision', 'intent'],
          'local-app autonomy update input',
        );
        assertNoAuthorityMaterial(input);
        const value = await shell.autonomy.update({
          agentHandle: validateAgentHandle(input.agentHandle),
          expectedAutonomyRevision: decimalRevision(
            input.expectedAutonomyRevision,
            'expectedAutonomyRevision',
            false,
          ),
          intent: validateAutonomyIntent(input.intent),
        });
        return projectAutonomy(value);
      },
    }),
    presentation: Object.freeze({
      snapshot: async (
        input: NimiLocalAppPresentationSnapshotInput,
      ): Promise<NimiLocalAppAgentPresentationProjection> => projectPresentation(
        await shell.presentation.snapshot(agentScopedPayload(input, 'presentation snapshot')),
      ),
      readAsset: async (
        input: NimiLocalAppPresentationAssetReadInput,
      ): Promise<NimiLocalAppAgentPresentationAsset> => {
        assertExactKeys(input, ['agentHandle', 'assetRef'], 'local-app presentation asset read input');
        assertNoAuthorityMaterial(input);
        return projectPresentationAsset(await shell.presentation.readAsset({
          agentHandle: validateAgentHandle(input.agentHandle),
          assetRef: configureText(input.assetRef, 'assetRef'),
        }));
      },
      commit: async (
        input: NimiLocalAppPresentationCommitInput,
      ): Promise<NimiLocalAppAgentPresentationProjection> => {
        assertExactKeys(
          input,
          ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'],
          'local-app presentation commit input',
        );
        assertNoAuthorityMaterial(input);
        const importedAssets = validatePresentationAssets(input.importedAssets);
        const value = await shell.presentation.commit({
          agentHandle: validateAgentHandle(input.agentHandle),
          expectedPresentationRevision: decimalRevision(
            input.expectedPresentationRevision,
            'expectedPresentationRevision',
            true,
          ),
          intent: validatePresentationIntent(input.intent, importedAssets),
          importedAssets,
        });
        return projectPresentation(value);
      },
    }),
    memory: Object.freeze({
      inspect: async (input: NimiLocalAppAgentMemoryInspectInput) => {
        assertExactKeys(input, ['agentHandle', 'limit', 'pageToken'], 'local-app Memory inspect input');
        assertNoAuthorityMaterial(input);
        const limit = input.limit ?? MAX_AGENT_MEMORY_PAGE_SIZE;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_AGENT_MEMORY_PAGE_SIZE) {
          return localAppProjectionError('Memory inspect limit');
        }
        return projectMemoryProjection(await shell.memory.inspect({
          agentHandle: validateAgentHandle(input.agentHandle),
          limit,
          pageToken: memoryPageToken(input.pageToken ?? '', 'Memory inspect pageToken'),
        }));
      },
      correct: async (input: NimiLocalAppAgentScopedInput & { readonly memoryId: string; readonly correctedContent: string }) => {
        assertExactKeys(input, ['agentHandle', 'memoryId', 'correctedContent'], 'local-app Memory correction input');
        assertNoAuthorityMaterial(input);
        return projectMemoryMutation(await shell.memory.correct({
          agentHandle: validateAgentHandle(input.agentHandle),
          memoryId: configureText(input.memoryId, 'memoryId'),
          correctedContent: configureText(input.correctedContent, 'correctedContent'),
        }));
      },
      forget: async (input: NimiLocalAppAgentScopedInput & { readonly memoryIds: readonly string[]; readonly confirmed: true }) => {
        assertExactKeys(input, ['agentHandle', 'memoryIds', 'confirmed'], 'local-app Memory forget input');
        assertNoAuthorityMaterial(input);
        if (input.confirmed !== true || !Array.isArray(input.memoryIds) || input.memoryIds.length === 0) return localAppProjectionError('Memory forget targets');
        return projectMemoryMutation(await shell.memory.forget({
          agentHandle: validateAgentHandle(input.agentHandle), memoryIds: input.memoryIds.map((id) => configureText(id, 'memoryId')), confirmed: true,
        }));
      },
      setEnabled: async (input: NimiLocalAppAgentScopedInput & { readonly enabled: boolean }) => {
        assertExactKeys(input, ['agentHandle', 'enabled'], 'local-app Memory switch input');
        assertNoAuthorityMaterial(input);
        if (typeof input.enabled !== 'boolean') return localAppProjectionError('Memory enabled state');
        return projectMemoryMutation(await shell.memory.setEnabled({ agentHandle: validateAgentHandle(input.agentHandle), enabled: input.enabled }));
      },
      deleteAll: async (input: NimiLocalAppAgentScopedInput & { readonly confirmed: true }) => {
        assertExactKeys(input, ['agentHandle', 'confirmed'], 'local-app Memory delete-all input');
        assertNoAuthorityMaterial(input);
        if (input.confirmed !== true) return localAppProjectionError('Memory delete-all confirmation');
        return projectMemoryMutation(await shell.memory.deleteAll({ agentHandle: validateAgentHandle(input.agentHandle), confirmed: true }));
      },
    }),
    manager: Object.freeze({
      snapshot: async (
        input: NimiLocalAppAgentManagerSnapshotInput,
      ): Promise<NimiLocalAppAgentManagerSnapshot> => {
        assertExactKeys(
          input,
          ['agentHandle', 'conversationAnchorId'],
          'local-app Agent Center manager snapshot input',
        );
        assertNoAuthorityMaterial(input);
        const conversationAnchorId = input.conversationAnchorId === undefined
          ? undefined
          : configureText(input.conversationAnchorId, 'conversationAnchorId');
        return projectManagerSnapshot(await shell.manager.snapshot({
          agentHandle: validateAgentHandle(input.agentHandle),
          ...(conversationAnchorId === undefined ? {} : { conversationAnchorId }),
        }));
      },
    }),
  });
}

function agentScopedPayload(
  input: NimiLocalAppAgentScopedInput,
  operation: string,
): { readonly agentHandle: string } {
  assertExactKeys(input, ['agentHandle'], `local-app agent ${operation} input`);
  assertNoAuthorityMaterial(input);
  return { agentHandle: validateAgentHandle(input.agentHandle) };
}

function decimalRevision(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || (!allowZero && value === '0')) {
    return localAppError(
      `Local-app agent configure ${field} is invalid.`,
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_current_snapshot_revision',
    );
  }
  return value;
}

function validateAutonomyIntent(value: unknown): NimiLocalAppAgentAutonomyIntent {
  const intent = asRecord(value);
  if (!intent) return invalidAutonomyIntent('intent must be an object');
  assertExactKeys(intent, ['enabled', 'config'], 'local-app autonomy intent');
  if (intent.enabled === undefined && intent.config === undefined) {
    return invalidAutonomyIntent('at least one mutation field is required');
  }
  if (intent.enabled !== undefined && typeof intent.enabled !== 'boolean') {
    return invalidAutonomyIntent('enabled');
  }
  if (intent.config === undefined) {
    return Object.freeze({ enabled: intent.enabled as boolean | undefined });
  }
  const config = asRecord(intent.config);
  if (!config) return invalidAutonomyIntent('config');
  assertExactKeys(
    config,
    ['dailyTokenBudget', 'maxTokensPerHook', 'minHookInterval', 'suspendUntil', 'mode'],
    'local-app autonomy config',
  );
  const minHookInterval = optionalSecondsNanos(config.minHookInterval, 'minHookInterval');
  const suspendUntil = optionalSecondsNanos(config.suspendUntil, 'suspendUntil');
  return Object.freeze({
    ...(intent.enabled === undefined ? {} : { enabled: intent.enabled as boolean }),
    config: Object.freeze({
      dailyTokenBudget: nonNegativeBudget(config.dailyTokenBudget, 'dailyTokenBudget'),
      maxTokensPerHook: nonNegativeBudget(config.maxTokensPerHook, 'maxTokensPerHook'),
      ...(minHookInterval === undefined ? {} : { minHookInterval }),
      ...(suspendUntil === undefined ? {} : { suspendUntil }),
      mode: autonomyMode(config.mode),
    }),
  });
}

function nonNegativeBudget(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidAutonomyIntent(field);
  }
  return value;
}

function autonomyMode(value: unknown): NimiLocalAppAgentAutonomyMode {
  if (typeof value !== 'string' || !AUTONOMY_MODES.has(value as NimiLocalAppAgentAutonomyMode)) {
    return invalidAutonomyIntent('mode');
  }
  return value as NimiLocalAppAgentAutonomyMode;
}

function optionalSecondsNanos(
  value: unknown,
  field: string,
): NimiLocalAppDuration | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record) return invalidAutonomyIntent(field);
  assertExactKeys(record, ['seconds', 'nanos'], `local-app autonomy ${field}`);
  if (typeof record.seconds !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(record.seconds)) {
    return invalidAutonomyIntent(`${field}.seconds`);
  }
  if (typeof record.nanos !== 'number'
    || !Number.isInteger(record.nanos)
    || record.nanos < 0
    || record.nanos > 999_999_999) {
    return invalidAutonomyIntent(`${field}.nanos`);
  }
  return Object.freeze({ seconds: record.seconds, nanos: record.nanos });
}

function invalidAutonomyIntent(field: string): never {
  return localAppError(
    `Local-app autonomy intent is invalid: ${field}.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_exact_autonomy_intent',
  );
}

function validatePresentationIntent(
  value: unknown,
  importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[],
): NimiLocalAppAgentPresentationIntent {
  const intent = asRecord(value);
  if (!intent) return invalidPresentationInput('intent must be an object');
  if (Object.hasOwn(intent, 'selectImportedResourcePack')) {
    assertExactKeys(intent, ['selectImportedResourcePack'], 'local-app presentation Resource Pack Apply intent');
    if (intent.selectImportedResourcePack !== true
      || importedAssets.length !== 1
      || importedAssets[0]?.role !== 'resource-pack') {
      return invalidPresentationInput('Resource Pack Apply requires exactly one imported Resource Pack');
    }
    return Object.freeze({ selectImportedResourcePack: true });
  }
  if (Object.hasOwn(intent, 'clearResourcePackSelection')) {
    assertExactKeys(intent, ['clearResourcePackSelection'], 'local-app presentation Resource Pack Clear intent');
    if (intent.clearResourcePackSelection !== true || importedAssets.length !== 0) {
      return invalidPresentationInput('Resource Pack Clear cannot import assets');
    }
    return Object.freeze({ clearResourcePackSelection: true });
  }
  assertExactKeys(
    intent,
    [
      'backendKind',
      'avatarAssetRef',
      'expressionProfileRef',
      'idlePreset',
      'interactionPolicyRef',
      'defaultVoiceReference',
      'avatarAutoplay',
      'backgroundAssetRef',
    ],
    'local-app presentation intent',
  );
  if (importedAssets.some((asset) => asset.role === 'resource-pack')) {
    return invalidPresentationInput('Resource Pack material requires the Resource Pack Apply intent');
  }
  if (Object.keys(intent).length === 0 && importedAssets.length === 0) {
    return invalidPresentationInput('at least one patch field is required');
  }
  const backendKind = intent.backendKind;
  if (backendKind !== undefined && (typeof backendKind !== 'string'
    || !PRESENTATION_BACKENDS.has(backendKind as NimiLocalAppAgentPresentationBackendKind))) {
    return invalidPresentationInput('backendKind');
  }
  if (intent.avatarAutoplay !== undefined && typeof intent.avatarAutoplay !== 'boolean') {
    return invalidPresentationInput('avatarAutoplay');
  }
  return Object.freeze({
    ...(backendKind === undefined ? {} : { backendKind: backendKind as NimiLocalAppAgentPresentationBackendKind }),
    ...(intent.avatarAssetRef === undefined ? {} : { avatarAssetRef: configureText(intent.avatarAssetRef, 'avatarAssetRef') }),
    ...(intent.expressionProfileRef === undefined ? {} : { expressionProfileRef: configureText(intent.expressionProfileRef, 'expressionProfileRef') }),
    ...(intent.idlePreset === undefined ? {} : { idlePreset: configureText(intent.idlePreset, 'idlePreset') }),
    ...(intent.interactionPolicyRef === undefined ? {} : { interactionPolicyRef: configureText(intent.interactionPolicyRef, 'interactionPolicyRef') }),
    ...(intent.defaultVoiceReference === undefined ? {} : { defaultVoiceReference: configureText(intent.defaultVoiceReference, 'defaultVoiceReference') }),
    ...(intent.avatarAutoplay === undefined ? {} : { avatarAutoplay: intent.avatarAutoplay }),
    ...(intent.backgroundAssetRef === undefined ? {} : { backgroundAssetRef: configureText(intent.backgroundAssetRef, 'backgroundAssetRef') }),
  });
}

function validatePresentationAssets(
  value: unknown,
): readonly NimiLocalAppAgentPresentationAssetMaterial[] {
  if (!Array.isArray(value) || value.length > MAX_PRESENTATION_IMPORTED_ASSETS) {
    return invalidPresentationInput('importedAssets');
  }
  const seenRoles = new Set<string>();
  return Object.freeze(value.map((entry, index): NimiLocalAppAgentPresentationAssetMaterial => {
    const asset = asRecord(entry);
    if (!asset) return invalidPresentationInput(`importedAssets[${index}]`);
    assertExactKeys(
      asset,
      ['role', 'fileName', 'mediaType', 'content', 'sha256'],
      `local-app presentation asset ${index}`,
    );
    if (asset.role !== 'avatar' && asset.role !== 'background' && asset.role !== 'resource-pack') {
      return invalidPresentationInput(`importedAssets[${index}].role`);
    }
    if (seenRoles.has(asset.role)) return invalidPresentationInput(`importedAssets[${index}].role duplicate`);
    seenRoles.add(asset.role);
    const content = asset.content;
    const contentLimit = asset.role === 'resource-pack'
      ? MAX_RESOURCE_PACK_CONTENT_BYTES
      : MAX_PRESENTATION_ASSET_CONTENT_BYTES;
    if (!(content instanceof Uint8Array)
      || content.byteLength === 0
      || content.byteLength > contentLimit) {
      return invalidPresentationInput(`importedAssets[${index}].content`);
    }
    const mediaType = requiredConfigureText(asset.mediaType, `importedAssets[${index}].mediaType`);
    if (asset.role === 'resource-pack' && mediaType !== RESOURCE_PACK_MEDIA_TYPE) {
      return invalidPresentationInput(`importedAssets[${index}].mediaType`);
    }
    const material = {
      fileName: requiredConfigureText(asset.fileName, `importedAssets[${index}].fileName`),
      content: new Uint8Array(content),
      sha256: requiredConfigureText(asset.sha256, `importedAssets[${index}].sha256`),
    };
    if (asset.role === 'resource-pack') {
      return Object.freeze({ ...material, role: 'resource-pack', mediaType: RESOURCE_PACK_MEDIA_TYPE });
    }
    return Object.freeze({ ...material, role: asset.role, mediaType });
  }));
}

function configureText(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_AGENT_CONFIGURE_TEXT_BYTES) {
    return invalidPresentationInput(field);
  }
  return value;
}

function requiredConfigureText(value: unknown, field: string): string {
  const text = configureText(value, field);
  if (!text) return invalidPresentationInput(field);
  return text;
}

function invalidPresentationInput(field: string): never {
  return localAppError(
    `Local-app presentation input is invalid: ${field}.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_exact_presentation_commit_input',
  );
}

function requireWireProjection<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) localAppProjectionError(field);
  return value;
}

function runtimePlainValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map((entry) => runtimePlainValue(entry)) as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, runtimePlainValue(entry)]),
  ) as T;
}

function runtimeSafeInteger(value: string, field: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) localAppProjectionError(field);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) localAppProjectionError(field);
  return number;
}

function runtimeTimestamp(value: { readonly seconds: string; readonly nanos: number } | undefined): NimiLocalAppTimestamp | null {
  return value ? { seconds: value.seconds, nanos: value.nanos } : null;
}

function runtimeEffectiveState(value: AIConfigEffectiveState): 'ready' | 'missing' | 'blocked' | 'unavailable' {
  switch (value) {
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_READY: return 'ready';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_MISSING: return 'missing';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_BLOCKED: return 'blocked';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE: return 'unavailable';
    default: return localAppProjectionError('shared LocalAgent AIConfig effective state');
  }
}

function runtimeImplementation(value: {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
} | undefined, field: string) {
  const implementation = requireWireProjection(value, field);
  return {
    implementationId: implementation.implementationId,
    driverId: implementation.driverId,
    driverDialect: implementation.driverDialect,
  };
}

function runtimeLocalOption(value: {
  readonly loadoutRef: string;
  readonly label: string;
  readonly capabilityContract: string;
  readonly implementation?: { readonly implementationId: string; readonly driverId: string; readonly driverDialect: string };
  readonly implementationSupportedFeatures: readonly string[];
  readonly configuredFeatures: readonly string[];
  readonly textBehaviors: readonly TextBehaviorCapabilityProjection[];
  readonly state: AIConfigEffectiveState;
  readonly reasons: readonly string[];
}) {
  return {
    loadoutRef: value.loadoutRef,
    label: value.label,
    capabilityContract: value.capabilityContract,
    implementation: runtimeImplementation(value.implementation, 'shared LocalAgent Local option implementation'),
    implementationSupportedFeatures: [...value.implementationSupportedFeatures],
    configuredFeatures: [...value.configuredFeatures],
    textBehaviors: projectNimiTextBehaviorCapabilities(value.textBehaviors),
    state: runtimeEffectiveState(value.state) === 'ready' ? 'ready' : 'blocked',
    reasons: [...value.reasons],
  };
}

function runtimeCloudConnectorOption(value: {
  readonly connectorRef: string;
  readonly label: string;
  readonly provider: string;
  readonly state: AIConfigEffectiveState;
  readonly reasons: readonly string[];
}) {
  return {
    connectorRef: value.connectorRef,
    label: value.label,
    provider: value.provider,
    state: runtimeEffectiveState(value.state) === 'ready' ? 'ready' : 'blocked',
    reasons: [...value.reasons],
  };
}

function runtimeCloudTargetOption(value: {
  readonly connectorRef: string;
  readonly label: string;
  readonly capabilityContract: string;
  readonly implementation?: { readonly implementationId: string; readonly driverId: string; readonly driverDialect: string };
  readonly providerModelTarget?: unknown;
  readonly supportedFeatures: readonly string[];
  readonly state: AIConfigEffectiveState;
  readonly reasons: readonly string[];
}) {
  return {
    connectorRef: value.connectorRef,
    label: value.label,
    capabilityContract: value.capabilityContract,
    implementation: runtimeImplementation(value.implementation, 'shared LocalAgent Cloud target implementation'),
    providerModelTarget: runtimePlainValue(requireWireProjection(value.providerModelTarget, 'shared LocalAgent Cloud target')),
    supportedFeatures: [...value.supportedFeatures],
    state: runtimeEffectiveState(value.state) === 'ready' ? 'ready' : 'blocked',
    reasons: [...value.reasons],
  };
}

function runtimeParticipationRole(value: LocalAgentCapabilityParticipationRole): NimiSharedLocalAgentCapabilityParticipation['role'] {
  switch (value) {
    case LocalAgentCapabilityParticipationRole.CONVERSATION_PRIMARY: return 'conversation.primary';
    case LocalAgentCapabilityParticipationRole.MEMORY_EMBEDDING: return 'memory.embedding';
    case LocalAgentCapabilityParticipationRole.CONVERSATION_INPUT_VOICE: return 'conversation.input.voice';
    case LocalAgentCapabilityParticipationRole.CONVERSATION_OUTPUT_VOICE: return 'conversation.output.voice';
    case LocalAgentCapabilityParticipationRole.CONVERSATION_REALTIME: return 'conversation.realtime';
    case LocalAgentCapabilityParticipationRole.CONVERSATION_ACTION_IMAGE: return 'conversation.action.image';
    default: return localAppProjectionError('shared LocalAgent participation role');
  }
}

function projectRuntimeSharedAIConfig(
  projection: LocalAppSharedLocalAgentAIConfigProjection,
) {
  return {
    config: projection.config ? runtimePlainValue(projection.config) : null,
    revision: projection.revision,
    effectiveSelections: projection.effectiveSelections.map((selection) => ({
      capabilityContract: selection.capabilityContract,
      state: runtimeEffectiveState(selection.state),
      resource: selection.resource.oneofKind === 'local'
        ? { oneofKind: 'local' as const, local: runtimeLocalOption(selection.resource.local) }
        : selection.resource.oneofKind === 'cloud'
          ? {
              oneofKind: 'cloud' as const,
              cloud: {
                connector: runtimeCloudConnectorOption(requireWireProjection(
                  selection.resource.cloud.connector,
                  'shared LocalAgent effective Cloud connector',
                )),
                target: runtimeCloudTargetOption(requireWireProjection(
                  selection.resource.cloud.target,
                  'shared LocalAgent effective Cloud target',
                )),
              },
            }
          : null,
      reasons: [...selection.reasons],
    })),
    participation: projection.participation.map((row) => ({
      role: runtimeParticipationRole(row.role),
      capabilityContract: row.capabilityContract,
    })),
  };
}

function runtimeSharedOptionsQuery(
  query: NimiSharedLocalAgentAIConfigOptionsQuery,
): ListLocalAppSharedLocalAgentAIConfigOptionsRequest {
  switch (query.kind) {
    case 'local-loadouts':
      return { query: { oneofKind: 'localLoadouts', localLoadouts: {
        capabilityContract: query.capabilityContract,
        search: query.search ?? '',
      } } };
    case 'cloud-connectors':
      return { query: { oneofKind: 'cloudConnectors', cloudConnectors: {
        capabilityContract: query.capabilityContract,
        search: query.search ?? '',
      } } };
    case 'cloud-targets':
      return { query: { oneofKind: 'cloudTargets', cloudTargets: {
        capabilityContract: query.capabilityContract,
        connectorRef: query.connectorRef,
        search: query.search ?? '',
      } } };
    case 'preset-voices':
      return { query: { oneofKind: 'presetVoices', presetVoices: {} } };
    case 'voice-assets':
      return { query: { oneofKind: 'voiceAssets', voiceAssets: {} } };
  }
}

function projectRuntimeSharedAIConfigOptions(
  response: ListLocalAppSharedLocalAgentAIConfigOptionsResponse,
) {
  switch (response.result.oneofKind) {
    case 'localLoadouts': return {
      kind: 'local-loadouts' as const,
      options: response.result.localLoadouts.options.map(runtimeLocalOption),
      truncated: response.truncated,
    };
    case 'cloudConnectors': return {
      kind: 'cloud-connectors' as const,
      options: response.result.cloudConnectors.options.map(runtimeCloudConnectorOption),
      truncated: response.truncated,
    };
    case 'cloudTargets': return {
      kind: 'cloud-targets' as const,
      options: response.result.cloudTargets.options.map(runtimeCloudTargetOption),
      truncated: response.truncated,
    };
    case 'presetVoices': return {
      kind: 'preset-voices' as const,
      options: response.result.presetVoices.options.map((voice) => ({
        voiceId: voice.voiceId,
        name: voice.name,
        supportedLangs: [...voice.supportedLangs],
      })),
      truncated: response.truncated,
    };
    case 'voiceAssets': return {
      kind: 'voice-assets' as const,
      options: response.result.voiceAssets.options.map((asset) => ({
        voiceAssetId: asset.voiceAssetId,
      })),
      truncated: response.truncated,
    };
    default: return localAppProjectionError('shared LocalAgent AIConfig options result');
  }
}

function runtimeAutonomyMode(value: NimiLocalAppAgentAutonomyMode): LocalAppAgentAutonomyMode {
  switch (value) {
    case 'off': return LocalAppAgentAutonomyMode.OFF;
    case 'low': return LocalAppAgentAutonomyMode.LOW;
    case 'medium': return LocalAppAgentAutonomyMode.MEDIUM;
    case 'high': return LocalAppAgentAutonomyMode.HIGH;
  }
}

function projectRuntimeAutonomyMode(value: LocalAppAgentAutonomyMode): NimiLocalAppAgentAutonomyMode {
  switch (value) {
    case LocalAppAgentAutonomyMode.OFF: return 'off';
    case LocalAppAgentAutonomyMode.LOW: return 'low';
    case LocalAppAgentAutonomyMode.MEDIUM: return 'medium';
    case LocalAppAgentAutonomyMode.HIGH: return 'high';
    default: return localAppProjectionError('agent autonomy mode');
  }
}

function runtimeAutonomyConfig(config: NimiLocalAppAgentAutonomyConfig) {
  return {
    dailyTokenBudget: String(config.dailyTokenBudget),
    maxTokensPerHook: String(config.maxTokensPerHook),
    ...(config.minHookInterval ? { minHookInterval: config.minHookInterval } : {}),
    ...(config.suspendUntil ? { suspendUntil: config.suspendUntil } : {}),
    mode: runtimeAutonomyMode(config.mode),
  };
}

function projectRuntimeAutonomy(projection: RuntimeLocalAppAgentAutonomyProjection) {
  return {
    enabled: projection.enabled,
    config: projection.config ? {
      dailyTokenBudget: runtimeSafeInteger(projection.config.dailyTokenBudget, 'agent autonomy dailyTokenBudget'),
      maxTokensPerHook: runtimeSafeInteger(projection.config.maxTokensPerHook, 'agent autonomy maxTokensPerHook'),
      minHookInterval: runtimeTimestamp(projection.config.minHookInterval),
      suspendUntil: runtimeTimestamp(projection.config.suspendUntil),
      mode: projectRuntimeAutonomyMode(projection.config.mode),
    } : null,
    usedTokensInWindow: runtimeSafeInteger(projection.usedTokensInWindow, 'agent autonomy usedTokensInWindow'),
    windowStartedAt: runtimeTimestamp(projection.windowStartedAt),
    budgetExhausted: projection.budgetExhausted,
    suspendedUntil: runtimeTimestamp(projection.suspendedUntil),
    autonomyRevision: projection.autonomyRevision,
  };
}

function runtimePresentationBackend(value: NimiLocalAppAgentPresentationBackendKind): AgentPresentationBackendKind {
  switch (value) {
    case 'vrm': return AgentPresentationBackendKind.VRM;
    case 'live2d': return AgentPresentationBackendKind.LIVE2D;
    case 'sprite2d': return AgentPresentationBackendKind.SPRITE2D;
    case 'canvas2d': return AgentPresentationBackendKind.CANVAS2D;
    case 'video': return AgentPresentationBackendKind.VIDEO;
  }
}

function projectRuntimePresentationBackend(value: AgentPresentationBackendKind): NimiLocalAppAgentPresentationBackendKind | null {
  switch (value) {
    case AgentPresentationBackendKind.UNSPECIFIED: return null;
    case AgentPresentationBackendKind.VRM: return 'vrm';
    case AgentPresentationBackendKind.LIVE2D: return 'live2d';
    case AgentPresentationBackendKind.SPRITE2D: return 'sprite2d';
    case AgentPresentationBackendKind.CANVAS2D: return 'canvas2d';
    case AgentPresentationBackendKind.VIDEO: return 'video';
    default: return localAppProjectionError('agent presentation backend');
  }
}

function runtimePresentationAssetRole(
  role: NimiLocalAppAgentPresentationAssetMaterial['role'],
): AgentPresentationAssetRole {
  switch (role) {
    case 'avatar': return AgentPresentationAssetRole.AVATAR;
    case 'background': return AgentPresentationAssetRole.BACKGROUND;
    case 'resource-pack': return AgentPresentationAssetRole.RESOURCE_PACK;
  }
}

function runtimePresentationIntent(intent: NimiLocalAppAgentPresentationIntent) {
  if ('selectImportedResourcePack' in intent) {
    return { selectImportedResourcePack: true, clearResourcePackSelection: false };
  }
  if ('clearResourcePackSelection' in intent) {
    return { selectImportedResourcePack: false, clearResourcePackSelection: true };
  }
  return {
    patch: runtimePresentationPatch(intent),
    selectImportedResourcePack: false,
    clearResourcePackSelection: false,
  };
}

function runtimePresentationPatch(intent: NimiLocalAppAgentPresentationAppearanceIntent) {
  return {
    ...(intent.backendKind === undefined ? {} : { backendKind: runtimePresentationBackend(intent.backendKind) }),
    ...(intent.avatarAssetRef === undefined ? {} : { avatarAssetRef: intent.avatarAssetRef }),
    ...(intent.expressionProfileRef === undefined ? {} : { expressionProfileRef: intent.expressionProfileRef }),
    ...(intent.idlePreset === undefined ? {} : { idlePreset: intent.idlePreset }),
    ...(intent.interactionPolicyRef === undefined ? {} : { interactionPolicyRef: intent.interactionPolicyRef }),
    ...(intent.defaultVoiceReference === undefined ? {} : { defaultVoiceReference: intent.defaultVoiceReference }),
    ...(intent.avatarAutoplay === undefined ? {} : { avatarAutoplay: intent.avatarAutoplay }),
    ...(intent.backgroundAssetRef === undefined ? {} : { backgroundAssetRef: intent.backgroundAssetRef }),
  };
}

function projectRuntimePresentationProfile(
  profile: RuntimeLocalAppAgentPresentationProjection['profile'],
) {
  if (!profile) return null;
  return {
    backendKind: projectRuntimePresentationBackend(profile.backendKind),
    avatarAssetRef: profile.avatarAssetRef,
    expressionProfileRef: profile.expressionProfileRef,
    idlePreset: profile.idlePreset,
    interactionPolicyRef: profile.interactionPolicyRef,
    defaultVoiceReference: profile.defaultVoiceReference,
    avatarAutoplay: profile.avatarAutoplay,
    backgroundAssetRef: profile.backgroundAssetRef,
    revision: profile.revision,
  };
}

function projectRuntimePresentation(projection: RuntimeLocalAppAgentPresentationProjection) {
  return {
    profile: projectRuntimePresentationProfile(projection.profile),
    previousProfile: projectRuntimePresentationProfile(projection.previousProfile),
    defaultVoiceReference: projection.defaultVoiceReference,
    avatarAutoplay: projection.avatarAutoplay,
    presentationRevision: projection.presentationRevision,
    resourcePackSelection: projection.resourcePackSelection ? {
      assetRef: projection.resourcePackSelection.assetRef,
      targetId: projection.resourcePackSelection.targetId,
      targetVersion: projection.resourcePackSelection.targetVersion,
    } : null,
  };
}

function projectRuntimeMemoryOutcome(value: CognitionMemoryOutcome): NimiLocalAppAgentMemoryProjection['outcome'] {
  switch (value) {
    case CognitionMemoryOutcome.INVALID: return 'invalid';
    case CognitionMemoryOutcome.UNCONFIGURED: return 'unconfigured';
    case CognitionMemoryOutcome.PENDING:
    case CognitionMemoryOutcome.RECEIVED:
    case CognitionMemoryOutcome.PROCESSING: return 'pending';
    case CognitionMemoryOutcome.BUILDING: return 'building';
    case CognitionMemoryOutcome.READY: return 'ready';
    case CognitionMemoryOutcome.NO_HITS: return 'no_hits';
    case CognitionMemoryOutcome.UNAVAILABLE: return 'unavailable';
    case CognitionMemoryOutcome.FAILED: return 'failed';
    case CognitionMemoryOutcome.NO_EFFECT:
    case CognitionMemoryOutcome.ALREADY_ABSENT:
    case CognitionMemoryOutcome.DUPLICATE: return 'no_effect';
    case CognitionMemoryOutcome.REJECTED: return 'rejected';
    case CognitionMemoryOutcome.ADMITTED: return 'admitted';
    case CognitionMemoryOutcome.FORGOTTEN: return 'forgotten';
    case CognitionMemoryOutcome.DELETED: return 'deleted';
    case CognitionMemoryOutcome.COMMITTED: return 'committed';
    case CognitionMemoryOutcome.CONFLICT: return 'conflict';
    default: return localAppProjectionError('agent Memory outcome');
  }
}

function projectRuntimeMemoryEpistemic(value: CognitionMemoryEpistemicStatus): NimiLocalAppAgentMemoryItem['epistemicStatus'] {
  switch (value) {
    case CognitionMemoryEpistemicStatus.EXPLICIT: return 'explicit';
    case CognitionMemoryEpistemicStatus.INFERRED: return 'inferred';
    case CognitionMemoryEpistemicStatus.CONSOLIDATED: return 'consolidated';
    default: return localAppProjectionError('agent Memory epistemic status');
  }
}

function projectRuntimeMemoryLifecycle(value: CognitionMemoryLifecycle): NimiLocalAppAgentMemoryItem['lifecycle'] {
  switch (value) {
    case CognitionMemoryLifecycle.CURRENT: return 'current';
    case CognitionMemoryLifecycle.SUPERSEDED: return 'superseded';
    case CognitionMemoryLifecycle.CONFLICTED: return 'conflicted';
    default: return localAppProjectionError('agent Memory lifecycle');
  }
}

function projectRuntimeMemory(
  projection: NonNullable<InspectLocalAppAgentMemoryResponse['projection']>,
) {
  return {
    outcome: projectRuntimeMemoryOutcome(projection.outcome),
    enabled: projection.enabled,
    adoptionRequired: projection.adoptionRequired,
    items: projection.items.map((item) => ({
      memoryId: item.memoryId,
      content: item.content,
      epistemicStatus: projectRuntimeMemoryEpistemic(item.epistemicStatus),
      lifecycle: projectRuntimeMemoryLifecycle(item.lifecycle),
      occurredAt: runtimeTimestamp(item.occurredAt),
      updatedAt: runtimeTimestamp(item.updatedAt),
      sourceExplanation: item.sourceExplanation,
    })),
    currentCount: runtimeSafeInteger(projection.currentCount, 'agent Memory currentCount'),
    supersededCount: runtimeSafeInteger(projection.supersededCount, 'agent Memory supersededCount'),
    forgottenCount: runtimeSafeInteger(projection.forgottenCount, 'agent Memory forgottenCount'),
    nextPageToken: projection.nextPageToken
      ? memoryPageToken(projection.nextPageToken, 'agent Memory nextPageToken')
      : null,
  };
}

function projectRuntimeMemoryMutation(response: {
  readonly outcome: CognitionMemoryOutcome;
  readonly affectedMemoryIds?: readonly string[];
  readonly projection?: InspectLocalAppAgentMemoryResponse['projection'];
}) {
  return {
    outcome: projectRuntimeMemoryOutcome(response.outcome),
    affectedMemoryIds: [...(response.affectedMemoryIds ?? [])],
    projection: projectRuntimeMemory(requireWireProjection(response.projection, 'agent Memory mutation projection')),
  };
}

function projectRuntimeManagerLifecycle(value: AgentLifecycleStatus): NimiLocalAppAgentLifecycleStatus {
  switch (value) {
    case AgentLifecycleStatus.INITIALIZING: return 'initializing';
    case AgentLifecycleStatus.ACTIVE: return 'active';
    case AgentLifecycleStatus.SUSPENDED: return 'suspended';
    case AgentLifecycleStatus.TERMINATING: return 'terminating';
    case AgentLifecycleStatus.TERMINATED: return 'terminated';
    default: return localAppProjectionError('Agent Center manager lifecycle');
  }
}

function projectRuntimeManagerExecution(value: AgentExecutionState): NimiLocalAppAgentExecutionState {
  switch (value) {
    case AgentExecutionState.IDLE: return 'idle';
    case AgentExecutionState.CHAT_ACTIVE: return 'chat-active';
    case AgentExecutionState.LIFE_PENDING: return 'life-pending';
    case AgentExecutionState.LIFE_RUNNING: return 'life-running';
    case AgentExecutionState.SUSPENDED: return 'suspended';
    default: return localAppProjectionError('Agent Center manager execution');
  }
}

function projectRuntimeManagerReason(value: AgentContextProjectionReasonCode): NimiLocalAppAgentManagerReasonCode {
  switch (value) {
    case AgentContextProjectionReasonCode.NONE: return 'none';
    case AgentContextProjectionReasonCode.SOURCE_NOT_MATERIALIZED: return 'source_not_materialized';
    case AgentContextProjectionReasonCode.SOURCE_VALIDATION_PENDING: return 'source_validation_pending';
    case AgentContextProjectionReasonCode.SOURCE_SNAPSHOT_INVALID: return 'source_snapshot_invalid';
    case AgentContextProjectionReasonCode.CONTEXT_NOT_COMPOSED: return 'context_not_composed';
    case AgentContextProjectionReasonCode.CONTEXT_CAPACITY_EXCEEDED: return 'context_capacity_exceeded';
    case AgentContextProjectionReasonCode.CONTEXT_MANIFEST_INVALID: return 'context_manifest_invalid';
    default: return localAppProjectionError('Agent Center manager reason');
  }
}

function projectRuntimeManagerSourceState(value: AgentLocalSourceContextState): NimiLocalAppAgentManagerSourceState {
  switch (value) {
    case AgentLocalSourceContextState.NOT_MATERIALIZED: return 'not_materialized';
    case AgentLocalSourceContextState.VALIDATING: return 'validating';
    case AgentLocalSourceContextState.READY: return 'ready';
    case AgentLocalSourceContextState.INVALID: return 'invalid';
    case AgentLocalSourceContextState.DELETED: return 'deleted';
    default: return localAppProjectionError('Agent Center manager source state');
  }
}

function projectRuntimeManagerCoverageSection(value: AgentLocalSourceCoverageSection): NimiLocalAppAgentManagerCoverageSection {
  switch (value) {
    case AgentLocalSourceCoverageSection.IDENTITY: return 'identity';
    case AgentLocalSourceCoverageSection.PRESENTATION: return 'presentation';
    case AgentLocalSourceCoverageSection.BIOGRAPHY: return 'biography';
    case AgentLocalSourceCoverageSection.PSYCHOLOGY: return 'psychology';
    case AgentLocalSourceCoverageSection.KNOWLEDGE: return 'knowledge';
    case AgentLocalSourceCoverageSection.RELATIONSHIPS: return 'relationships';
    case AgentLocalSourceCoverageSection.CAPABILITIES: return 'capabilities';
    case AgentLocalSourceCoverageSection.INTERACTION_PROFILE: return 'interaction_profile';
    case AgentLocalSourceCoverageSection.ASSETS: return 'assets';
    case AgentLocalSourceCoverageSection.AUTHORING: return 'authoring';
    case AgentLocalSourceCoverageSection.WORLD_CORE: return 'world_core';
    case AgentLocalSourceCoverageSection.BOUND_ENTITY: return 'bound_entity';
    case AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE: return 'dependency_closure';
    default: return localAppProjectionError('Agent Center manager coverage section');
  }
}

function projectRuntimeManagerCoverageState(value: AgentLocalSourceCoverageState): NimiLocalAppAgentManagerCoverageState {
  switch (value) {
    case AgentLocalSourceCoverageState.COMPLETE: return 'complete';
    case AgentLocalSourceCoverageState.NOT_APPLICABLE: return 'not_applicable';
    case AgentLocalSourceCoverageState.OPTIONAL_OMITTED: return 'optional_omitted';
    case AgentLocalSourceCoverageState.INVALID: return 'invalid';
    default: return localAppProjectionError('Agent Center manager coverage state');
  }
}

function projectRuntimeManagerContextState(value: AgentTurnContextState): NimiLocalAppAgentManagerContextState {
  switch (value) {
    case AgentTurnContextState.NOT_COMPOSED: return 'not_composed';
    case AgentTurnContextState.READY: return 'ready';
    case AgentTurnContextState.CONTEXT_CAPACITY_EXCEEDED: return 'context_capacity_exceeded';
    case AgentTurnContextState.INVALID: return 'invalid';
    default: return localAppProjectionError('Agent Center manager context state');
  }
}

function projectRuntimeManagerLaneId(value: AgentTurnContextLaneId): NimiLocalAppAgentManagerLaneId {
  const names: Partial<Record<AgentTurnContextLaneId, NimiLocalAppAgentManagerLaneId>> = {
    [AgentTurnContextLaneId.RUNTIME_POLICY]: 'runtime_policy',
    [AgentTurnContextLaneId.OUTPUT_CONTRACT]: 'output_contract',
    [AgentTurnContextLaneId.SOURCE_IDENTITY]: 'source_identity',
    [AgentTurnContextLaneId.SOURCE_BEHAVIOR]: 'source_behavior',
    [AgentTurnContextLaneId.WORLD_CONTEXT]: 'world_context',
    [AgentTurnContextLaneId.RELATIONSHIP_CONTEXT]: 'relationship_context',
    [AgentTurnContextLaneId.SOURCE_KNOWLEDGE]: 'source_knowledge',
    [AgentTurnContextLaneId.CANONICAL_MEMORY]: 'canonical_memory',
    [AgentTurnContextLaneId.CONVERSATION_HISTORY]: 'conversation_history',
    [AgentTurnContextLaneId.CAPABILITY_CONTEXT]: 'capability_context',
    [AgentTurnContextLaneId.CURRENT_USER_TURN]: 'current_user_turn',
    [AgentTurnContextLaneId.COGNITION_SOURCE]: 'cognition_source',
    [AgentTurnContextLaneId.CONVERSATION_SUMMARY]: 'conversation_summary',
    [AgentTurnContextLaneId.PRIVATE_RECALL]: 'private_recall',
  };
  return names[value] ?? localAppProjectionError('Agent Center manager lane id');
}

function projectRuntimeManagerLaneState(value: AgentTurnContextLaneState): NimiLocalAppAgentManagerLaneState {
  switch (value) {
    case AgentTurnContextLaneState.INCLUDED: return 'included';
    case AgentTurnContextLaneState.EMPTY: return 'empty';
    case AgentTurnContextLaneState.OMITTED: return 'omitted';
    case AgentTurnContextLaneState.TRUNCATED: return 'truncated';
    case AgentTurnContextLaneState.INVALID: return 'invalid';
    default: return localAppProjectionError('Agent Center manager lane state');
  }
}

function projectRuntimeManagerTruncation(value: AgentTurnContextTruncationReason): NimiLocalAppAgentManagerTruncationReason {
  switch (value) {
    case AgentTurnContextTruncationReason.NONE: return 'none';
    case AgentTurnContextTruncationReason.INPUT_BUDGET_EXHAUSTED: return 'input_budget_exhausted';
    case AgentTurnContextTruncationReason.OPTIONAL_CONTENT_OMITTED: return 'optional_content_omitted';
    case AgentTurnContextTruncationReason.CONTEXT_CAPACITY_EXCEEDED: return 'context_capacity_exceeded';
    default: return localAppProjectionError('Agent Center manager truncation reason');
  }
}

function projectRuntimeManagerCognitionStatus(value: AgentSourceCognitionStatus): NimiLocalAppAgentManagerSourceCognitionStatus {
  switch (value) {
    case AgentSourceCognitionStatus.UNCONFIGURED: return 'unconfigured';
    case AgentSourceCognitionStatus.BUILDING: return 'building';
    case AgentSourceCognitionStatus.READY: return 'ready';
    case AgentSourceCognitionStatus.UNAVAILABLE: return 'unavailable';
    case AgentSourceCognitionStatus.FAILURE: return 'failure';
    case AgentSourceCognitionStatus.NO_HITS: return 'no_hits';
    case AgentSourceCognitionStatus.NO_RESULT: return 'no_result';
    default: return localAppProjectionError('Agent Center manager source cognition status');
  }
}

function projectRuntimeManagerConversationStatus(value: AgentConversationSummaryStatus): NimiLocalAppAgentManagerConversationSummaryStatus {
  switch (value) {
    case AgentConversationSummaryStatus.ABSENT: return 'absent';
    case AgentConversationSummaryStatus.READY: return 'ready';
    case AgentConversationSummaryStatus.FAILED: return 'failed';
    case AgentConversationSummaryStatus.OMITTED: return 'omitted';
    case AgentConversationSummaryStatus.UNAVAILABLE: return 'unavailable';
    default: return localAppProjectionError('Agent Center manager conversation summary status');
  }
}

function projectRuntimeManagerProductAction(
  value: LocalAppAgentManagerProductAction,
): NimiLocalAppAgentManagerProductAction {
  switch (value) {
    case LocalAppAgentManagerProductAction.SHARED_AI_CONFIG_READ: return 'getSharedAIConfig';
    case LocalAppAgentManagerProductAction.SHARED_AI_CONFIG_WRITE: return 'overwriteSharedAIConfig';
    case LocalAppAgentManagerProductAction.AUTONOMY_READ: return 'readAutonomy';
    case LocalAppAgentManagerProductAction.AUTONOMY_WRITE: return 'updateAutonomy';
    case LocalAppAgentManagerProductAction.MEMORY_INSPECT: return 'inspectMemory';
    case LocalAppAgentManagerProductAction.MEMORY_CORRECT: return 'correctMemory';
    case LocalAppAgentManagerProductAction.MEMORY_FORGET: return 'forgetMemory';
    case LocalAppAgentManagerProductAction.MEMORY_SWITCH: return 'switchMemory';
    case LocalAppAgentManagerProductAction.MEMORY_DELETE: return 'deleteAllMemory';
    case LocalAppAgentManagerProductAction.APPEARANCE_COMMIT: return 'replaceAppearance';
    case LocalAppAgentManagerProductAction.APPEARANCE_RESTORE: return 'restorePreviousAppearance';
    default: return localAppProjectionError('Agent Center manager product action');
  }
}

function projectRuntimeManagerActionUnavailableReason(
  value: LocalAppAgentManagerActionUnavailableReason,
): NimiLocalAppAgentManagerActionUnavailableReason {
  switch (value) {
    case LocalAppAgentManagerActionUnavailableReason.OPERATION_UNAVAILABLE: return 'operation-unavailable';
    case LocalAppAgentManagerActionUnavailableReason.OWNER_UNAVAILABLE: return 'owner-unavailable';
    case LocalAppAgentManagerActionUnavailableReason.MEMORY_DISABLED: return 'memory-disabled';
    case LocalAppAgentManagerActionUnavailableReason.MEMORY_ADOPTION_REQUIRED: return 'memory-adoption-required';
    case LocalAppAgentManagerActionUnavailableReason.PREVIOUS_PRESENTATION_UNAVAILABLE: return 'previous-presentation-unavailable';
    default: return localAppProjectionError('Agent Center manager action unavailable reason');
  }
}

function projectRuntimeManagerActionAvailability(
  values: NonNullable<GetLocalAppAgentManagerSnapshotResponse['snapshot']>['actionAvailability'],
): NimiLocalAppAgentManagerActionAvailabilityProjection {
  if (!Array.isArray(values) || values.length !== NIMI_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTIONS.length) {
    return localAppProjectionError('Agent Center manager action availability count');
  }
  const projected = new Map<NimiLocalAppAgentManagerProductAction, NimiLocalAppAgentManagerActionAvailability>();
  for (const value of values) {
    const action = projectRuntimeManagerProductAction(value.action);
    if (projected.has(action)) {
      return localAppProjectionError('Agent Center manager duplicate action availability');
    }
    switch (value.state) {
      case LocalAppAgentManagerActionAvailabilityState.AVAILABLE:
        if (value.reason !== LocalAppAgentManagerActionUnavailableReason.NONE) {
          return localAppProjectionError('Agent Center manager available action reason');
        }
        projected.set(action, Object.freeze({ state: 'available', reason: null }));
        break;
      case LocalAppAgentManagerActionAvailabilityState.UNAVAILABLE:
        projected.set(action, Object.freeze({
          state: 'unavailable',
          reason: projectRuntimeManagerActionUnavailableReason(value.reason),
        }));
        break;
      default:
        return localAppProjectionError('Agent Center manager action availability state');
    }
  }
  if (projected.size !== NIMI_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTIONS.length) {
    return localAppProjectionError('Agent Center manager incomplete action availability');
  }
  return Object.freeze(Object.fromEntries(projected)) as NimiLocalAppAgentManagerActionAvailabilityProjection;
}

function projectRuntimeManagerSnapshot(
  snapshot: NonNullable<GetLocalAppAgentManagerSnapshotResponse['snapshot']>,
) {
  return {
    lifecycleStatus: projectRuntimeManagerLifecycle(snapshot.lifecycleStatus),
    executionState: projectRuntimeManagerExecution(snapshot.executionState),
    statusText: snapshot.statusText,
    currentEmotion: snapshot.currentEmotion,
    source: snapshot.source ? {
      ready: snapshot.source.ready,
      state: projectRuntimeManagerSourceState(snapshot.source.state),
      reasonCode: projectRuntimeManagerReason(snapshot.source.reasonCode),
      capturedAt: runtimeTimestamp(snapshot.source.capturedAt),
      coverageSections: snapshot.source.coverageSections.map((row) => ({
        section: projectRuntimeManagerCoverageSection(row.section),
        state: projectRuntimeManagerCoverageState(row.state),
        requiredCount: row.requiredCount,
        resolvedCount: row.resolvedCount,
        omittedCount: row.omittedCount,
      })),
      lorebookReady: snapshot.source.lorebookReady,
      lorebookItemCount: snapshot.source.lorebookItemCount,
      lorebookEstimatedTokens: snapshot.source.lorebookEstimatedTokens,
    } : null,
    context: snapshot.context ? {
      ready: snapshot.context.ready,
      state: projectRuntimeManagerContextState(snapshot.context.state),
      reasonCode: projectRuntimeManagerReason(snapshot.context.reasonCode),
      lanes: snapshot.context.lanes.map((lane) => ({
        laneId: projectRuntimeManagerLaneId(lane.laneId),
        state: projectRuntimeManagerLaneState(lane.state),
        includedItemCount: lane.includedItemCount,
        omittedItemCount: lane.omittedItemCount,
        truncatedItemCount: lane.truncatedItemCount,
        allocatedTokens: lane.allocatedTokens,
        usedTokens: lane.usedTokens,
      })),
      inputBudgetTokens: snapshot.context.inputBudgetTokens,
      usedTokens: snapshot.context.usedTokens,
      requiredInputTokens: snapshot.context.requiredInputTokens,
      requiredContextWindowTokens: snapshot.context.requiredContextWindowTokens,
      truncation: snapshot.context.truncation.map((row) => ({
        reason: projectRuntimeManagerTruncation(row.reason),
        omittedItemCount: row.omittedItemCount,
        truncatedItemCount: row.truncatedItemCount,
      })),
      transcriptTurnCount: snapshot.context.transcriptTurnCount,
      memoryItemCount: snapshot.context.memoryItemCount,
      mediaCount: snapshot.context.mediaCount,
      toolCount: snapshot.context.toolCount,
      sourceAdapterStatus: projectRuntimeManagerCognitionStatus(snapshot.context.sourceAdapterStatus),
      sourceSelectionStatus: projectRuntimeManagerCognitionStatus(snapshot.context.sourceSelectionStatus),
      conversationSummaryStatus: projectRuntimeManagerConversationStatus(snapshot.context.conversationSummaryStatus),
      privateRecallCount: snapshot.context.privateRecallCount,
    } : null,
    actionAvailability: projectRuntimeManagerActionAvailability(snapshot.actionAvailability),
  };
}

function projectSharedAIConfig(value: unknown): NimiCapabilityAIConfig {
  const config = asRecord(value);
  assertExactProjectionKeys(config, ['owner', 'capabilities'], 'shared LocalAgent AIConfig');
  assertSafeProjection(config);
  const owner = asRecord(config.owner);
  assertExactProjectionKeys(owner, ['owner'], 'shared LocalAgent AIConfig owner');
  const ownerVariant = asRecord(owner.owner);
  assertExactProjectionKeys(
    ownerVariant,
    ['oneofKind', 'runtimeLocalAgentSubsystem'],
    'shared LocalAgent AIConfig owner variant',
  );
  if (ownerVariant.oneofKind !== 'runtimeLocalAgentSubsystem') {
    localAppProjectionError('shared LocalAgent AIConfig owner variant');
  }
  const marker = asRecord(ownerVariant.runtimeLocalAgentSubsystem);
  assertExactProjectionKeys(marker, [], 'shared LocalAgent AIConfig owner marker');
  if (!Array.isArray(config.capabilities)) {
    localAppProjectionError('shared LocalAgent AIConfig capabilities');
  }
  return config as unknown as NimiCapabilityAIConfig;
}

function projectSharedAIConfigSnapshot(value: unknown): NimiSharedLocalAgentAIConfigSnapshot {
  const snapshot = asRecord(value);
  assertExactProjectionKeys(snapshot, ['config', 'revision', 'effectiveSelections', 'participation'], 'shared LocalAgent AIConfig snapshot');
  assertSafeProjection(snapshot);
  const config = snapshot.config === null ? null : projectSharedAIConfig(snapshot.config);
  const revision = projectionRevision(snapshot.revision, 'shared LocalAgent AIConfig revision');
  if (!Array.isArray(snapshot.effectiveSelections)) localAppProjectionError('shared LocalAgent AIConfig effective selections');
  snapshot.effectiveSelections.forEach(projectSharedEffectiveSelection);
  const participation = projectSharedParticipation(snapshot.participation);
  return Object.freeze({ config, revision, effectiveSelections: Object.freeze([...snapshot.effectiveSelections]), participation }) as NimiSharedLocalAgentAIConfigSnapshot;
}

function projectSharedAIConfigOverwrite(value: unknown): NimiSharedLocalAgentAIConfigOverwriteResult {
  const result = asRecord(value);
  if (!result) return localAppProjectionError('shared LocalAgent AIConfig overwrite');
  assertSafeProjection(result);
  const revision = projectionRevision(result.revision, 'shared LocalAgent AIConfig revision');
  const config = result.config === null ? null : projectSharedAIConfig(result.config);
  const participation = projectSharedParticipation(result.participation);
  if (result.outcome === 'committed' && config) {
    assertExactProjectionKeys(result, ['outcome', 'config', 'revision', 'participation'], 'shared LocalAgent AIConfig committed overwrite');
    return Object.freeze({ outcome: 'committed', config, revision, participation });
  }
  if (result.outcome === 'conflict' && result.reasonCode === 'AGENT_AI_CONFIG_REVISION_CONFLICT') {
    assertExactProjectionKeys(result, ['outcome', 'config', 'revision', 'participation', 'reasonCode'], 'shared LocalAgent AIConfig conflict overwrite');
    return Object.freeze({ outcome: 'conflict', config, revision, reasonCode: result.reasonCode, participation });
  }
  return localAppProjectionError('shared LocalAgent AIConfig overwrite outcome');
}

function projectSharedParticipation(value: unknown): readonly NimiSharedLocalAgentCapabilityParticipation[] {
  const expected = [
    ['conversation.primary', 'text.generate'],
    ['memory.embedding', 'text.embed'],
    ['conversation.input.voice', 'audio.transcribe'],
    ['conversation.output.voice', 'audio.synthesize'],
    ['conversation.realtime', 'realtime.interact'],
    ['conversation.action.image', 'image.generate'],
  ] as const;
  if (!Array.isArray(value) || value.length !== expected.length) {
    return localAppProjectionError('shared LocalAgent participation');
  }
  return Object.freeze(value.map((entry, index) => {
    const row = asRecord(entry);
    const expectedRow = expected[index];
    assertExactProjectionKeys(row, ['role', 'capabilityContract'], `shared LocalAgent participation ${index}`);
    if (!expectedRow || row.role !== expectedRow[0] || row.capabilityContract !== expectedRow[1]) {
      return localAppProjectionError(`shared LocalAgent participation ${index}`);
    }
    return Object.freeze({ role: expectedRow[0], capabilityContract: expectedRow[1] });
  }));
}

function projectSharedAIConfigOptions(value: unknown): NimiSharedLocalAgentAIConfigOptionsResult {
  const result = asRecord(value);
  if (!result) return localAppProjectionError('shared LocalAgent AIConfig options');
  assertSafeProjection(result);
  if (!['local-loadouts', 'cloud-connectors', 'cloud-targets', 'preset-voices', 'voice-assets'].includes(String(result.kind))
    || !Array.isArray(result.options)
    || result.options.length > SHARED_PRESET_VOICE_OPTIONS_LIMIT
    || typeof result.truncated !== 'boolean') {
    return localAppProjectionError('shared LocalAgent AIConfig options');
  }
  if (result.kind === 'preset-voices') {
    if (result.options.length > SHARED_PRESET_VOICE_OPTIONS_LIMIT) return localAppProjectionError('shared LocalAgent preset voice options');
    assertExactProjectionKeys(result, ['kind', 'options', 'truncated'], 'shared LocalAgent preset voice options');
    result.options.forEach(projectSharedPresetVoiceOption);
    return Object.freeze({
      kind: result.kind,
      options: Object.freeze([...result.options]),
      truncated: result.truncated,
    }) as NimiSharedLocalAgentAIConfigOptionsResult;
  }
  if (result.kind === 'voice-assets') {
    if (result.options.length > SHARED_VOICE_ASSET_OPTIONS_LIMIT) return localAppProjectionError('shared LocalAgent VoiceAsset options');
    assertExactProjectionKeys(result, ['kind', 'options', 'truncated'], 'shared LocalAgent VoiceAsset options');
    result.options.forEach(projectSharedVoiceAssetOption);
    return Object.freeze({
      kind: result.kind,
      options: Object.freeze([...result.options]),
      truncated: result.truncated,
    }) as NimiSharedLocalAgentAIConfigOptionsResult;
  }
  assertExactProjectionKeys(result, ['kind', 'options', 'truncated'], 'shared LocalAgent AIConfig options');
  if (result.kind === 'local-loadouts') result.options.forEach(projectSharedLocalOption);
  else if (result.kind === 'cloud-connectors') result.options.forEach(projectSharedCloudConnectorOption);
  else result.options.forEach(projectSharedCloudTargetOption);
  return Object.freeze({
    kind: result.kind,
    options: Object.freeze([...result.options]),
    truncated: result.truncated,
  }) as NimiSharedLocalAgentAIConfigOptionsResult;
}

function projectSharedVoiceAssetOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, ['voiceAssetId'], `shared LocalAgent VoiceAsset ${index}`);
  if (!validVoiceOptionText(option.voiceAssetId, SHARED_VOICE_ASSET_ID_MAX_SCALARS)) {
    localAppProjectionError(`shared LocalAgent VoiceAsset ${index}`);
  }
}

function projectSharedPresetVoiceOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, ['voiceId', 'name', 'supportedLangs'], `shared LocalAgent preset voice ${index}`);
  if (!validVoiceOptionText(option.voiceId, SHARED_PRESET_VOICE_ID_MAX_SCALARS)
    || !validVoiceOptionText(option.name, SHARED_PRESET_VOICE_NAME_MAX_SCALARS)
    || !Array.isArray(option.supportedLangs)
    || option.supportedLangs.length > SHARED_PRESET_VOICE_LANGS_LIMIT
    || option.supportedLangs.some((lang) => !validVoiceOptionText(lang, SHARED_PRESET_VOICE_LANG_MAX_SCALARS))) {
    localAppProjectionError(`shared LocalAgent preset voice ${index}`);
  }
}

function validVoiceOptionText(value: unknown, maxScalars: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && Array.from(value).length <= maxScalars;
}

function projectSharedEffectiveSelection(value: unknown, index: number): void {
  const selection = asRecord(value);
  assertExactProjectionKeys(selection, ['capabilityContract', 'state', 'resource', 'reasons'], `shared AIConfig effective selection ${index}`);
  if (typeof selection.capabilityContract !== 'string' || !selection.capabilityContract.trim()
    || !['ready', 'missing', 'blocked', 'unavailable'].includes(String(selection.state))
    || !Array.isArray(selection.reasons)) {
    localAppProjectionError(`shared AIConfig effective selection ${index}`);
  }
  if (selection.resource !== null) {
    const resource = asRecord(selection.resource);
    if (!resource) localAppProjectionError(`shared AIConfig effective resource ${index}`);
    if (resource.oneofKind === 'local') {
      assertExactProjectionKeys(resource, ['oneofKind', 'local'], `shared AIConfig effective Local resource ${index}`);
      projectSharedLocalOption(resource.local, index);
    } else if (resource.oneofKind === 'cloud') {
      assertExactProjectionKeys(resource, ['oneofKind', 'cloud'], `shared AIConfig effective Cloud resource ${index}`);
      const cloud = asRecord(resource.cloud);
      assertExactProjectionKeys(cloud, ['connector', 'target'], `shared AIConfig effective Cloud resource ${index}`);
      projectSharedCloudConnectorOption(cloud.connector, index);
      projectSharedCloudTargetOption(cloud.target, index);
    } else localAppProjectionError(`shared AIConfig effective resource ${index}`);
  }
}

function projectSharedCloudConnectorOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, ['connectorRef', 'label', 'provider', 'state', 'reasons'], `shared AIConfig Cloud Connector ${index}`);
  if (typeof option.connectorRef !== 'string' || !option.connectorRef.trim()
    || typeof option.label !== 'string' || !option.label.trim()
    || typeof option.provider !== 'string' || !option.provider.trim()
    || !['ready', 'blocked'].includes(String(option.state)) || !Array.isArray(option.reasons)) {
    localAppProjectionError(`shared AIConfig Cloud Connector ${index}`);
  }
}

function projectSharedCloudTargetOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, [
    'connectorRef', 'label', 'capabilityContract', 'implementation', 'providerModelTarget',
    'supportedFeatures', 'state', 'reasons',
  ], `shared AIConfig Cloud target ${index}`);
  const implementation = asRecord(option.implementation);
  assertExactProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `shared AIConfig Cloud target ${index} implementation`);
  if (typeof option.connectorRef !== 'string' || !option.connectorRef.trim()
    || typeof option.label !== 'string' || !option.label.trim()
    || typeof option.capabilityContract !== 'string' || !option.capabilityContract.trim()
    || !asRecord(option.providerModelTarget) || !Array.isArray(option.supportedFeatures)
    || !['ready', 'blocked'].includes(String(option.state)) || !Array.isArray(option.reasons)) {
    localAppProjectionError(`shared AIConfig Cloud target ${index}`);
  }
}

function projectSharedLocalOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, [
    'loadoutRef', 'label', 'capabilityContract', 'implementation',
    'implementationSupportedFeatures', 'configuredFeatures', 'textBehaviors', 'state', 'reasons',
  ], `shared AIConfig Local option ${index}`);
  if (typeof option.loadoutRef !== 'string' || !option.loadoutRef.trim()
    || typeof option.label !== 'string' || !option.label.trim()
    || typeof option.capabilityContract !== 'string' || !option.capabilityContract.trim()
    || !['ready', 'blocked'].includes(String(option.state))
    || !Array.isArray(option.implementationSupportedFeatures) || !Array.isArray(option.configuredFeatures)
    || !Array.isArray(option.textBehaviors) || !Array.isArray(option.reasons)) {
    localAppProjectionError(`shared AIConfig Local option ${index}`);
  }
  const implementation = asRecord(option.implementation);
  assertExactProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `shared AIConfig Local option ${index} implementation`);
}

function projectionRevision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return localAppProjectionError(field);
  }
  return value;
}

function projectAutonomy(value: unknown): NimiLocalAppAgentAutonomyProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    [
      'enabled',
      'config',
      'usedTokensInWindow',
      'windowStartedAt',
      'budgetExhausted',
      'suspendedUntil',
      'autonomyRevision',
    ],
    'agent autonomy projection',
  );
  assertSafeProjection(record);
  if (typeof record.enabled !== 'boolean' || typeof record.budgetExhausted !== 'boolean') {
    localAppProjectionError('agent autonomy flags');
  }
  if (typeof record.usedTokensInWindow !== 'number'
    || !Number.isSafeInteger(record.usedTokensInWindow)
    || record.usedTokensInWindow < 0) {
    localAppProjectionError('agent autonomy usedTokensInWindow');
  }
  const windowStartedAt = projectTimestamp(record.windowStartedAt, 'agent autonomy windowStartedAt');
  const suspendedUntil = projectTimestamp(record.suspendedUntil, 'agent autonomy suspendedUntil');
  return Object.freeze({
    enabled: record.enabled,
    config: projectAutonomyConfig(record.config),
    usedTokensInWindow: record.usedTokensInWindow,
    ...(windowStartedAt === undefined ? {} : { windowStartedAt }),
    budgetExhausted: record.budgetExhausted,
    ...(suspendedUntil === undefined ? {} : { suspendedUntil }),
    autonomyRevision: projectedRevision(record.autonomyRevision, 'autonomyRevision'),
  });
}

function projectManagerSnapshot(value: unknown): NimiLocalAppAgentManagerSnapshot {
  const projection = asRecord(value);
  assertExactProjectionKeys(
    projection,
    ['lifecycleStatus', 'executionState', 'statusText', 'currentEmotion', 'source', 'context', 'actionAvailability'],
    'Agent Center manager snapshot',
  );
  assertSafeProjection(projection);
  return Object.freeze({
    lifecycleStatus: managerEnum(
      projection.lifecycleStatus,
      MANAGER_LIFECYCLE_STATUSES,
      'Agent Center manager lifecycleStatus',
    ),
    executionState: managerEnum(
      projection.executionState,
      MANAGER_EXECUTION_STATES,
      'Agent Center manager executionState',
    ),
    statusText: managerText(projection.statusText, 'Agent Center manager statusText'),
    currentEmotion: managerText(projection.currentEmotion, 'Agent Center manager currentEmotion'),
    source: projectManagerSource(projection.source),
    context: projectManagerContext(projection.context),
    actionAvailability: projectManagerActionAvailability(projection.actionAvailability),
  });
}

function projectManagerActionAvailability(
  value: unknown,
): NimiLocalAppAgentManagerActionAvailabilityProjection {
  const projection = asRecord(value);
  assertExactProjectionKeys(
    projection,
    NIMI_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTIONS,
    'Agent Center manager action availability',
  );
  const result = {} as Record<NimiLocalAppAgentManagerProductAction, NimiLocalAppAgentManagerActionAvailability>;
  for (const action of NIMI_LOCAL_APP_AGENT_MANAGER_PRODUCT_ACTIONS) {
    const availability = asRecord(projection[action]);
    assertExactProjectionKeys(availability, ['state', 'reason'], `Agent Center manager action ${action}`);
    if (availability.state === 'available' && availability.reason === null) {
      result[action] = Object.freeze({ state: 'available', reason: null });
      continue;
    }
    if (availability.state !== 'unavailable' || typeof availability.reason !== 'string' || ![
      'operation-unavailable',
      'owner-unavailable',
      'memory-disabled',
      'memory-adoption-required',
      'previous-presentation-unavailable',
    ].includes(availability.reason)) {
      return localAppProjectionError(`Agent Center manager action ${action}`);
    }
    result[action] = Object.freeze({
      state: 'unavailable',
      reason: availability.reason as NimiLocalAppAgentManagerActionUnavailableReason,
    });
  }
  return Object.freeze(result);
}

function projectManagerSource(value: unknown): NimiLocalAppAgentManagerSourceProjection | null {
  if (value === null) return null;
  const source = asRecord(value);
  assertExactProjectionKeys(
    source,
    [
      'ready', 'state', 'reasonCode', 'capturedAt', 'coverageSections', 'lorebookReady',
      'lorebookItemCount', 'lorebookEstimatedTokens',
    ],
    'Agent Center manager source',
  );
  if (typeof source.ready !== 'boolean' || typeof source.lorebookReady !== 'boolean') {
    localAppProjectionError('Agent Center manager source flags');
  }
  const state = managerEnum(source.state, MANAGER_SOURCE_STATES, 'Agent Center manager source state');
  const reasonCode = managerEnum(source.reasonCode, MANAGER_REASON_CODES, 'Agent Center manager source reasonCode');
  if ((source.ready && (state !== 'ready' || reasonCode !== 'none')) || (!source.ready && state === 'ready')) {
    localAppProjectionError('Agent Center manager source readiness');
  }
  if (!Array.isArray(source.coverageSections)
    || source.coverageSections.length > MANAGER_COVERAGE_SECTIONS.size) {
    localAppProjectionError('Agent Center manager source coverageSections');
  }
  const seenSections = new Set<NimiLocalAppAgentManagerCoverageSection>();
  const coverageSections = source.coverageSections.map((value, index) => {
    const row = asRecord(value);
    assertExactProjectionKeys(
      row,
      ['section', 'state', 'requiredCount', 'resolvedCount', 'omittedCount'],
      `Agent Center manager source coverage ${index}`,
    );
    const section = managerEnum(
      row.section,
      MANAGER_COVERAGE_SECTIONS,
      `Agent Center manager source coverage ${index} section`,
    );
    if (seenSections.has(section)) localAppProjectionError('Agent Center manager source duplicate coverage section');
    seenSections.add(section);
    const requiredCount = managerUint32(row.requiredCount, `Agent Center manager source coverage ${index} requiredCount`);
    const resolvedCount = managerUint32(row.resolvedCount, `Agent Center manager source coverage ${index} resolvedCount`);
    const omittedCount = managerUint32(row.omittedCount, `Agent Center manager source coverage ${index} omittedCount`);
    const coverageState = managerEnum(
      row.state,
      MANAGER_COVERAGE_STATES,
      `Agent Center manager source coverage ${index} state`,
    );
    if ((coverageState === 'complete' && resolvedCount < requiredCount)
      || (coverageState === 'not_applicable' && (requiredCount !== 0 || resolvedCount !== 0 || omittedCount !== 0))
      || (coverageState === 'optional_omitted' && (requiredCount !== 0 || omittedCount === 0))
      || (coverageState === 'invalid' && resolvedCount >= requiredCount)) {
      localAppProjectionError(`Agent Center manager source coverage ${index} counts contradict state`);
    }
    return Object.freeze({
      section,
      state: coverageState,
      requiredCount,
      resolvedCount,
      omittedCount,
    });
  });
  const capturedAt = projectTimestamp(source.capturedAt, 'Agent Center manager source capturedAt') ?? null;
  return Object.freeze({
    ready: source.ready,
    state,
    reasonCode,
    capturedAt,
    coverageSections: Object.freeze(coverageSections),
    lorebookReady: source.lorebookReady,
    lorebookItemCount: managerUint32(source.lorebookItemCount, 'Agent Center manager source lorebookItemCount'),
    lorebookEstimatedTokens: managerUint64(source.lorebookEstimatedTokens, 'Agent Center manager source lorebookEstimatedTokens'),
  });
}

function projectManagerContext(value: unknown): NimiLocalAppAgentManagerContextProjection | null {
  if (value === null) return null;
  const context = asRecord(value);
  assertExactProjectionKeys(
    context,
    [
      'ready', 'state', 'reasonCode', 'lanes', 'inputBudgetTokens', 'usedTokens',
      'requiredInputTokens', 'requiredContextWindowTokens', 'truncation', 'transcriptTurnCount',
      'memoryItemCount', 'mediaCount', 'toolCount', 'sourceAdapterStatus', 'sourceSelectionStatus',
      'conversationSummaryStatus', 'privateRecallCount',
    ],
    'Agent Center manager context',
  );
  if (typeof context.ready !== 'boolean') localAppProjectionError('Agent Center manager context ready');
  const state = managerEnum(context.state, MANAGER_CONTEXT_STATES, 'Agent Center manager context state');
  const reasonCode = managerEnum(context.reasonCode, MANAGER_REASON_CODES, 'Agent Center manager context reasonCode');
  if ((context.ready && (state !== 'ready' || reasonCode !== 'none')) || (!context.ready && state === 'ready')) {
    localAppProjectionError('Agent Center manager context readiness');
  }
  if (!Array.isArray(context.lanes) || context.lanes.length > MANAGER_LANE_IDS.size) {
    localAppProjectionError('Agent Center manager context lanes');
  }
  const seenLanes = new Set<NimiLocalAppAgentManagerLaneId>();
  const lanes = context.lanes.map((value, index) => {
    const lane = asRecord(value);
    assertExactProjectionKeys(
      lane,
      [
        'laneId', 'state', 'includedItemCount', 'omittedItemCount', 'truncatedItemCount',
        'allocatedTokens', 'usedTokens',
      ],
      `Agent Center manager context lane ${index}`,
    );
    const laneId = managerEnum(lane.laneId, MANAGER_LANE_IDS, `Agent Center manager context lane ${index} laneId`);
    if (seenLanes.has(laneId)) localAppProjectionError('Agent Center manager context duplicate lane');
    seenLanes.add(laneId);
    const allocatedTokens = managerUint64(lane.allocatedTokens, `Agent Center manager context lane ${index} allocatedTokens`);
    const usedTokens = managerUint64(lane.usedTokens, `Agent Center manager context lane ${index} usedTokens`);
    if (BigInt(usedTokens) > BigInt(allocatedTokens)) {
      localAppProjectionError(`Agent Center manager context lane ${index} token usage`);
    }
    return Object.freeze({
      laneId,
      state: managerEnum(lane.state, MANAGER_LANE_STATES, `Agent Center manager context lane ${index} state`),
      includedItemCount: managerUint32(lane.includedItemCount, `Agent Center manager context lane ${index} includedItemCount`),
      omittedItemCount: managerUint32(lane.omittedItemCount, `Agent Center manager context lane ${index} omittedItemCount`),
      truncatedItemCount: managerUint32(lane.truncatedItemCount, `Agent Center manager context lane ${index} truncatedItemCount`),
      allocatedTokens,
      usedTokens,
    });
  });
  if (!Array.isArray(context.truncation) || context.truncation.length > MANAGER_TRUNCATION_REASONS.size) {
    localAppProjectionError('Agent Center manager context truncation');
  }
  const seenTruncation = new Set<NimiLocalAppAgentManagerTruncationReason>();
  const truncation = context.truncation.map((value, index) => {
    const row = asRecord(value);
    assertExactProjectionKeys(
      row,
      ['reason', 'omittedItemCount', 'truncatedItemCount'],
      `Agent Center manager context truncation ${index}`,
    );
    const reason = managerEnum(
      row.reason,
      MANAGER_TRUNCATION_REASONS,
      `Agent Center manager context truncation ${index} reason`,
    );
    if (seenTruncation.has(reason)) localAppProjectionError('Agent Center manager context duplicate truncation reason');
    seenTruncation.add(reason);
    return Object.freeze({
      reason,
      omittedItemCount: managerUint32(row.omittedItemCount, `Agent Center manager context truncation ${index} omittedItemCount`),
      truncatedItemCount: managerUint32(row.truncatedItemCount, `Agent Center manager context truncation ${index} truncatedItemCount`),
    });
  });
  const inputBudgetTokens = managerUint64(context.inputBudgetTokens, 'Agent Center manager context inputBudgetTokens');
  const usedTokens = managerUint64(context.usedTokens, 'Agent Center manager context usedTokens');
  if (BigInt(usedTokens) > BigInt(inputBudgetTokens)) localAppProjectionError('Agent Center manager context token usage');
  return Object.freeze({
    ready: context.ready,
    state,
    reasonCode,
    lanes: Object.freeze(lanes),
    inputBudgetTokens,
    usedTokens,
    requiredInputTokens: managerUint64(context.requiredInputTokens, 'Agent Center manager context requiredInputTokens'),
    requiredContextWindowTokens: managerUint64(
      context.requiredContextWindowTokens,
      'Agent Center manager context requiredContextWindowTokens',
    ),
    truncation: Object.freeze(truncation),
    transcriptTurnCount: managerUint32(context.transcriptTurnCount, 'Agent Center manager context transcriptTurnCount'),
    memoryItemCount: managerUint32(context.memoryItemCount, 'Agent Center manager context memoryItemCount'),
    mediaCount: managerUint32(context.mediaCount, 'Agent Center manager context mediaCount'),
    toolCount: managerUint32(context.toolCount, 'Agent Center manager context toolCount'),
    sourceAdapterStatus: managerEnum(
      context.sourceAdapterStatus,
      MANAGER_SOURCE_COGNITION_STATUSES,
      'Agent Center manager context sourceAdapterStatus',
    ),
    sourceSelectionStatus: managerEnum(
      context.sourceSelectionStatus,
      MANAGER_SOURCE_COGNITION_STATUSES,
      'Agent Center manager context sourceSelectionStatus',
    ),
    conversationSummaryStatus: managerEnum(
      context.conversationSummaryStatus,
      MANAGER_CONVERSATION_SUMMARY_STATUSES,
      'Agent Center manager context conversationSummaryStatus',
    ),
    privateRecallCount: managerUint32(context.privateRecallCount, 'Agent Center manager context privateRecallCount'),
  });
}

function managerEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) localAppProjectionError(field);
  return value as T;
}

function managerUint32(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    localAppProjectionError(field);
  }
  return value;
}

function managerUint64(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) {
    localAppProjectionError(field);
  }
  return value;
}

function managerText(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_AGENT_CONFIGURE_TEXT_BYTES) {
    localAppProjectionError(field);
  }
  return value;
}

function projectMemoryProjection(value: unknown): NimiLocalAppAgentMemoryProjection {
  const projection = asRecord(value);
  assertExactProjectionKeys(projection, ['outcome', 'enabled', 'adoptionRequired', 'items', 'currentCount', 'supersededCount', 'forgottenCount', 'nextPageToken'], 'agent Memory projection');
  assertSafeProjection(projection);
  const outcomes = new Set(['unconfigured', 'building', 'ready', 'no_hits', 'unavailable', 'failed', 'invalid', 'pending', 'committed', 'conflict', 'forgotten', 'deleted', 'no_effect', 'admitted', 'rejected']);
  if (!outcomes.has(String(projection.outcome)) || typeof projection.enabled !== 'boolean' || typeof projection.adoptionRequired !== 'boolean' || !Array.isArray(projection.items)) {
    return localAppProjectionError('agent Memory projection');
  }
  const counts = [projection.currentCount, projection.supersededCount, projection.forgottenCount];
  if (counts.some((count) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) return localAppProjectionError('agent Memory counts');
  const items = projection.items.map((value, index) => {
    const item = asRecord(value);
    assertExactProjectionKeys(item, ['memoryId', 'content', 'epistemicStatus', 'lifecycle', 'occurredAt', 'updatedAt', 'sourceExplanation'], `agent Memory item ${index}`);
    if (typeof item.memoryId !== 'string' || !item.memoryId.trim() || typeof item.content !== 'string' || !item.content.trim()
      || !['explicit', 'inferred', 'consolidated'].includes(String(item.epistemicStatus))
      || !['current', 'superseded', 'conflicted'].includes(String(item.lifecycle))
      || typeof item.sourceExplanation !== 'string' || !item.sourceExplanation.trim()) {
      return localAppProjectionError(`agent Memory item ${index}`);
    }
    return Object.freeze({
      memoryId: item.memoryId, content: item.content,
      epistemicStatus: item.epistemicStatus, lifecycle: item.lifecycle,
      occurredAt: memoryTimestamp(item.occurredAt, `agent Memory item ${index} occurredAt`),
      updatedAt: memoryTimestamp(item.updatedAt, `agent Memory item ${index} updatedAt`), sourceExplanation: item.sourceExplanation,
    }) as NimiLocalAppAgentMemoryItem;
  });
  return Object.freeze({
    outcome: projection.outcome, enabled: projection.enabled, adoptionRequired: projection.adoptionRequired,
    items: Object.freeze(items), currentCount: projection.currentCount, supersededCount: projection.supersededCount, forgottenCount: projection.forgottenCount,
    nextPageToken: projection.nextPageToken === null
      ? null
      : memoryPageToken(projection.nextPageToken, 'agent Memory nextPageToken'),
  }) as NimiLocalAppAgentMemoryProjection;
}

function memoryPageToken(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_AGENT_MEMORY_PAGE_TOKEN_BYTES
    || [...value].some((character) => character < ' ' || character === '\u007f')) {
    return localAppProjectionError(field);
  }
  return value;
}

function memoryTimestamp(value: unknown, field: string): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  const timestamp = asRecord(value);
  assertExactProjectionKeys(timestamp, ['seconds', 'nanos'], field);
  if (typeof timestamp.seconds !== 'string' || !/^-?[0-9]+$/u.test(timestamp.seconds)
    || typeof timestamp.nanos !== 'number' || !Number.isInteger(timestamp.nanos) || timestamp.nanos < 0 || timestamp.nanos > 999_999_999) {
    return localAppProjectionError(field);
  }
  const millis = (BigInt(timestamp.seconds) * 1000n) + BigInt(Math.floor(timestamp.nanos / 1_000_000));
  const numeric = Number(millis);
  if (!Number.isSafeInteger(numeric)) return localAppProjectionError(field);
  return new Date(numeric).toISOString();
}

function projectMemoryMutation(value: unknown): NimiLocalAppAgentMemoryMutationResult {
  const result = asRecord(value);
  assertExactProjectionKeys(result, ['outcome', 'affectedMemoryIds', 'projection'], 'agent Memory mutation result');
  if (!Array.isArray(result.affectedMemoryIds) || result.affectedMemoryIds.some((id) => typeof id !== 'string' || !id.trim())) {
    return localAppProjectionError('agent Memory mutation affected ids');
  }
  const projection = projectMemoryProjection(result.projection);
  if (result.outcome !== projection.outcome && !['committed', 'admitted', 'forgotten', 'deleted', 'no_effect'].includes(String(result.outcome))) {
    return localAppProjectionError('agent Memory mutation outcome');
  }
  return Object.freeze({ outcome: result.outcome, affectedMemoryIds: Object.freeze([...result.affectedMemoryIds]), projection }) as NimiLocalAppAgentMemoryMutationResult;
}

function projectAutonomyConfig(value: unknown): NimiLocalAppAgentAutonomyConfig | null {
  if (value === null) return null;
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['dailyTokenBudget', 'maxTokensPerHook', 'minHookInterval', 'suspendUntil', 'mode'],
    'agent autonomy config',
  );
  if (typeof record.dailyTokenBudget !== 'number'
    || !Number.isSafeInteger(record.dailyTokenBudget)
    || record.dailyTokenBudget < 0
    || typeof record.maxTokensPerHook !== 'number'
    || !Number.isSafeInteger(record.maxTokensPerHook)
    || record.maxTokensPerHook < 0) {
    localAppProjectionError('agent autonomy config budgets');
  }
  const mode = record.mode;
  if (typeof mode !== 'string' || !AUTONOMY_MODES.has(mode as NimiLocalAppAgentAutonomyMode)) {
    localAppProjectionError('agent autonomy mode');
  }
  const minHookInterval = projectTimestamp(record.minHookInterval, 'agent autonomy minHookInterval');
  const suspendUntil = projectTimestamp(record.suspendUntil, 'agent autonomy config suspendUntil');
  return Object.freeze({
    dailyTokenBudget: record.dailyTokenBudget,
    maxTokensPerHook: record.maxTokensPerHook,
    ...(minHookInterval === undefined ? {} : { minHookInterval }),
    ...(suspendUntil === undefined ? {} : { suspendUntil }),
    mode: mode as NimiLocalAppAgentAutonomyMode,
  });
}

function projectPresentation(value: unknown): NimiLocalAppAgentPresentationProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['profile', 'previousProfile', 'defaultVoiceReference', 'avatarAutoplay', 'presentationRevision', 'resourcePackSelection'],
    'agent presentation projection',
  );
  assertSafeProjection(record);
  return Object.freeze({
    profile: projectPresentationProfile(record.profile),
    previousProfile: projectPresentationProfile(record.previousProfile),
    defaultVoiceReference: projectedConfigureText(record.defaultVoiceReference, 'defaultVoiceReference'),
    avatarAutoplay: typeof record.avatarAutoplay === 'boolean'
      ? record.avatarAutoplay
      : localAppProjectionError('agent presentation avatarAutoplay'),
    presentationRevision: projectedRevision(record.presentationRevision, 'presentationRevision'),
    resourcePackSelection: projectResourcePackSelection(record.resourcePackSelection),
  });
}

function projectResourcePackSelection(value: unknown): NimiLocalAppAgentResourcePackSelection | null {
  if (value === null) return null;
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['assetRef', 'targetId', 'targetVersion'], 'agent Resource Pack selection');
  assertSafeProjection(record);
  const assetRef = projectedConfigureText(record.assetRef, 'Resource Pack assetRef');
  if (!assetRef || record.targetId !== RESOURCE_PACK_TARGET_ID || record.targetVersion !== RESOURCE_PACK_TARGET_VERSION) {
    return localAppProjectionError('agent Resource Pack selection');
  }
  return Object.freeze({
    assetRef,
    targetId: RESOURCE_PACK_TARGET_ID,
    targetVersion: RESOURCE_PACK_TARGET_VERSION,
  });
}

function projectRuntimePresentationAsset(
  value: GetAgentPresentationAssetResponse,
): NimiLocalAppAgentPresentationAsset {
  const backendKind = projectRuntimePresentationBackend(value.backendKind);
  if (value.role === AgentPresentationAssetRole.RESOURCE_PACK) {
    if (backendKind !== null || value.mediaType !== RESOURCE_PACK_MEDIA_TYPE) {
      return localAppProjectionError('agent Resource Pack asset role, backendKind, or mediaType');
    }
    return projectPresentationAsset({
      assetRef: value.assetRef,
      role: 'resource-pack',
      fileName: value.fileName,
      mediaType: value.mediaType,
      content: value.content,
      sha256: value.sha256,
    });
  }
  if (value.role !== AgentPresentationAssetRole.AVATAR || backendKind === null) {
    return localAppProjectionError('agent presentation asset role or backendKind');
  }
  return projectPresentationAsset({
    assetRef: value.assetRef,
    role: 'avatar',
    backendKind,
    fileName: value.fileName,
    mediaType: value.mediaType,
    content: value.content,
    sha256: value.sha256,
  });
}

function projectPresentationAsset(value: unknown): NimiLocalAppAgentPresentationAsset {
  const record = asRecord(value);
  if (!record) return localAppProjectionError('agent presentation asset');
  const resourcePack = record.role === 'resource-pack';
  assertExactProjectionKeys(
    record,
    resourcePack
      ? ['assetRef', 'role', 'fileName', 'mediaType', 'content', 'sha256']
      : ['assetRef', 'role', 'backendKind', 'fileName', 'mediaType', 'content', 'sha256'],
    'agent presentation asset',
  );
  assertSafeProjection(record);
  if (!resourcePack && (record.role !== 'avatar'
    || typeof record.backendKind !== 'string'
    || !PRESENTATION_BACKENDS.has(record.backendKind as NimiLocalAppAgentPresentationBackendKind))) {
    return localAppProjectionError('agent presentation asset role or backendKind');
  }
  const content = record.content instanceof Uint8Array
    ? new Uint8Array(record.content)
    : Array.isArray(record.content)
      && record.content.every((entry) => Number.isSafeInteger(entry) && entry >= 0 && entry <= 255)
      ? Uint8Array.from(record.content as number[])
      : localAppProjectionError('agent presentation asset content');
  const contentLimit = resourcePack ? MAX_RESOURCE_PACK_CONTENT_BYTES : MAX_PRESENTATION_ASSET_CONTENT_BYTES;
  if (content.byteLength === 0 || content.byteLength > contentLimit) {
    return localAppProjectionError('agent presentation asset content');
  }
  const sha256 = projectedConfigureText(record.sha256, 'presentation asset sha256');
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    return localAppProjectionError('agent presentation asset sha256');
  }
  const assetRef = projectedConfigureText(record.assetRef, 'presentation assetRef');
  const fileName = projectedConfigureText(record.fileName, 'presentation asset fileName');
  const mediaType = projectedConfigureText(record.mediaType, 'presentation asset mediaType');
  if (!assetRef || !fileName || !mediaType) {
    return localAppProjectionError('agent presentation asset identity');
  }
  if (resourcePack) {
    if (mediaType !== RESOURCE_PACK_MEDIA_TYPE) return localAppProjectionError('agent Resource Pack asset mediaType');
    return Object.freeze({
      assetRef,
      role: 'resource-pack',
      fileName,
      mediaType: RESOURCE_PACK_MEDIA_TYPE,
      content,
      sha256,
    });
  }
  return Object.freeze({
    assetRef,
    role: 'avatar',
    backendKind: record.backendKind as NimiLocalAppAgentPresentationBackendKind,
    fileName,
    mediaType,
    content,
    sha256,
  });
}

function projectPresentationProfile(value: unknown): NimiLocalAppAgentPresentationProfile | null {
  if (value === null) return null;
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    [
      'backendKind',
      'avatarAssetRef',
      'expressionProfileRef',
      'idlePreset',
      'interactionPolicyRef',
      'defaultVoiceReference',
      'avatarAutoplay',
      'backgroundAssetRef',
      'revision',
    ],
    'agent presentation profile',
  );
  const backendKind = record.backendKind;
  const avatarAssetRef = projectedConfigureText(record.avatarAssetRef, 'avatarAssetRef');
  if (backendKind === null) {
    if (avatarAssetRef) localAppProjectionError('agent presentation backendKind');
  } else if (typeof backendKind !== 'string'
    || !PRESENTATION_BACKENDS.has(backendKind as NimiLocalAppAgentPresentationBackendKind)) {
    localAppProjectionError('agent presentation backendKind');
  }
  if (typeof record.avatarAutoplay !== 'boolean') {
    localAppProjectionError('agent presentation avatarAutoplay');
  }
  return Object.freeze({
    backendKind: backendKind as NimiLocalAppAgentPresentationBackendKind | null,
    avatarAssetRef,
    expressionProfileRef: projectedConfigureText(record.expressionProfileRef, 'expressionProfileRef'),
    idlePreset: projectedConfigureText(record.idlePreset, 'idlePreset'),
    interactionPolicyRef: projectedConfigureText(record.interactionPolicyRef, 'interactionPolicyRef'),
    defaultVoiceReference: projectedConfigureText(record.defaultVoiceReference, 'defaultVoiceReference'),
    avatarAutoplay: record.avatarAutoplay,
    backgroundAssetRef: projectedConfigureText(record.backgroundAssetRef, 'backgroundAssetRef'),
    revision: projectedRevision(record.revision, 'presentation profile revision'),
  });
}

function projectedConfigureText(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_AGENT_CONFIGURE_TEXT_BYTES) {
    localAppProjectionError(`agent presentation ${field}`);
  }
  return value;
}

function projectedRevision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    localAppProjectionError(field);
  }
  return value;
}
