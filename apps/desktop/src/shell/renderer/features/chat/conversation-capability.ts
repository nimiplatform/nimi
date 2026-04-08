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
import { ulid } from 'ulid';
import type {
  ModRuntimeResolvedBinding,
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteDescribeResult,
  RuntimeRouteHealthResult,
} from '@nimiplatform/sdk/mod';
import type {
  AIConfig,
  AIConversationExecutionSlice,
  AIRuntimeEvidence,
  AIScopeRef,
  AISnapshot,
} from '@nimiplatform/sdk/mod';
import { createDefaultAIScopeRef } from '@nimiplatform/sdk/mod';

export const CONVERSATION_CAPABILITIES = [
  'text.generate',
  'image.generate',
  'image.edit',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.tts_v2v',
  'voice_workflow.tts_t2v',
] as const;

export type ConversationCapability = (typeof CONVERSATION_CAPABILITIES)[number];

const CONVERSATION_CAPABILITY_RUNTIME_MAP: Partial<Record<ConversationCapability, RuntimeCanonicalCapability>> = {
  'image.edit': 'image.generate',
};

export function toRuntimeCanonicalCapability(capability: ConversationCapability): RuntimeCanonicalCapability {
  return (CONVERSATION_CAPABILITY_RUNTIME_MAP[capability] || capability) as RuntimeCanonicalCapability;
}
export type RuntimeLocalProfileRef = {
  modId: string;
  profileId: string;
};

export type ConversationCapabilitySelectionStore = {
  version: number;
  selectedBindings: Partial<Record<ConversationCapability, RuntimeRouteBinding | null>>;
};

export type ConversationCapabilityProjectionReasonCode =
  | 'selection_missing'
  | 'selection_cleared'
  | 'binding_unresolved'
  | 'route_unhealthy'
  | 'metadata_missing'
  | 'capability_unsupported'
  | 'host_denied';

export type ConversationCapabilityProjection = {
  capability: ConversationCapability;
  selectedBinding: RuntimeRouteBinding | null;
  resolvedBinding: ModRuntimeResolvedBinding | null;
  health: RuntimeRouteHealthResult | null;
  metadata: RuntimeRouteDescribeResult | null;
  supported: boolean;
  reasonCode: ConversationCapabilityProjectionReasonCode | null;
};

export type AgentEffectiveCapabilityResolution = {
  ready: boolean;
  textProjection: ConversationCapabilityProjection | null;
  imageProjection: ConversationCapabilityProjection | null;
  imageReady: boolean;
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
  resolvedBinding: ModRuntimeResolvedBinding | null;
  health: RuntimeRouteHealthResult | null;
  metadata: RuntimeRouteDescribeResult | null;
  agentResolution: AgentEffectiveCapabilityResolution | null;
};

export type ConversationCapabilityProjectionMap = Partial<Record<ConversationCapability, ConversationCapabilityProjection>>;

