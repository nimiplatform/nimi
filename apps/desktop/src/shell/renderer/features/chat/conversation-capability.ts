/**
 * Conversation capability submodel (D-AIPC-010).
 *
 * This module defines the conversation-capability domain types, projection
 * builder, and execution snapshot factory. These are **submodels** of the
 * AIConfig / AISnapshot umbrella authority (D-AIPC-001). They are NOT
 * independent product-level owners.
 *
 * Primary authority chain:
 *   AIConfig (live truth) -> capabilities.selectedBindings (selection submodel)
 *   AISnapshot (execution truth) -> conversationCapabilitySlice (snapshot submodel)
 *
 * UI and adapter code should write config through the AIConfigSDKSurface
 * (desktop-ai-config-service.ts), not through these helpers directly.
 * The projection builder and snapshot factory are consumed by the surface
 * and by bootstrap/effects code, not by product-facing UI components.
 */
import type {
  AIConfig,
  AIRuntimeEvidence,
  AIScopeRef,
  AISnapshot,
} from '@nimiplatform/sdk/ai';
import {
  createAISnapshotExecutionId,
  createAISnapshotRecord,
} from '@nimiplatform/sdk/ai';
import type {
  RuntimeResolvedBinding,
  RuntimeRouteBinding,
  RuntimeRouteDescribeResult,
  RuntimeRouteHealthResult,
} from '@nimiplatform/sdk/runtime';
import {
  RUNTIME_ROUTE_APP_CAPABILITIES,
  buildRuntimeRouteCapabilityProjection,
  buildRuntimeRouteCapabilityProjectionMap,
  createDefaultRuntimeRouteCapabilitySelectionStore,
  toRuntimeRouteCanonicalCapability,
  updateRuntimeRouteCapabilityBinding,
  type BuildRuntimeRouteCapabilityProjectionInput,
  type RuntimeRouteAppCapability,
  type RuntimeRouteCapabilityProjection,
  type RuntimeRouteCapabilityProjectionMap,
  type RuntimeRouteCapabilityProjectionReasonCode,
  type RuntimeRouteCapabilityRuntime,
  type RuntimeRouteCapabilitySelectionStore,
} from '@nimiplatform/sdk/runtime';

export const CONVERSATION_CAPABILITIES = RUNTIME_ROUTE_APP_CAPABILITIES;

export type ConversationCapability = RuntimeRouteAppCapability;
export const AGENT_VOICE_WORKFLOW_CAPABILITIES = [
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
] as const;
export type AgentVoiceWorkflowCapability = (typeof AGENT_VOICE_WORKFLOW_CAPABILITIES)[number];
export type AgentVoiceWorkflowType = 'voice_clone' | 'voice_design';

export const toRuntimeCanonicalCapability = toRuntimeRouteCanonicalCapability;

export type RuntimeLocalProfileRef = {
  targetId: string;
  profileId: string;
};

export type ConversationCapabilitySelectionStore = RuntimeRouteCapabilitySelectionStore;

export type ConversationCapabilityProjectionReasonCode = RuntimeRouteCapabilityProjectionReasonCode;

export type ConversationCapabilityProjection = RuntimeRouteCapabilityProjection;

export type AgentVoiceWorkflowProjectionMap =
  Partial<Record<AgentVoiceWorkflowCapability, ConversationCapabilityProjection | null>>;

export type AgentVoiceWorkflowReadyMap =
  Partial<Record<AgentVoiceWorkflowCapability, boolean>>;

export type AgentEffectiveCapabilityResolution = {
  ready: boolean;
  textProjection: ConversationCapabilityProjection | null;
  imageProjection: ConversationCapabilityProjection | null;
  voiceProjection: ConversationCapabilityProjection | null;
  voiceWorkflowProjections: AgentVoiceWorkflowProjectionMap;
  voiceWorkflowReadyByCapability: AgentVoiceWorkflowReadyMap;
  imageReady: boolean;
  voiceReady: boolean;
  reason:
    | 'ok'
    | 'projection_unavailable'
    | 'route_unresolved';
};

