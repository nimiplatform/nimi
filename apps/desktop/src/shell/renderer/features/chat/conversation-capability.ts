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
  NimiRuntimeRouteBinding,
  NimiRuntimeRouteDescribeResult,
  NimiRuntimeRouteHealthResult,
} from '@nimiplatform/sdk/runtime';
import {
  NIMI_RUNTIME_ROUTE_APP_CAPABILITIES,
  buildNimiRuntimeRouteCapabilityProjection,
  buildNimiRuntimeRouteCapabilityProjectionMap,
  createDefaultNimiRuntimeRouteCapabilitySelectionStore,
  toNimiRuntimeRouteCanonicalCapability,
  updateNimiRuntimeRouteCapabilityBinding,
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
  selectedBinding: NimiRuntimeRouteBinding | null;
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

let conversationCapabilityRouteRuntime: ConversationCapabilityRouteRuntime | null = null;

export function createDefaultConversationCapabilitySelectionStore(): ConversationCapabilitySelectionStore {
  return createDefaultNimiRuntimeRouteCapabilitySelectionStore();
}

export function updateConversationCapabilityBinding(
  state: ConversationCapabilitySelectionStore,
  capability: ConversationCapability,
  binding: NimiRuntimeRouteBinding | null | undefined,
  ): ConversationCapabilitySelectionStore {
  return updateNimiRuntimeRouteCapabilityBinding(state,
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
  return buildNimiRuntimeRouteCapabilityProjection({
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
  return buildNimiRuntimeRouteCapabilityProjectionMap({
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
  selectedTargetRef?: NimiAIConfigTargetRef | null;
  agentResolution?: AgentEffectiveCapabilityResolution | null;
}): ConversationExecutionSnapshot {
  return {
    executionId: createNimiAISnapshotExecutionId(),
  createdAt: new Date().toISOString(),
  capability: input.capability,
  selectedBinding: input.projection.selectedBinding,
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
  for (const [capability, binding] of Object.entries(store.selectedBindings)) {
    if (binding === null || binding === undefined) {
      continue;
    }
    const targetRef = targetRefFromRuntimeRouteBinding(binding);
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
  const selectedBindings: ConversationCapabilitySelectionStore['selectedBindings'] = {};
  for (const capability of CONVERSATION_CAPABILITIES) {
    if (!Object.prototype.hasOwnProperty.call(config.capabilities.targetRefs, capability)) {
      continue;
    }
    const targetRef = config.capabilities.targetRefs[capability];
    if (!targetRef) {
      selectedBindings[capability] = null;
      continue;
    }
    const binding = runtimeRouteBindingFromTargetRef(targetRef);
    selectedBindings[capability] = binding;
  }
  return {
    version: createDefaultConversationCapabilitySelectionStore().version,
    selectedBindings,
  };
}

function targetRefFromRuntimeRouteBinding(binding: NimiRuntimeRouteBinding): NimiAIConfigTargetRef | null {
  const source = String(binding.source || '').trim();
  const connectorId = String(binding.connectorId || '').trim();
  const model = String(binding.model || binding.modelId || binding.localModelId || '').trim();
  if (source === 'cloud') {
    if (!connectorId || !model) {
      return null;
    }
    const targetRef: NimiAIConfigTargetRef = {
      kind: 'cloud-connector',
      connectorId,
      providerModelId: model,
      ...(binding.provider ? { provider: binding.provider } : {}),
    };
    return validateNimiAIConfigTargetRef(targetRef, 'targetRef').length === 0 ? targetRef : null;
  }

  if (source === 'local') {
    const targetId = connectorId || binding.localModelId || binding.goRuntimeLocalModelId || binding.engine || '';
    const profileId = binding.localModelId || binding.goRuntimeLocalModelId || binding.modelId || model;
    const readinessRef = [
      'runtime-route',
      source,
      targetId || 'local-runtime',
      profileId || model,
    ].filter(Boolean).join(':');
    const targetRef: NimiAIConfigTargetRef = {
      kind: 'local-runtime',
      ...(targetId ? { targetId } : {}),
      ...(profileId ? { profileId } : {}),
      readinessRef,
    };
    return validateNimiAIConfigTargetRef(targetRef, 'targetRef').length === 0 ? targetRef : null;
  }

  return null;
}

function runtimeRouteBindingFromTargetRef(targetRef: NimiAIConfigTargetRef): NimiRuntimeRouteBinding | null {
  if (validateNimiAIConfigTargetRef(targetRef, 'targetRef').length > 0) {
    return null;
  }
  if (targetRef.kind === 'cloud-connector') {
    return {
      source: 'cloud',
      connectorId: targetRef.connectorId,
      model: targetRef.providerModelId,
      provider: targetRef.provider,
    };
  }
  if (targetRef.kind === 'local-runtime') {
    const targetId = targetRef.targetId || targetRef.readinessRef || 'local-runtime';
    const profileId = targetRef.profileId || targetRef.readinessRef || targetId;
    return {
      source: 'local',
      connectorId: targetId,
      model: profileId,
      localModelId: targetRef.profileId,
    };
  }
  return null;
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
}): NimiAISnapshot {
  const capabilitySlice = createConversationExecutionSnapshot({
    capability: input.capability,
  projection: input.projection,
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