export type ConversationCapabilityRouteRuntime = {
  resolve(input: {
    capability: ConversationCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<ModRuntimeResolvedBinding>;
  checkHealth(input: {
    capability: ConversationCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<RuntimeRouteHealthResult>;
  describe(input: {
    capability: ConversationCapability;
    resolvedBindingRef: string;
  }): Promise<RuntimeRouteDescribeResult>;
};

type BuildConversationCapabilityProjectionInput = {
  capability: ConversationCapability;
  selectionStore: ConversationCapabilitySelectionStore;
  routeRuntime?: ConversationCapabilityRouteRuntime | null;
  hostAllowed?: boolean;
  requiresDescribeMetadata?: boolean;
};

const CONVERSATION_CAPABILITY_SELECTION_STORE_VERSION = 1;

let conversationCapabilityRouteRuntime: ConversationCapabilityRouteRuntime | null = null;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function createProjection(
  capability: ConversationCapability,
  overrides: Partial<ConversationCapabilityProjection>,
): ConversationCapabilityProjection {
  return {
    capability,
    selectedBinding: null,
    resolvedBinding: null,
    health: null,
    metadata: null,
    supported: false,
    reasonCode: null,
    ...overrides,
  };
}

function reasonCodeFromError(error: unknown): ConversationCapabilityProjectionReasonCode | null {
  const record = asRecord(error);
  const reasonCode = normalizeText(record.reasonCode) || normalizeText((error as Error | null | undefined)?.message);
  const normalized = reasonCode.toUpperCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes('HOOK_PERMISSION_DENIED')
    || normalized.includes('ACTION_PERMISSION_DENIED')
    || normalized.includes('SANDBOX_CAPABILITY_DENIED')
  ) {
    return 'host_denied';
  }
  if (
    normalized.includes('AI_ROUTE_UNSUPPORTED')
    || normalized.includes('CAPABILITY_MISSING')
    || normalized.includes('UNSUPPORTED')
  ) {
    return 'capability_unsupported';
  }
  return null;
}

function isProjectionHealthHealthy(health: RuntimeRouteHealthResult | null): boolean {
  if (!health) {
    return false;
  }
  const status = normalizeText(health.status).toLowerCase();
  if (status === 'unavailable' || status === 'unhealthy') {
    return false;
  }
  return health.healthy !== false;
}


export function createDefaultConversationCapabilitySelectionStore(): ConversationCapabilitySelectionStore {
  return {
    version: CONVERSATION_CAPABILITY_SELECTION_STORE_VERSION,
    selectedBindings: {},
  };
}

export function updateConversationCapabilityBinding(
  state: ConversationCapabilitySelectionStore,
  capability: ConversationCapability,
  binding: RuntimeRouteBinding | null | undefined,
): ConversationCapabilitySelectionStore {
  const next: ConversationCapabilitySelectionStore = {
    version: CONVERSATION_CAPABILITY_SELECTION_STORE_VERSION,
    selectedBindings: { ...state.selectedBindings },
  };
  if (binding === undefined) {
    delete next.selectedBindings[capability];
  } else {
    next.selectedBindings[capability] = binding;
  }
  return next;
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
  const routeRuntime = input.routeRuntime || conversationCapabilityRouteRuntime;
  const hostAllowed = input.hostAllowed !== false;
  if (!hostAllowed) {
    return createProjection(input.capability, { reasonCode: 'host_denied' });
  }

  const selectedBindings = input.selectionStore.selectedBindings;
  const hasSelection = hasOwn(selectedBindings, input.capability);
  if (!hasSelection) {
    return createProjection(input.capability, { reasonCode: 'selection_missing' });
  }

  const selectedBinding = selectedBindings[input.capability];
  if (selectedBinding === null) {
    return createProjection(input.capability, {
      selectedBinding: null,
      reasonCode: 'selection_cleared',
    });
  }

  if (!selectedBinding) {
    return createProjection(input.capability, { reasonCode: 'binding_unresolved' });
  }

  if (!routeRuntime) {
    return createProjection(input.capability, {
      selectedBinding,
      reasonCode: 'binding_unresolved',
    });
  }

  let resolvedBinding: ModRuntimeResolvedBinding;
  try {
    resolvedBinding = await routeRuntime.resolve({
      capability: input.capability,
      binding: selectedBinding,
    });
  } catch (error) {
    const mappedReasonCode = reasonCodeFromError(error);
    return createProjection(input.capability, {
      selectedBinding,
      reasonCode: mappedReasonCode || 'binding_unresolved',
    });
  }
  if (!resolvedBinding?.resolvedBindingRef) {
    return createProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      reasonCode: 'binding_unresolved',
    });
  }

  let health: RuntimeRouteHealthResult;
  try {
    health = await routeRuntime.checkHealth({
      capability: input.capability,
      binding: selectedBinding,
    });
  } catch (error) {
    const mappedReasonCode = reasonCodeFromError(error);
    return createProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      reasonCode: mappedReasonCode || 'route_unhealthy',
    });
  }
  if (!isProjectionHealthHealthy(health)) {
    return createProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      reasonCode: 'route_unhealthy',
    });
  }

  if (input.requiresDescribeMetadata !== false) {
    let metadata: RuntimeRouteDescribeResult;
    try {
      metadata = await routeRuntime.describe({
        capability: input.capability,
        resolvedBindingRef: resolvedBinding.resolvedBindingRef,
      });
    } catch (error) {
      const mappedReasonCode = reasonCodeFromError(error);
      return createProjection(input.capability, {
        selectedBinding,
        resolvedBinding,
        health,
        reasonCode: mappedReasonCode || 'metadata_missing',
      });
    }
    const expectedMetadataCapability = toRuntimeCanonicalCapability(input.capability);
    if (!metadata || metadata.capability !== expectedMetadataCapability || metadata.metadataKind !== expectedMetadataCapability) {
      return createProjection(input.capability, {
        selectedBinding,
        resolvedBinding,
        health,
        reasonCode: 'metadata_missing',
      });
    }

    return createProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      metadata,
      supported: true,
      reasonCode: null,
    });
  }

  return createProjection(input.capability, {
    selectedBinding,
    resolvedBinding,
    health,
    metadata: null,
    supported: true,
    reasonCode: null,
  });
}