export type ConversationExecutionSnapshot = {
  executionId: string;
  createdAt: string;
  capability: ConversationCapability;
  selectedBinding: RuntimeRouteBinding | null;
  resolvedBinding: RuntimeResolvedBinding | null;
  health: RuntimeRouteHealthResult | null;
  metadata: RuntimeRouteDescribeResult | null;
  agentResolution: AgentEffectiveCapabilityResolution | null;
};

export type ConversationCapabilityProjectionMap = RuntimeRouteCapabilityProjectionMap;

export type ConversationCapabilityRouteRuntime = RuntimeRouteCapabilityRuntime;

type BuildConversationCapabilityProjectionInput = Omit<BuildRuntimeRouteCapabilityProjectionInput,
  'capability'> & {
  capability: ConversationCapability;
};

let conversationCapabilityRouteRuntime: ConversationCapabilityRouteRuntime | null = null;

export function createDefaultConversationCapabilitySelectionStore(): ConversationCapabilitySelectionStore {
  return createDefaultRuntimeRouteCapabilitySelectionStore();
}

export function updateConversationCapabilityBinding(
  state: ConversationCapabilitySelectionStore,
  capability: ConversationCapability,
  binding: RuntimeRouteBinding | null | undefined,
  ): ConversationCapabilitySelectionStore {
  return updateRuntimeRouteCapabilityBinding(state,
  capability,
  binding);
}

export function setConversationCapabilityRouteRuntime(runtime: ConversationCapabilityRouteRuntime | null): void {
  conversationCapabilityRouteRuntime = runtime;
}

export function getConversationCapabilityRouteRuntime(): ConversationCapabilityRouteRuntime | null {
  return conversationCapabilityRouteRuntime;
}

export async function buildConversationCapabilityProjection(
  input: BuildConversationCapabilityProjectionInput,
  ): Promise<ConversationCapabilityProjection> {
  return buildRuntimeRouteCapabilityProjection({
    ...input,
  routeRuntime: input.routeRuntime || conversationCapabilityRouteRuntime,
  });
}

export async function buildConversationCapabilityProjectionMap(input: {
  selectionStore: ConversationCapabilitySelectionStore;
  routeRuntime?: ConversationCapabilityRouteRuntime | null;
  hostAllowlist?: Partial<Record<ConversationCapability,
  boolean>>;
  capabilities?: readonly ConversationCapability[];
}): Promise<ConversationCapabilityProjectionMap> {
  return buildRuntimeRouteCapabilityProjectionMap({
    ...input,
  routeRuntime: input.routeRuntime || conversationCapabilityRouteRuntime,
  });
}

export function buildAgentEffectiveCapabilityResolution(input: {
  textProjection: ConversationCapabilityProjection | null;
  imageProjection?: ConversationCapabilityProjection | null;
  voiceProjection?: ConversationCapabilityProjection | null;
  voiceWorkflowCloneProjection?: ConversationCapabilityProjection | null;
  voiceWorkflowDesignProjection?: ConversationCapabilityProjection | null;
}): AgentEffectiveCapabilityResolution {
  const textProjection = input.textProjection || null;
  const imageProjection = input.imageProjection || null;
  const voiceProjection = input.voiceProjection || null;
  const voiceWorkflowProjections: AgentVoiceWorkflowProjectionMap = {
    'voice_workflow.voice_clone': input.voiceWorkflowCloneProjection || null,
  'voice_workflow.voice_design': input.voiceWorkflowDesignProjection || null,
  };
  const voiceWorkflowReadyByCapability: AgentVoiceWorkflowReadyMap = {
    'voice_workflow.voice_clone': Boolean(
      voiceWorkflowProjections['voice_workflow.voice_clone']?.supported
        && voiceWorkflowProjections['voice_workflow.voice_clone']?.resolvedBinding,
  ),
  'voice_workflow.voice_design': Boolean(
      voiceWorkflowProjections['voice_workflow.voice_design']?.supported
        && voiceWorkflowProjections['voice_workflow.voice_design']?.resolvedBinding,
  ),
  };
  const imageReady = Boolean(imageProjection?.supported && imageProjection?.resolvedBinding);
  const voiceReady = Boolean(voiceProjection?.supported && voiceProjection?.resolvedBinding);
  if (!textProjection || !textProjection.supported) {
    return {
      ready: false,
  textProjection,
  imageProjection,
  voiceProjection,
  voiceWorkflowProjections,
  voiceWorkflowReadyByCapability,
  imageReady,
  voiceReady,
  reason: 'projection_unavailable',
  };
  }

  if (!textProjection.resolvedBinding) {
    return {
      ready: false,
  textProjection,
  imageProjection,
  voiceProjection,
  voiceWorkflowProjections,
  voiceWorkflowReadyByCapability,
  imageReady,
  voiceReady,
  reason: 'route_unresolved',
  };
  }

  return {
    ready: true,
  textProjection,
  imageProjection,
  voiceProjection,
  voiceWorkflowProjections,
  voiceWorkflowReadyByCapability,
  imageReady,
  voiceReady,
  reason: 'ok',
  };
}

