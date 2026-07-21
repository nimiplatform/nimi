/**
 * Conversation capability submodel (D-AIPC-010).
 *
 * This module defines the conversation-capability domain types, projection
 * builder, and execution snapshot factory. These are **submodels** of the
 * NimiAIConfig / NimiAISnapshot umbrella authority (D-AIPC-001). They are NOT
 * independent product-level owners.
 *
 * Primary authority chain:
 *   NimiAIConfig (live truth) -> compact capabilities.targetRefs
 *   NimiAISnapshot (execution truth) -> conversationCapabilitySlice (snapshot submodel)
 *
 * UI and adapter code should write config through the AIConfigSDKSurface
 * (desktop-ai-config-service.ts), not through these helpers directly.
 * The projection builder and snapshot factory are consumed by the surface
 * and by bootstrap/effects code, not by product-facing UI components.
 */
import type {
  NimiAIConfig,
  NimiAIConfigEvidence,
  NimiAIConfigTargetRef,
  NimiAIConversationExecutionSlice,
  NimiAIProfile,
  NimiAIProfileCapabilityIntent,
  NimiAIProfileOriginRef,
  NimiAIRuntimeEvidence,
  NimiAISchedulingJudgement,
  NimiAISchedulingOccupancy,
  NimiAISchedulingState,
  NimiAIScopeKind,
  NimiAIScopeRef,
  NimiAISnapshot,
} from '@nimiplatform/sdk/ai';
import {
  createEmptyNimiAIConfig,
  createNimiAISnapshotExecutionId,
  createNimiAISnapshotRecord,
  validateNimiAIConfigTargetRef,
} from '@nimiplatform/sdk/ai';
import type {
  NimiRuntimeResolvedBinding,
  NimiRuntimeRouteDescribeResult,
  NimiRuntimeRouteHealthResult,
  NimiRuntimeRouteTargetRef,
} from '@nimiplatform/sdk/runtime';
import {
  NIMI_RUNTIME_ROUTE_APP_CAPABILITIES,
  buildNimiRuntimeRouteCapabilityProjection,
  buildNimiRuntimeRouteCapabilityProjectionMap,
  createDefaultNimiRuntimeRouteCapabilitySelectionStore,
  toNimiRuntimeRouteCanonicalCapability,
  updateNimiRuntimeRouteCapabilityTargetRef,
  type NimiRuntimeRouteAppCapability,
  type NimiRuntimeRouteCapabilityProjection,
  type NimiRuntimeRouteCapabilityProjectionInput,
  type NimiRuntimeRouteCapabilityProjectionMap,
  type NimiRuntimeRouteCapabilityProjectionReasonCode,
  type NimiRuntimeRouteCapabilityRuntime,
  type NimiRuntimeRouteCapabilitySelectionStore,
} from '@nimiplatform/sdk/runtime';

export const CONVERSATION_CAPABILITIES = NIMI_RUNTIME_ROUTE_APP_CAPABILITIES;

export type ConversationCapability = NimiRuntimeRouteAppCapability;
export const AGENT_VOICE_WORKFLOW_CAPABILITIES = [
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
] as const;
export type AgentVoiceWorkflowCapability = (typeof AGENT_VOICE_WORKFLOW_CAPABILITIES)[number];
export type AgentVoiceWorkflowType = 'voice_clone' | 'voice_design';

export const toRuntimeCanonicalCapability = toNimiRuntimeRouteCanonicalCapability;

export type ConversationCapabilitySelectionStore = NimiRuntimeRouteCapabilitySelectionStore;
export type NimiAIConfigCapabilities = NimiAIConfig['capabilities'];

export type ConversationCapabilityProjectionReasonCode = NimiRuntimeRouteCapabilityProjectionReasonCode;

export type ConversationCapabilityProjection = NimiRuntimeRouteCapabilityProjection;

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
  selectedTargetRef: NimiAIConfigTargetRef | null;
  resolvedBinding: NimiRuntimeResolvedBinding | null;
  health: NimiRuntimeRouteHealthResult | null;
  metadata: NimiRuntimeRouteDescribeResult | null;
  agentResolution: AgentEffectiveCapabilityResolution | null;
};

export type ConversationCapabilityProjectionMap = NimiRuntimeRouteCapabilityProjectionMap;