const CAPABILITIES_WITH_DESCRIBE_METADATA: ReadonlySet<ConversationCapability> = new Set([
  'text.generate',
  'voice_workflow.tts_v2v',
  'voice_workflow.tts_t2v',
]);

export async function buildConversationCapabilityProjectionMap(input: {
  selectionStore: ConversationCapabilitySelectionStore;
  routeRuntime?: ConversationCapabilityRouteRuntime | null;
  hostAllowlist?: Partial<Record<ConversationCapability, boolean>>;
  capabilities?: readonly ConversationCapability[];
}): Promise<ConversationCapabilityProjectionMap> {
  const capabilities = input.capabilities || CONVERSATION_CAPABILITIES;
  const entries = await Promise.all(capabilities.map(async (capability) => {
    const projection = await buildConversationCapabilityProjection({
      capability,
      selectionStore: input.selectionStore,
      routeRuntime: input.routeRuntime,
      hostAllowed: input.hostAllowlist?.[capability] !== false,
      requiresDescribeMetadata: CAPABILITIES_WITH_DESCRIBE_METADATA.has(capability),
    });
    return [capability, projection] as const;
  }));
  return Object.fromEntries(entries) as ConversationCapabilityProjectionMap;
}

export function buildAgentEffectiveCapabilityResolution(input: {
  textProjection: ConversationCapabilityProjection | null;
  imageProjection?: ConversationCapabilityProjection | null;
}): AgentEffectiveCapabilityResolution {
  const textProjection = input.textProjection || null;
  const imageProjection = input.imageProjection || null;
  const imageReady = Boolean(imageProjection?.supported && imageProjection?.resolvedBinding);
  if (!textProjection || !textProjection.supported) {
    return {
      ready: false,
      textProjection,
      imageProjection,
      imageReady,
      reason: 'projection_unavailable',
    };
  }

  if (!textProjection.resolvedBinding) {
    return {
      ready: false,
      textProjection,
      imageProjection,
      imageReady,
      reason: 'route_unresolved',
    };
  }

  return {
    ready: true,
    textProjection,
    imageProjection,
    imageReady,
    reason: 'ok',
  };
}

export function createConversationExecutionSnapshot(input: {
  capability: ConversationCapability;
  projection: ConversationCapabilityProjection;
  agentResolution?: AgentEffectiveCapabilityResolution | null;
}): ConversationExecutionSnapshot {
  return {
    executionId: ulid(),
    createdAt: new Date().toISOString(),
    capability: input.capability,
    selectedBinding: input.projection.selectedBinding,
    resolvedBinding: input.projection.resolvedBinding,
    health: input.projection.health,
    metadata: input.projection.metadata,
    agentResolution: input.agentResolution || null,
  };
}