export function createConversationExecutionSnapshot(input: {
  capability: ConversationCapability;
  projection: ConversationCapabilityProjection;
  agentResolution?: AgentEffectiveCapabilityResolution | null;
}): ConversationExecutionSnapshot {
  return {
    executionId: createAISnapshotExecutionId(),
  createdAt: new Date().toISOString(),
  capability: input.capability,
  selectedBinding: input.projection.selectedBinding,
  resolvedBinding: input.projection.resolvedBinding,
  health: input.projection.health,
  metadata: input.projection.metadata,
  agentResolution: input.agentResolution || null,
  };
}


// ---------------------------------------------------------------------------
// AIConfig <-> ConversationCapabilitySelectionStore bridge  (D-AIPC-010)
// ---------------------------------------------------------------------------

export function aiConfigFromSelectionStore(
  store: ConversationCapabilitySelectionStore,
  scopeRef: AIScopeRef,
  ): AIConfig {
  return {
    scopeRef,
  capabilities: {
      selectedBindings: { ...store.selectedBindings },
  localProfileRefs: {},
  selectedParams: {},
  },
  profileOrigin: null,
  };
}

export function selectionStoreFromAIConfig(config: AIConfig): ConversationCapabilitySelectionStore {
  return {
    version: createDefaultConversationCapabilitySelectionStore().version,
  selectedBindings: { ...config.capabilities.selectedBindings } as ConversationCapabilitySelectionStore['selectedBindings'],
  };
}

// ---------------------------------------------------------------------------
// AISnapshot factory  (D-AIPC-004)
// ---------------------------------------------------------------------------

export function createAISnapshot(input: {
  scopeRef?: AIScopeRef;
  config: AIConfig;
  capability: ConversationCapability;
  projection: ConversationCapabilityProjection;
  agentResolution?: AgentEffectiveCapabilityResolution | null;
  runtimeEvidence?: AIRuntimeEvidence | null;
}): AISnapshot {
  const capabilitySlice = createConversationExecutionSnapshot({
    capability: input.capability,
  projection: input.projection,
  agentResolution: input.agentResolution,
  });
  return createAISnapshotRecord({
    scopeRef: input.scopeRef || input.config.scopeRef,
  config: input.config,
  capability: capabilitySlice.capability,
  selectedBinding: capabilitySlice.selectedBinding,
  resolvedBinding: capabilitySlice.resolvedBinding,
  health: capabilitySlice.health,
  metadata: capabilitySlice.metadata,
  agentResolution: capabilitySlice.agentResolution,
  runtimeEvidence: input.runtimeEvidence || null,
  executionId: capabilitySlice.executionId,
  createdAt: capabilitySlice.createdAt,
  });
}

// Re-export SDK AI config types for desktop consumers
export type {
  AIConfig,
  AIConfigCapabilities,
  AIConfigEvidence,
  AIConversationExecutionSlice,
  AIProfile,
  AIProfileCapabilityIntent,
  AIProfileRef,
  AIRuntimeEvidence,
  AIRuntimeLocalProfileRef,
  AISchedulingJudgement,
  AISchedulingOccupancy,
  AISchedulingState,
  AIScopeKind,
  AIScopeRef,
  AISnapshot,
} from '@nimiplatform/sdk/ai';
export { applyAIProfileToConfig, createEmptyAIConfig } from '@nimiplatform/sdk/ai';