export type ConversationCapabilityRouteRuntime = NimiRuntimeRouteCapabilityRuntime;

type BuildConversationCapabilityProjectionInput = Omit<NimiRuntimeRouteCapabilityProjectionInput,
  'capability'> & {
  capability: ConversationCapability;
};

export function createDefaultConversationCapabilitySelectionStore(): ConversationCapabilitySelectionStore {
  return createDefaultNimiRuntimeRouteCapabilitySelectionStore();
}

export function updateConversationCapabilityTargetRef(
  state: ConversationCapabilitySelectionStore,
  capability: ConversationCapability,
  targetRef: NimiAIConfigTargetRef | null | undefined,
  ): ConversationCapabilitySelectionStore {
  return updateNimiRuntimeRouteCapabilityTargetRef(state,
  capability,
  routeTargetRefFromAIConfigTargetRef(targetRef));
}

export async function buildConversationCapabilityProjection(
  input: BuildConversationCapabilityProjectionInput,
  ): Promise<ConversationCapabilityProjection> {
  return buildNimiRuntimeRouteCapabilityProjection({
    ...input,
  routeRuntime: input.routeRuntime || null,
  });
}

export async function buildConversationCapabilityProjectionMap(input: {
  selectionStore: ConversationCapabilitySelectionStore;
  routeRuntime?: ConversationCapabilityRouteRuntime | null;
  hostAllowlist?: Partial<Record<ConversationCapability,
  boolean>>;
  capabilities?: readonly ConversationCapability[];
}): Promise<ConversationCapabilityProjectionMap> {
  return buildNimiRuntimeRouteCapabilityProjectionMap({
    ...input,
  routeRuntime: input.routeRuntime || null,
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

export function resolveAgentImageProjectionForExecution(
  resolution: AgentEffectiveCapabilityResolution,
): ConversationCapabilityProjection | null {
  const projection = resolution.imageProjection || null;
  if (!resolution.imageReady || !projection?.supported || !projection.resolvedBinding) {
    return null;
  }
  return projection;
}

export function createConversationExecutionSnapshot(input: {
  capability: ConversationCapability;
  projection: ConversationCapabilityProjection;
  selectedTargetRef?: NimiAIConfigTargetRef | null;
  agentResolution?: AgentEffectiveCapabilityResolution | null;
  createdAtMs: number;
}): ConversationExecutionSnapshot {
  return {
    executionId: createNimiAISnapshotExecutionId(),
  createdAt: new Date(input.createdAtMs).toISOString(),
  capability: input.capability,
  selectedTargetRef: input.selectedTargetRef || null,
  resolvedBinding: input.projection.resolvedBinding,
  health: input.projection.health,
  metadata: input.projection.metadata,
  agentResolution: input.agentResolution || null,
  };
}


// ---------------------------------------------------------------------------
// NimiAIConfig <-> ConversationCapabilitySelectionStore bridge  (D-AIPC-010)
// ---------------------------------------------------------------------------

export function aiConfigFromSelectionStore(
  store: ConversationCapabilitySelectionStore,
  scopeRef: NimiAIScopeRef,
  ): NimiAIConfig {
  const targetRefs: Record<string, NimiAIConfigTargetRef> = {};
  for (const [capability, routeTargetRef] of Object.entries(store.targetRefs)) {
    if (routeTargetRef === null || routeTargetRef === undefined) {
      continue;
    }
    const targetRef = aiConfigTargetRefFromRouteTargetRef(routeTargetRef);
    if (targetRef) {
      targetRefs[capability] = targetRef;
    }
  }
  return {
    ...createEmptyNimiAIConfig(scopeRef),
    capabilities: {
      targetRefs,
      selectedParams: {},
    },
  };
}

export function selectionStoreFromAIConfig(config: NimiAIConfig): ConversationCapabilitySelectionStore {
  const targetRefs: ConversationCapabilitySelectionStore['targetRefs'] = {};
  for (const capability of CONVERSATION_CAPABILITIES) {
    if (!Object.prototype.hasOwnProperty.call(config.capabilities.targetRefs, capability)) {
      continue;
    }
    const targetRef = config.capabilities.targetRefs[capability];
    if (!targetRef) {
      targetRefs[capability] = null;
      continue;
    }
    targetRefs[capability] = routeTargetRefFromAIConfigTargetRef(targetRef);
  }
  return {
    version: createDefaultConversationCapabilitySelectionStore().version,
    targetRefs,
  };
}

export function routeTargetRefFromAIConfigTargetRef(targetRef: NimiAIConfigTargetRef | null | undefined): NimiRuntimeRouteTargetRef | null {
  if (!targetRef || validateNimiAIConfigTargetRef(targetRef, 'targetRef').length > 0) {
    return null;
  }
  if (targetRef.kind === 'cloud-connector') {
    if (!targetRef.connectorId || !targetRef.remoteModelCatalogId || !targetRef.providerModelId) {
      return null;
    }
    return {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: targetRef.connectorId,
      remoteModelCatalogId: targetRef.remoteModelCatalogId,
      providerModelId: targetRef.providerModelId,
      provider: targetRef.provider,
    };
  }
  if (targetRef.kind === 'local-runtime') {
    const profileBindingId = targetRef.profileBindingId;
    const readinessRef = targetRef.readinessRef;
    return profileBindingId
      ? { kind: 'local-runtime', version: 'v2', profileBindingId }
      : readinessRef
        ? { kind: 'local-runtime', version: 'v2', readinessRef }
        : null;
  }
  return null;
}

export function aiConfigTargetRefFromRouteTargetRef(targetRef: NimiRuntimeRouteTargetRef | null | undefined): NimiAIConfigTargetRef | null {
  if (!targetRef) {
    return null;
  }
  const aiTargetRef: NimiAIConfigTargetRef | null = targetRef.kind === 'cloud-connector'
    ? {
        kind: 'cloud-connector',
        connectorId: targetRef.connectorId,
        remoteModelCatalogId: targetRef.remoteModelCatalogId,
        providerModelId: targetRef.providerModelId,
        ...(targetRef.provider ? { provider: targetRef.provider } : {}),
      }
    : targetRef.profileBindingId
      ? { kind: 'local-runtime', version: 'v2', profileBindingId: targetRef.profileBindingId }
      : targetRef.readinessRef
        ? { kind: 'local-runtime', version: 'v2', readinessRef: targetRef.readinessRef }
        : null;
  return aiTargetRef && validateNimiAIConfigTargetRef(aiTargetRef, 'targetRef').length === 0 ? aiTargetRef : null;
}

// ---------------------------------------------------------------------------
// NimiAISnapshot factory  (D-AIPC-004)
// ---------------------------------------------------------------------------

export function createNimiConversationAISnapshot(input: {
  scopeRef?: NimiAIScopeRef;
  config: NimiAIConfig;
  capability: ConversationCapability;
  projection: ConversationCapabilityProjection;
  agentResolution?: AgentEffectiveCapabilityResolution | null;
  runtimeEvidence?: NimiAIRuntimeEvidence | null;
  createdAtMs: number;
}): NimiAISnapshot {
  const capabilitySlice = createConversationExecutionSnapshot({
    capability: input.capability,
  projection: input.projection,
  createdAtMs: input.createdAtMs,
  selectedTargetRef: input.config.capabilities.targetRefs[input.capability] || null,
  agentResolution: input.agentResolution,
  });
  return createNimiAISnapshotRecord({
    scopeRef: input.scopeRef || input.config.scopeRef,
  config: input.config,
  capability: capabilitySlice.capability,
  selectedTargetRef: capabilitySlice.selectedTargetRef,
  resolvedTarget: capabilitySlice.resolvedBinding,
  health: capabilitySlice.health,
  metadata: capabilitySlice.metadata,
  agentResolution: capabilitySlice.agentResolution,
  runtimeEvidence: input.runtimeEvidence || null,
  executionId: capabilitySlice.executionId,
  createdAt: capabilitySlice.createdAt,
  });
}

export type ConversationAIConfig = NimiAIConfig;
export type {
  NimiAIConfig,
  NimiAIConfigEvidence,
  NimiAIConfigTargetRef,
  NimiAIConversationExecutionSlice,
  NimiAIProfile,
  NimiAIProfileCapabilityIntent,
  NimiAIProfileOriginRef,
  NimiAIRuntimeEvidence,
  NimiAISchedulingJudgement,
  NimiAISchedulingOccupancy,
  NimiAISchedulingState,
  NimiAIScopeKind,
  NimiAIScopeRef,
  NimiAISnapshot,
};