export function toRuntimeRouteBindingFromPickerSelection(input: {
  capability: ConversationCapability;
  selection: {
    source: 'local' | 'cloud';
    connectorId: string;
    model: string;
    modelLabel?: string;
    localModelId?: string;
    engine?: string;
    modelId?: string;
  };
  provider?: string | null;
}): RuntimeRouteBinding | null {
  const model = normalizeText(input.selection.model);
  if (!model) {
    return null;
  }
  const modelLabel = normalizeText(input.selection.modelLabel) || undefined;
  if (input.selection.source === 'local') {
    const localModelId = normalizeText(input.selection.localModelId) || model;
    const engine = normalizeText(input.selection.engine) || undefined;
    return {
      source: 'local',
      connectorId: '',
      model,
      modelLabel,
      localModelId,
      engine,
      provider: engine || undefined,
      goRuntimeLocalModelId: localModelId,
    };
  }
  const connectorId = normalizeText(input.selection.connectorId);
  if (!connectorId) {
    return null;
  }
  return {
    source: 'cloud',
    connectorId,
    model,
    modelLabel,
    provider: normalizeText(input.provider) || undefined,
  };
}

// ---------------------------------------------------------------------------
// AIConfig <-> ConversationCapabilitySelectionStore bridge  (D-AIPC-010)
// ---------------------------------------------------------------------------

export function aiConfigFromSelectionStore(
  store: ConversationCapabilitySelectionStore,
  scopeRef?: AIScopeRef,
): AIConfig {
  return {
    scopeRef: scopeRef || createDefaultAIScopeRef(),
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
    version: CONVERSATION_CAPABILITY_SELECTION_STORE_VERSION,
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
  const slice: AIConversationExecutionSlice = {
    executionId: capabilitySlice.executionId,
    createdAt: capabilitySlice.createdAt,
    capability: capabilitySlice.capability,
    selectedBinding: capabilitySlice.selectedBinding,
    resolvedBinding: capabilitySlice.resolvedBinding,
    health: capabilitySlice.health,
    metadata: capabilitySlice.metadata,
    agentResolution: capabilitySlice.agentResolution,
  };
  return {
    executionId: capabilitySlice.executionId,
    scopeRef: input.scopeRef || input.config.scopeRef,
    configEvidence: {
      profileOrigin: input.config.profileOrigin,
      capabilityBindingKeys: Object.keys(input.config.capabilities.selectedBindings),
    },
    conversationCapabilitySlice: slice,
    runtimeEvidence: input.runtimeEvidence || null,
    createdAt: capabilitySlice.createdAt,
  };
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
} from '@nimiplatform/sdk/mod';
export { applyAIProfileToConfig, createDefaultAIScopeRef, createEmptyAIConfig } from '@nimiplatform/sdk/mod';

export function toConversationCapabilityRouteProjectionFields(
  projection: ConversationCapabilityProjection | null | undefined,
): {
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
} {
  const resolved = projection?.resolvedBinding || null;
  if (!resolved) {
    return {
      provider: '',
      runtimeModelType: 'chat',
      localProviderEndpoint: '',
      localProviderModel: '',
      localOpenAiEndpoint: '',
      connectorId: '',
    };
  }
  if (resolved.source === 'local') {
    return {
      provider: normalizeText(resolved.provider) || normalizeText(resolved.engine),
      runtimeModelType: 'chat',
      localProviderEndpoint: normalizeText(resolved.localProviderEndpoint) || normalizeText(resolved.endpoint),
      localProviderModel: normalizeText(resolved.localModelId)
        || normalizeText(resolved.modelId)
        || normalizeText(resolved.model),
      localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint) || normalizeText(resolved.endpoint),
      connectorId: '',
    };
  }
  return {
    provider: normalizeText(resolved.provider),
    runtimeModelType: 'chat',
    localProviderEndpoint: '',
    localProviderModel: normalizeText(resolved.modelId) || normalizeText(resolved.model),
    localOpenAiEndpoint: '',
    connectorId: normalizeText(resolved.connectorId),
  };
}
