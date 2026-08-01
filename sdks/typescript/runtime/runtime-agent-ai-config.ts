import {
  RuntimeAgentAIConfigReadinessState,
  RuntimeAgentAIProfileApplyOutcome,
  RoutePolicy,
  type ApplyRuntimeAgentAIProfileRequest,
  type ApplyRuntimeAgentAIProfileResponse,
  type RuntimeAgentAIConfigReadinessSnapshot,
  type GetRuntimeAgentAIConfigRequest,
  type GetRuntimeAgentAIConfigResponse,
  type GetRuntimeAgentAIConfigReadinessRequest,
  type GetRuntimeAgentAIConfigReadinessResponse,
  type RuntimeAgentAIConfigIntent,
  type RuntimeAgentAIConfigComponentSelection,
  type RuntimeAgentAIConfigCapabilityReadiness,
  type RuntimeAgentAIConfig,
  type RuntimeAgentAIProfileOrigin,
  type RuntimeDurableTargetRef,
  type RuntimeTypedCallOptions,
  type PreviewRuntimeAgentAIProfileRequest,
  type PreviewRuntimeAgentAIProfileResponse,
  type SubscribeRuntimeAgentAIConfigReadinessRequest,
  type UpsertRuntimeAgentAIConfigRequest,
  type UpsertRuntimeAgentAIConfigResponse,
} from '../core-generated/runtime-typed-client';
import type { AgentRequestContext } from '../core-generated/runtime-protobuf/runtime/v1/agent_common';
import {
  areNimiAIScopeRefsEqual,
  diffNimiAIConfigs,
  formNimiRuntimeProfileDescriptor,
  projectNimiRuntimeLocalAgentAIScopeRef,
  serializeNimiRuntimeProfileDescriptor,
  toRuntimeDurableTargetRef,
  validateNimiAIConfig,
  validateNimiAIProfile,
  versionNimiAIProfile,
  type NimiAICapabilityRequirementDeclaration,
  type NimiAIConfig,
  type NimiAIConfigApplyOutcome,
  type NimiAIConfigComponentSelection,
  type NimiAIConfigSetupProjection,
  type NimiAIProfile,
  type NimiAIProfileApplyResult,
  type NimiAIProfileOriginRef,
  type NimiAIProfilePreviewResult,
  } from '../core/ai';
import type { NimiJsonObject } from '../core/contracts';
import { createNimiError } from '../types';
import {
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import type { NimiRuntimeRouteTargetRef } from './route-options';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import {
  fromNimiRuntimeProtoStruct,
  normalizeNimiRuntimeAgentText,
  toNimiRuntimeIsoFromTimestamp,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeTimestamp,
} from './runtime-agent-values';

// K-AGCORE-144~150 app-facing projection of the runtime-owned committed
// Runtime Agent AI Config. The SDK never caches config or readiness as its own
// truth; every method is a typed pass-through over the admitted
// RuntimeAgentService RPC surface (S-RUNTIME-011 runtime.agent.ai_config.*).
const AGENT_AI_CONFIG_READ_SCOPE = 'runtime.agent.ai_config.read';
const AGENT_AI_CONFIG_WRITE_SCOPE = 'runtime.agent.ai_config.write';
const GRPC_CODE_ABORTED = 10;
const READINESS_REASON_CODES = new Set([
  '',
  'route_unhealthy',
  'connector_missing',
  'model_missing',
  'target_missing',
  'target_unavailable',
  'probe_failed',
  'embedding_profile_unavailable',
  'voice_reference_missing',
  'voice_workflow_unavailable',
  'image_route_unavailable',
  'image_configured_unverified',
]);

export type NimiRuntimeAgentAIConfigBinding = {
  readonly route: 'local' | 'cloud';
  readonly modelId: string;
  readonly connectorId?: string;
  readonly targetRef?: NimiRuntimeRouteTargetRef;
  readonly voiceReferenceRef?: string;
  readonly imagePolicyRef?: string;
  readonly selectedComponents?: readonly NimiAIConfigComponentSelection[];
  readonly selectedParams?: NimiJsonObject;
};

export type NimiRuntimeAgentAIConfigIntents =
  Readonly<Record<string, NimiRuntimeAgentAIConfigBinding>>;

export interface NimiRuntimeAgentAIConfigSnapshot {
  readonly aiConfig: NimiAIConfig;
  readonly revision: number;
  readonly intents: NimiRuntimeAgentAIConfigIntents;
  readonly updatedAt: string | null;
  readonly updatedByAppId: string;
}

export type NimiRuntimeAgentAIConfigReadinessCapabilityState =
  | 'ready'
  | 'not_configured'
  | 'unavailable'
  | 'configured_unverified';

export type NimiRuntimeAgentAIConfigReadinessReasonCode =
  | ''
  | 'route_unhealthy'
  | 'connector_missing'
  | 'model_missing'
  | 'target_missing'
  | 'target_unavailable'
  | 'probe_failed'
  | 'embedding_profile_unavailable'
  | 'voice_reference_missing'
  | 'voice_workflow_unavailable'
  | 'image_route_unavailable'
  | 'image_configured_unverified';

export interface NimiRuntimeAgentAIConfigCapabilityReadinessProjection {
  readonly capability: string;
  readonly state: NimiRuntimeAgentAIConfigReadinessCapabilityState;
  readonly reasonCode: NimiRuntimeAgentAIConfigReadinessReasonCode;
  readonly probedAt: string | null;
}

export interface NimiRuntimeAgentAIConfigReadinessSnapshotProjection {
  readonly configRevision: number;
  readonly capabilities: readonly NimiRuntimeAgentAIConfigCapabilityReadinessProjection[];
}

export interface NimiRuntimeAgentAIConfigCallInput extends RuntimeLocalAgentIdentityInput {
  readonly subjectUserId?: string;
}

export interface NimiRuntimeAgentAIConfigUpdateInput extends NimiRuntimeAgentAIConfigCallInput {
  readonly expectedRevision: number;
  readonly config: NimiAIConfig;
}

export interface NimiRuntimeAgentAIProfileSource {
  list(): Promise<readonly NimiAIProfile[]>;
  get(profileId: string): Promise<NimiAIProfile | null>;
}

export interface NimiRuntimeAgentAIProfilePreviewInput extends NimiRuntimeAgentAIConfigCallInput {
  readonly scopeRef: NimiAIConfig['scopeRef'];
  readonly profileId: string;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
}

export interface NimiRuntimeAgentAIProfileApplyInput extends NimiRuntimeAgentAIProfilePreviewInput {
  readonly expectedBaseVersion?: string;
}

export interface NimiRuntimeAgentAIConfigModule {
  get(input: NimiRuntimeAgentAIConfigCallInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  update(input: NimiRuntimeAgentAIConfigUpdateInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  readiness(input: NimiRuntimeAgentAIConfigCallInput): Promise<NimiRuntimeAgentAIConfigReadinessSnapshotProjection>;
  subscribeReadiness(
    input: NimiRuntimeAgentAIConfigCallInput,
  ): AsyncIterable<NimiRuntimeAgentAIConfigReadinessSnapshotProjection>;
  readonly aiProfile: {
    list(): Promise<readonly NimiAIProfile[]>;
    previewApply(input: NimiRuntimeAgentAIProfilePreviewInput): Promise<NimiAIProfilePreviewResult>;
    apply(input: NimiRuntimeAgentAIProfileApplyInput): Promise<NimiAIProfileApplyResult>;
  };
}

export interface NimiRuntimeAgentAIConfigAgentSurface {
  getRuntimeAgentAIConfig?(
    request: GetRuntimeAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetRuntimeAgentAIConfigResponse>;
  upsertRuntimeAgentAIConfig?(
    request: UpsertRuntimeAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<UpsertRuntimeAgentAIConfigResponse>;
  getRuntimeAgentAIConfigReadiness?(
    request: GetRuntimeAgentAIConfigReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetRuntimeAgentAIConfigReadinessResponse>;
  subscribeRuntimeAgentAIConfigReadiness?(
    request: SubscribeRuntimeAgentAIConfigReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<RuntimeAgentAIConfigReadinessSnapshot>;
  previewRuntimeAgentAIProfile?(
    request: PreviewRuntimeAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<PreviewRuntimeAgentAIProfileResponse>;
  applyRuntimeAgentAIProfile?(
    request: ApplyRuntimeAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ApplyRuntimeAgentAIProfileResponse>;
}

export interface NimiRuntimeAgentAIConfigRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: NimiRuntimeAgentAIConfigAgentSurface;
}

export interface NimiRuntimeAgentAIConfigModuleOptions {
  readonly runtime: NimiRuntimeAgentAIConfigRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
  readonly profileSource?: NimiRuntimeAgentAIProfileSource;
}

function agentAIConfigInputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_AGENT_AI_CONFIG_INPUT_INVALID',
    actionHint,
    source: 'sdk',
  });
}

function agentAIConfigResponseError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_AGENT_AI_CONFIG_RESPONSE_INVALID',
    actionHint: 'check_runtime_agent_ai_config_surface',
    source: 'runtime',
  });
}

function requireAIConfigMethod<T>(method: T | undefined, methodName: string): T {
  if (typeof method !== 'function') {
    throw createNimiError({
      message: `Runtime Agent AI Config surface is missing ${methodName}.`,
      reasonCode: 'SDK_RUNTIME_AGENT_AI_CONFIG_SURFACE_REQUIRED',
      actionHint: 'provide_runtime_agents_module',
      source: 'sdk',
    });
  }
  return method;
}

function parseAIConfigRevision(value: unknown, field: string): number {
  const revision = Number(normalizeNimiRuntimeAgentText(value));
  if (!Number.isSafeInteger(revision) || revision < 0) {
    agentAIConfigResponseError(`Runtime Agent AI Config ${field} is not a valid revision.`);
  }
  return revision;
}

function projectAIConfigRoute(routePolicy: RoutePolicy, capability: string): 'local' | 'cloud' {
  if (routePolicy === RoutePolicy.LOCAL) {
    return 'local';
  }
  if (routePolicy === RoutePolicy.CLOUD) {
    return 'cloud';
  }
  agentAIConfigResponseError(
    `Runtime Agent AI Config intent for ${capability} carries an unknown route policy (${String(routePolicy)}).`,
  );
}

function projectAIConfigTargetRef(
  targetRef: RuntimeDurableTargetRef | undefined,
  capability: string,
): NimiRuntimeRouteTargetRef | undefined {
  if (!targetRef) {
    return undefined;
  }
  const target = targetRef.target;
  if (target.oneofKind === 'localRuntime') {
    const local = target.localRuntime;
    if (normalizeNimiRuntimeAgentText(local.version) !== 'v2') {
      agentAIConfigResponseError(
        `Runtime Agent AI Config intent for ${capability} carries a non-v2 local target ref.`,
      );
    }
    if (local.ref.oneofKind === 'profileBindingId' && normalizeNimiRuntimeAgentText(local.ref.profileBindingId)) {
      return {
        kind: 'local-runtime',
        version: 'v2',
        profileBindingId: normalizeNimiRuntimeAgentText(local.ref.profileBindingId),
      };
    }
    if (local.ref.oneofKind === 'readinessRef' && normalizeNimiRuntimeAgentText(local.ref.readinessRef)) {
      return {
        kind: 'local-runtime',
        version: 'v2',
        readinessRef: normalizeNimiRuntimeAgentText(local.ref.readinessRef),
      };
    }
    agentAIConfigResponseError(
      `Runtime Agent AI Config intent for ${capability} local target ref has no local ref.`,
    );
  }
  if (target.oneofKind === 'cloud') {
    const cloud = target.cloud;
    const connectorId = normalizeNimiRuntimeAgentText(cloud.connectorId);
    const remoteModelCatalogId = normalizeNimiRuntimeAgentText(cloud.remoteModelCatalogId);
    const providerModelId = normalizeNimiRuntimeAgentText(cloud.providerModelId);
    if (normalizeNimiRuntimeAgentText(cloud.version) !== 'v2' || !connectorId || !remoteModelCatalogId || !providerModelId) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config intent for ${capability} cloud target ref is incomplete.`,
      );
    }
    const provider = normalizeNimiRuntimeAgentText(cloud.provider);
    return {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId,
      remoteModelCatalogId,
      providerModelId,
      ...(provider ? { provider } : {}),
    };
  }
  agentAIConfigResponseError(
    `Runtime Agent AI Config intent for ${capability} target ref has no admitted target kind.`,
  );
}

function projectAIConfigSnapshot(
  config: RuntimeAgentAIConfig | undefined,
): NimiRuntimeAgentAIConfigSnapshot {
  if (!config) {
    agentAIConfigResponseError('Runtime Agent AI Config response carries no committed config.');
  }
  const agentInstanceId = normalizeNimiRuntimeAgentText(config.agentInstanceId);
  if (!agentInstanceId) {
    agentAIConfigResponseError('Runtime Agent AI Config response is missing agent_instance_id.');
  }
  const intents: Record<string, NimiRuntimeAgentAIConfigBinding> = {};
  const logicalModelIds: Record<string, string> = {};
  const targetRefs: Record<string, NimiRuntimeRouteTargetRef> = {};
  const selectedComponents: Record<string, readonly NimiAIConfigComponentSelection[]> = {};
  const selectedParams: Record<string, NimiJsonObject> = {};
  for (const intent of config.intents || []) {
    const capability = normalizeNimiRuntimeAgentText(intent.capability);
    if (!capability) {
      agentAIConfigResponseError('Runtime Agent AI Config intent is missing its capability.');
    }
    if (intents[capability]) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config binds ${capability} more than once.`,
      );
    }
    const modelId = normalizeNimiRuntimeAgentText(intent.modelId);
    if (!modelId) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config intent for ${capability} is missing model_id.`,
      );
    }
    const connectorId = normalizeNimiRuntimeAgentText(intent.connectorId);
    const targetRef = projectAIConfigTargetRef(intent.targetRef, capability);
    const voiceReferenceRef = normalizeNimiRuntimeAgentText(intent.voiceReferenceRef);
    const imagePolicyRef = normalizeNimiRuntimeAgentText(intent.imagePolicyRef);
    const projectedParams = intent.selectedParams
      ? fromNimiRuntimeProtoStruct(intent.selectedParams) as unknown as NimiJsonObject
      : undefined;
    const projectedComponents = projectAIConfigComponentSelections(
      intent.selectedComponents,
      capability,
    );
    intents[capability] = {
      route: projectAIConfigRoute(intent.routePolicy, capability),
      modelId,
      ...(connectorId ? { connectorId } : {}),
      ...(voiceReferenceRef ? { voiceReferenceRef } : {}),
      ...(imagePolicyRef ? { imagePolicyRef } : {}),
      ...(targetRef ? { targetRef } : {}),
      ...(projectedComponents.length > 0 ? { selectedComponents: projectedComponents } : {}),
      ...(projectedParams ? { selectedParams: projectedParams } : {}),
    };
    if (targetRef) {
      logicalModelIds[capability] = modelId;
      targetRefs[capability] = targetRef;
      if (projectedComponents.length > 0) {
        selectedComponents[capability] = projectedComponents;
      }
      if (projectedParams) {
        selectedParams[capability] = projectedParams;
      }
    }
  }
  const profileOrigin = projectAIConfigProfileOrigin(config.profileOrigin);
  return {
    aiConfig: {
      scopeRef: projectNimiRuntimeLocalAgentAIScopeRef(agentInstanceId),
      capabilities: {
        logicalModelIds,
        targetRefs,
        selectedComponents,
        selectedParams,
      },
      profileOrigin,
    },
    revision: parseAIConfigRevision(config.revision, 'revision'),
    intents,
    updatedAt: toNimiRuntimeIsoFromTimestamp(config.updatedAt),
    updatedByAppId: normalizeNimiRuntimeAgentText(config.updatedByAppId),
  };
}

function projectAIConfigComponentSelections(
  values: readonly RuntimeAgentAIConfigComponentSelection[] | undefined,
  capability: string,
): readonly NimiAIConfigComponentSelection[] {
  const occurrenceIds = new Set<string>();
  const orders = new Set<number>();
  let priorOrder = -1;
  return (values ?? []).map((value, index) => {
    const occurrenceId = normalizeNimiRuntimeAgentText(value.occurrenceId);
    const role = normalizeNimiRuntimeAgentText(value.role);
    const componentKind = normalizeNimiRuntimeAgentText(value.componentKind);
    const logicalModelId = normalizeNimiRuntimeAgentText(value.logicalModelId);
    const order = Number(value.order);
    if (!occurrenceId || occurrenceIds.has(occurrenceId)) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config component ${index} for ${capability} has an invalid occurrence_id.`,
      );
    }
    if (!Number.isSafeInteger(order) || order < 0 || order <= priorOrder || orders.has(order)) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config component ${occurrenceId} for ${capability} has an invalid order.`,
      );
    }
    if (!role || !componentKind || !logicalModelId) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config component ${occurrenceId} for ${capability} is incomplete.`,
      );
    }
    const targetRef = projectAIConfigTargetRef(value.targetRef, `${capability}.${occurrenceId}`);
    if (!targetRef) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config component ${occurrenceId} for ${capability} is missing target_ref.`,
      );
    }
    const weight = normalizeNimiRuntimeAgentText(value.weight);
    const options = value.options
      ? fromNimiRuntimeProtoStruct(value.options) as unknown as NimiJsonObject
      : undefined;
    occurrenceIds.add(occurrenceId);
    orders.add(order);
    priorOrder = order;
    return {
      occurrenceId,
      order,
      role,
      componentKind,
      logicalModelId,
      targetRef,
      required: Boolean(value.required),
      ...(weight ? { weight } : {}),
      ...(options ? { options } : {}),
    };
  });
}

function projectAIConfigProfileOrigin(
  origin: RuntimeAgentAIProfileOrigin | undefined,
): NimiAIProfileOriginRef | null {
  if (!origin) {
    return null;
  }
  const profileId = normalizeNimiRuntimeAgentText(origin.profileId);
  const title = normalizeNimiRuntimeAgentText(origin.title);
  const appliedAt = toNimiRuntimeIsoFromTimestamp(origin.appliedAt);
  if (!profileId || !title || !appliedAt) {
    agentAIConfigResponseError('Runtime Agent AI Config profile_origin is incomplete.');
  }
  return { profileId, title, appliedAt };
}

function projectAIConfigReadinessState(
  state: RuntimeAgentAIConfigReadinessState,
  capability: string,
): NimiRuntimeAgentAIConfigReadinessCapabilityState {
  switch (state) {
    case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY:
      return 'ready';
    case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED:
      return 'not_configured';
    case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE:
      return 'unavailable';
    case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_CONFIGURED_UNVERIFIED:
      return 'configured_unverified';
    default:
      agentAIConfigResponseError(
        `Runtime Agent AI Config readiness for ${capability} carries an unknown state (${String(state)}).`,
      );
  }
}

function projectAIConfigReadinessReasonCode(
  reasonCode: unknown,
  capability: string,
): NimiRuntimeAgentAIConfigReadinessReasonCode {
  const normalized = normalizeNimiRuntimeAgentText(reasonCode);
  if (!READINESS_REASON_CODES.has(normalized)) {
    agentAIConfigResponseError(
      `Runtime Agent AI Config readiness for ${capability} carries an unknown reason code (${normalized}).`,
    );
  }
  return normalized as NimiRuntimeAgentAIConfigReadinessReasonCode;
}

function projectAIConfigCapabilityReadiness(
  readiness: RuntimeAgentAIConfigCapabilityReadiness,
): NimiRuntimeAgentAIConfigCapabilityReadinessProjection {
  const capability = normalizeNimiRuntimeAgentText(readiness.capability);
  if (!capability) {
    agentAIConfigResponseError('Runtime Agent AI Config readiness entry is missing its capability.');
  }
  return {
    capability,
    state: projectAIConfigReadinessState(readiness.state, capability),
    reasonCode: projectAIConfigReadinessReasonCode(readiness.reasonCode, capability),
    probedAt: toNimiRuntimeIsoFromTimestamp(readiness.probedAt),
  };
}

export function projectNimiRuntimeAgentAIConfigReadinessSnapshot(
  snapshot: RuntimeAgentAIConfigReadinessSnapshot | undefined,
): NimiRuntimeAgentAIConfigReadinessSnapshotProjection {
  if (!snapshot) {
    agentAIConfigResponseError('Runtime Agent AI Config readiness response carries no snapshot.');
  }
  return {
    configRevision: parseAIConfigRevision(snapshot.configRevision, 'config_revision'),
    capabilities: (snapshot.capabilities || []).map(projectAIConfigCapabilityReadiness),
  };
}

function toAIConfigIntentMessage(
  capability: string,
  binding: NimiRuntimeAgentAIConfigBinding,
): RuntimeAgentAIConfigIntent {
  const route = normalizeNimiRuntimeAgentText(binding?.route).toLowerCase();
  if (route !== 'local' && route !== 'cloud') {
    agentAIConfigInputError(
      `Runtime Agent AI Config intent for ${capability} route must be local or cloud.`,
      'select_runtime_agent_route',
    );
  }
  const modelId = normalizeNimiRuntimeAgentText(binding?.modelId);
  if (!modelId) {
    agentAIConfigInputError(
      `Runtime Agent AI Config intent for ${capability} requires modelId.`,
      'select_runtime_agent_model',
    );
  }
  if (binding.targetRef) {
    const kindMatchesRoute = (route === 'local' && binding.targetRef.kind === 'local-runtime')
      || (route === 'cloud' && binding.targetRef.kind === 'cloud-connector');
    if (!kindMatchesRoute) {
      agentAIConfigInputError(
        `Runtime Agent AI Config intent for ${capability} targetRef kind does not match route ${route}.`,
        'provide_runtime_route_target_ref',
      );
    }
  }
  const connectorId = normalizeNimiRuntimeAgentText(binding.connectorId);
  const provider = binding.targetRef?.kind === 'cloud-connector'
    ? normalizeNimiRuntimeAgentText(binding.targetRef.provider)
    : '';
  const voiceReferenceRef = normalizeNimiRuntimeAgentText(binding.voiceReferenceRef);
  const imagePolicyRef = normalizeNimiRuntimeAgentText(binding.imagePolicyRef);
  const selectedParams = binding.selectedParams;
  const selectedComponents = (binding.selectedComponents ?? []).map(
    (selection): RuntimeAgentAIConfigComponentSelection => {
      const occurrenceId = normalizeNimiRuntimeAgentText(selection.occurrenceId);
      const role = normalizeNimiRuntimeAgentText(selection.role);
      const componentKind = normalizeNimiRuntimeAgentText(selection.componentKind);
      const logicalModelId = normalizeNimiRuntimeAgentText(selection.logicalModelId);
      if (!occurrenceId || !role || !componentKind || !logicalModelId ||
          !Number.isSafeInteger(selection.order) || selection.order < 0) {
        agentAIConfigInputError(
          `Runtime Agent AI Config component for ${capability} is incomplete.`,
          'repair_runtime_agent_component_selection',
        );
      }
      if (!selection.targetRef) {
        agentAIConfigInputError(
          `Runtime Agent AI Config component ${occurrenceId} for ${capability} requires targetRef.`,
          'provide_runtime_component_target_ref',
        );
      }
      if (selection.targetRef.kind === 'profile-slice') {
        agentAIConfigInputError(
          `Runtime Agent AI Config component ${occurrenceId} for ${capability} must be materialized before commit.`,
          'prepare_runtime_agent_ai_profile',
        );
      }
      return {
        occurrenceId,
        order: selection.order,
        role,
        componentKind,
        logicalModelId,
        targetRef: toRuntimeDurableTargetRef(selection.targetRef),
        required: selection.required,
        weight: normalizeNimiRuntimeAgentText(selection.weight),
        ...(selection.options ? { options: toNimiRuntimeProtoStruct(selection.options) } : {}),
      };
    },
  );
  return {
    capability,
    modelId,
    routePolicy: route === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD,
    connectorId,
    provider,
    voiceReferenceRef,
    imagePolicyRef,
    selectedComponents,
    ...(selectedParams ? { selectedParams: toNimiRuntimeProtoStruct(selectedParams) } : {}),
    ...(binding.targetRef ? { targetRef: toRuntimeDurableTargetRef(binding.targetRef) } : {}),
  };
}

function toAIConfigProfileOriginMessage(
  origin: NimiAIProfileOriginRef | null,
): RuntimeAgentAIProfileOrigin | undefined {
  if (!origin) {
    return undefined;
  }
  const profileId = normalizeNimiRuntimeAgentText(origin.profileId);
  const title = normalizeNimiRuntimeAgentText(origin.title);
  const appliedAt = normalizeNimiRuntimeAgentText(origin.appliedAt);
  if (!profileId || !title || !appliedAt || Number.isNaN(new Date(appliedAt).getTime())) {
    agentAIConfigInputError(
      'Runtime Agent AI Config profileOrigin requires profileId, title, and a valid appliedAt timestamp.',
      'provide_runtime_agent_ai_profile_origin',
    );
  }
  return {
    profileId,
    title,
    appliedAt: toNimiRuntimeTimestamp(appliedAt),
  };
}

function selectedParamsForRuntime(
  config: NimiAIConfig,
  capability: string,
): NimiJsonObject | undefined {
  const value = config.capabilities.selectedParams[capability];
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    agentAIConfigInputError(
      `Runtime Agent AI Config selectedParams for ${capability} must be an object.`,
      'repair_runtime_agent_selected_params',
    );
  }
  return value as NimiJsonObject;
}

function targetRefsEqual(
  left: NimiRuntimeRouteTargetRef | undefined,
  right: NimiRuntimeRouteTargetRef | undefined,
): boolean {
  if (!left || !right) {
    return !left && !right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function selectedComponentsEqual(
  left: readonly NimiAIConfigComponentSelection[] | undefined,
  right: readonly NimiAIConfigComponentSelection[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

export function buildNimiRuntimeAgentAIConfigUpdateIntents(
  config: NimiAIConfig,
  current: NimiRuntimeAgentAIConfigSnapshot,
): RuntimeAgentAIConfigIntent[] {
  const validation = validateNimiAIConfig(config);
  if (!validation.valid) {
    agentAIConfigInputError(
      `Runtime Agent AI Config update input is not canonical: ${validation.issues
        .map((issue) => `${issue.code}:${issue.path}`)
        .join(', ')}`,
      'repair_runtime_agent_ai_config',
    );
  }
  const entries = Object.entries(config.capabilities.logicalModelIds || {})
    .map(([capability, modelId]) => [
      normalizeNimiRuntimeAgentText(capability),
      normalizeNimiRuntimeAgentText(modelId),
    ] as const)
    .filter(([capability]) => Boolean(capability));
  if (entries.length === 0) {
    agentAIConfigInputError(
      'Runtime Agent AI Config update requires at least one logical model binding.',
      'provide_runtime_agent_ai_config',
    );
  }
  return entries.map(([capability, modelId]) => {
    if (!modelId) {
      agentAIConfigInputError(
        `Runtime Agent AI Config logical model for ${capability} is required.`,
        'select_runtime_agent_model',
      );
    }
    const configuredTargetRef = config.capabilities.targetRefs[capability];
    if (configuredTargetRef?.kind === 'profile-slice') {
      agentAIConfigInputError(
        `Runtime Agent AI Config target for ${capability} must be materialized before commit.`,
        'prepare_runtime_agent_ai_profile',
      );
    }
    const targetRef = configuredTargetRef as NimiRuntimeRouteTargetRef | undefined;
    if (!targetRef) {
      agentAIConfigInputError(
        `Runtime Agent AI Config target for ${capability} is required.`,
        'provide_runtime_route_target_ref',
      );
    }
    const committed = current.intents[capability];
    const route = targetRef?.kind === 'local-runtime'
      ? 'local'
      : targetRef?.kind === 'cloud-connector'
        ? 'cloud'
        : committed?.route;
    if (!route) {
      agentAIConfigInputError(
        `Runtime Agent AI Config target for ${capability} is required.`,
        'provide_runtime_route_target_ref',
      );
    }
    const unchangedExecutionTarget = committed?.modelId === modelId
      && targetRefsEqual(committed.targetRef, targetRef)
      && selectedComponentsEqual(
        committed.selectedComponents,
        config.capabilities.selectedComponents[capability],
      );
    const binding: NimiRuntimeAgentAIConfigBinding = {
      route,
      modelId,
      ...(targetRef ? { targetRef } : {}),
      selectedComponents: config.capabilities.selectedComponents[capability] ?? [],
      ...(targetRef?.kind === 'cloud-connector'
        ? { connectorId: targetRef.connectorId }
        : committed?.connectorId && unchangedExecutionTarget
          ? { connectorId: committed.connectorId }
          : {}),
      ...(committed?.voiceReferenceRef && unchangedExecutionTarget
        ? { voiceReferenceRef: committed.voiceReferenceRef }
        : {}),
      ...(committed?.imagePolicyRef && unchangedExecutionTarget
        ? { imagePolicyRef: committed.imagePolicyRef }
        : {}),
      ...(selectedParamsForRuntime(config, capability)
        ? { selectedParams: selectedParamsForRuntime(config, capability) }
        : {}),
    };
    return toAIConfigIntentMessage(capability, binding);
  });
}

function normalizeExpectedRevision(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    agentAIConfigInputError(
      'Runtime Agent AI Config upsert requires a positive integer expectedRevision.',
      'read_committed_agent_ai_config_first',
    );
  }
  return String(value);
}

function isAIConfigRevisionConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as {
    readonly details?: { readonly grpcCode?: unknown };
    readonly reasonCode?: unknown;
    readonly message?: unknown;
  };
  if (Number(record.details?.grpcCode) === GRPC_CODE_ABORTED) {
    return true;
  }
  if (normalizeNimiRuntimeAgentText(record.reasonCode) === 'RUNTIME_GRPC_ABORTED') {
    return true;
  }
  return /concurrent modification/iu.test(String(record.message || ''));
}

function projectAIConfigUpsertError(error: unknown, expectedRevision: string): never {
  if (isAIConfigRevisionConflictError(error)) {
    throw createNimiError({
      message: 'Runtime Agent AI Config was modified concurrently; re-read the committed config and retry with its revision.',
      reasonCode: 'RUNTIME_AGENT_AI_CONFIG_CONCURRENT_MODIFICATION',
      actionHint: 'reload_committed_agent_ai_config_and_retry',
      source: 'runtime',
      details: {
        expectedRevision,
        cause: String((error as { readonly message?: unknown }).message || ''),
      },
    });
  }
  throw error;
}

const RUNTIME_AGENT_AI_PROFILE_BASE_VERSION_PREFIX = 'runtime-agent-revision:';

function projectRuntimeAgentAIProfileOutcome(
  outcome: RuntimeAgentAIProfileApplyOutcome,
): NimiAIConfigApplyOutcome {
  switch (outcome) {
    case RuntimeAgentAIProfileApplyOutcome.RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY:
      return 'ready_to_apply';
    case RuntimeAgentAIProfileApplyOutcome.RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG:
      return 'setup_required_no_live_config';
    case RuntimeAgentAIProfileApplyOutcome.RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_UNSUPPORTED_NO_LIVE_CONFIG:
      return 'unsupported_no_live_config';
    case RuntimeAgentAIProfileApplyOutcome.RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_INVALID_PROFILE:
      return 'invalid_profile';
    case RuntimeAgentAIProfileApplyOutcome.RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE:
      return 'stale_base';
    case RuntimeAgentAIProfileApplyOutcome.RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_FAILED:
      return 'failed';
    default:
      agentAIConfigResponseError('Runtime Agent AIProfile response carries an unknown apply outcome.');
  }
}

function normalizeRuntimeAgentAIProfileStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values || [])
    .map((value) => normalizeNimiRuntimeAgentText(value))
    .filter((value): value is string => Boolean(value)))]
    .sort();
}

function projectRuntimeAgentAIProfileSetup(
  outcome: NimiAIConfigApplyOutcome,
  response: {
    readonly blockingCapabilities?: readonly string[];
    readonly reasonCodes?: readonly string[];
    readonly actionRefs?: readonly string[];
  },
): NimiAIConfigSetupProjection | null {
  if (outcome !== 'setup_required_no_live_config' && outcome !== 'unsupported_no_live_config') {
    return null;
  }
  return {
    outcome,
    blockingCapabilities: normalizeRuntimeAgentAIProfileStrings(response.blockingCapabilities),
    reasonCodes: normalizeRuntimeAgentAIProfileStrings(response.reasonCodes),
    actionRefs: normalizeRuntimeAgentAIProfileStrings(response.actionRefs),
  };
}

function runtimeAgentAIProfileBaseVersion(revision: string | number): string {
  return `${RUNTIME_AGENT_AI_PROFILE_BASE_VERSION_PREFIX}${parseAIConfigRevision(revision, 'profile base revision')}`;
}

function parseRuntimeAgentAIProfileBaseVersion(value: unknown): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized.startsWith(RUNTIME_AGENT_AI_PROFILE_BASE_VERSION_PREFIX)) {
    agentAIConfigInputError(
      'Runtime Agent AIProfile expectedBaseVersion is not a Runtime-issued profile preview version.',
      'preview_runtime_agent_ai_profile_before_apply',
    );
  }
  return normalizeExpectedRevision(
    normalized.slice(RUNTIME_AGENT_AI_PROFILE_BASE_VERSION_PREFIX.length),
  );
}

function assertRuntimeAgentAIProfileScope(
  input: NimiRuntimeAgentAIProfilePreviewInput,
): void {
  const expectedScopeRef = projectNimiRuntimeLocalAgentAIScopeRef(
    projectRuntimeLocalAgentIdentity(input).localAgentRef,
  );
  if (!areNimiAIScopeRefsEqual(input.scopeRef, expectedScopeRef)) {
    agentAIConfigInputError(
      'Runtime Agent AIProfile scopeRef does not match the selected Local Agent.',
      'use_runtime_issued_local_agent_scope',
    );
  }
}

function runtimeAgentAIProfilePayload(
  profile: NimiAIProfile,
  requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[],
): {
  readonly profileJson: Uint8Array;
  readonly runtimeDescriptorJson: Uint8Array;
} {
  const validation = validateNimiAIProfile(profile);
  if (!validation.valid) {
    agentAIConfigInputError(
      `Runtime Agent AIProfile is invalid: ${validation.issues.map((issue) => `${issue.code}:${issue.path}`).join('; ')}`,
      'fix_ai_profile_contract',
    );
  }
  const digest = versionNimiAIProfile(profile);
  const descriptor = formNimiRuntimeProfileDescriptor({
    profile,
    requirementDeclarations,
    descriptorId: `runtime-agent-ai-profile:${profile.profileId}:${digest}`,
    sourceProfileDigest: digest,
  });
  return {
    profileJson: new TextEncoder().encode(JSON.stringify(profile)),
    runtimeDescriptorJson: serializeNimiRuntimeProfileDescriptor(descriptor),
  };
}

export function createNimiRuntimeAgentAIConfigModule(
  options: NimiRuntimeAgentAIConfigModuleOptions,
): NimiRuntimeAgentAIConfigModule {
  const runtime = options.runtime;

  const resolveSubject = async (explicit?: unknown): Promise<string> => {
    const explicitSubject = normalizeNimiRuntimeAgentText(explicit);
    if (explicitSubject) {
      return explicitSubject;
    }
    return resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent AI Config module requires authenticated subject user id.',
    );
  };

  const buildContext = (subjectUserId: string, input: RuntimeLocalAgentIdentityInput): AgentRequestContext => ({
    appId: runtime.appId,
    subjectUserId,
    ...projectRuntimeLocalAgentIdentity(input),
  });

  const withScopes = async <T>(
    subjectUserId: string,
    scopes: readonly string[],
    operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> => withNimiRuntimeAgentScopes({
    runtime,
    subjectUserId,
    withScopes: options.withScopes,
  }, scopes, operation);

  const requireProfileSource = (): NimiRuntimeAgentAIProfileSource => {
    if (!options.profileSource) {
      agentAIConfigInputError(
        'Runtime Agent AIProfile operations require a host-owned standard AIProfile source.',
        'provide_runtime_agent_ai_profile_source',
      );
    }
    return options.profileSource;
  };

  const loadCurrentSnapshot = async (
    subjectUserId: string,
    input: NimiRuntimeAgentAIConfigCallInput,
  ): Promise<NimiRuntimeAgentAIConfigSnapshot> => {
    const getRuntimeAgentAIConfig = requireAIConfigMethod(
      runtime.agent.getRuntimeAgentAIConfig,
      'getRuntimeAgentAIConfig',
    );
    const response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], (callOptions) =>
      getRuntimeAgentAIConfig({ context: buildContext(subjectUserId, input) }, callOptions));
    return projectAIConfigSnapshot(response.config);
  };

  return {
    async get(input) {
      const getRuntimeAgentAIConfig = requireAIConfigMethod(
        runtime.agent.getRuntimeAgentAIConfig,
        'getRuntimeAgentAIConfig',
      );
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], (callOptions) =>
        getRuntimeAgentAIConfig({ context: buildContext(subjectUserId, input) }, callOptions));
      return projectAIConfigSnapshot(response.config);
    },
    async update(input) {
      const upsertRuntimeAgentAIConfig = requireAIConfigMethod(
        runtime.agent.upsertRuntimeAgentAIConfig,
        'upsertRuntimeAgentAIConfig',
      );
      const expectedRevision = normalizeExpectedRevision(input.expectedRevision);
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const context = buildContext(subjectUserId, input);
      const getRuntimeAgentAIConfig = requireAIConfigMethod(
        runtime.agent.getRuntimeAgentAIConfig,
        'getRuntimeAgentAIConfig',
      );
      const currentResponse = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], (callOptions) =>
        getRuntimeAgentAIConfig({ context }, callOptions));
      const current = projectAIConfigSnapshot(currentResponse.config);
      if (String(current.revision) !== expectedRevision) {
        throw createNimiError({
          message: 'Runtime Agent AI Config was modified before the canonical update was committed.',
          reasonCode: 'RUNTIME_AGENT_AI_CONFIG_CONCURRENT_MODIFICATION',
          actionHint: 'reload_committed_agent_ai_config_and_retry',
          source: 'runtime',
          details: { expectedRevision, actualRevision: String(current.revision) },
        });
      }
      const expectedScopeRef = projectNimiRuntimeLocalAgentAIScopeRef(
        projectRuntimeLocalAgentIdentity(input).localAgentRef,
      );
      if (!areNimiAIScopeRefsEqual(input.config.scopeRef, expectedScopeRef)) {
        agentAIConfigInputError(
          'Runtime Agent AI Config scopeRef does not match the selected Local Agent.',
          'use_runtime_issued_local_agent_scope',
        );
      }
      const intents = buildNimiRuntimeAgentAIConfigUpdateIntents(input.config, current);
      const profileOrigin = toAIConfigProfileOriginMessage(input.config.profileOrigin);
      let response: UpsertRuntimeAgentAIConfigResponse;
      try {
        response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) =>
          upsertRuntimeAgentAIConfig({
            context,
            expectedRevision,
            intents,
            ...(profileOrigin ? { profileOrigin } : {}),
          }, callOptions));
      } catch (error) {
        projectAIConfigUpsertError(error, expectedRevision);
      }
      return projectAIConfigSnapshot(response.config);
    },
    aiProfile: {
      async list() {
        const profiles = await requireProfileSource().list();
        for (const profile of profiles) {
          const validation = validateNimiAIProfile(profile);
          if (!validation.valid) {
            agentAIConfigResponseError(
              `Runtime Agent AIProfile source returned invalid profile ${normalizeNimiRuntimeAgentText(profile?.profileId) || '<unknown>'}.`,
            );
          }
        }
        return [...profiles];
      },
      async previewApply(input) {
        assertRuntimeAgentAIProfileScope(input);
        const profileId = normalizeNimiRuntimeAgentText(input.profileId);
        if (!profileId) {
          agentAIConfigInputError('Runtime Agent AIProfile profileId is required.', 'select_ai_profile');
        }
        const subjectUserId = await resolveSubject(input.subjectUserId);
        const profile = await requireProfileSource().get(profileId);
        if (!profile) {
          const current = await loadCurrentSnapshot(subjectUserId, input);
          return {
            before: current.aiConfig,
            after: null,
            outcome: 'failed',
            diff: diffNimiAIConfigs(current.aiConfig, null),
            baseVersion: runtimeAgentAIProfileBaseVersion(current.revision),
            probeWarnings: [`AI profile not found: ${profileId}`],
          };
        }
        const previewRuntimeAgentAIProfile = requireAIConfigMethod(
          runtime.agent.previewRuntimeAgentAIProfile,
          'previewRuntimeAgentAIProfile',
        );
        const payload = runtimeAgentAIProfilePayload(profile, input.requirementDeclarations);
        const response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) =>
          previewRuntimeAgentAIProfile({
            context: buildContext(subjectUserId, input),
            ...payload,
          }, callOptions));
        const outcome = projectRuntimeAgentAIProfileOutcome(response.outcome);
        const beforeSnapshot = projectAIConfigSnapshot(response.before);
        const baseVersion = runtimeAgentAIProfileBaseVersion(response.baseRevision);
        if (baseVersion !== runtimeAgentAIProfileBaseVersion(beforeSnapshot.revision)) {
          agentAIConfigResponseError('Runtime Agent AIProfile preview base revision does not match before config.');
        }
        const after = response.after ? projectAIConfigSnapshot(response.after).aiConfig : null;
        if ((outcome === 'ready_to_apply') !== Boolean(after)) {
          agentAIConfigResponseError('Runtime Agent AIProfile preview outcome and live candidate disagree.');
        }
        const setupProjection = projectRuntimeAgentAIProfileSetup(outcome, response);
        return {
          before: beforeSnapshot.aiConfig,
          after,
          outcome,
          ...(setupProjection ? { setupProjection } : {}),
          diff: diffNimiAIConfigs(beforeSnapshot.aiConfig, after),
          baseVersion,
          probeWarnings: normalizeRuntimeAgentAIProfileStrings(response.probeWarnings),
        };
      },
      async apply(input) {
        assertRuntimeAgentAIProfileScope(input);
        const profileId = normalizeNimiRuntimeAgentText(input.profileId);
        if (!profileId) {
          agentAIConfigInputError('Runtime Agent AIProfile profileId is required.', 'select_ai_profile');
        }
        const subjectUserId = await resolveSubject(input.subjectUserId);
        const profile = await requireProfileSource().get(profileId);
        if (!profile) {
          return {
            success: false,
            config: null,
            failureReason: `profile_not_found:${profileId}`,
            outcome: 'failed',
            probeWarnings: [`AI profile not found: ${profileId}`],
          };
        }
        const expectedRevision = input.expectedBaseVersion
          ? parseRuntimeAgentAIProfileBaseVersion(input.expectedBaseVersion)
          : String((await loadCurrentSnapshot(subjectUserId, input)).revision);
        const applyRuntimeAgentAIProfile = requireAIConfigMethod(
          runtime.agent.applyRuntimeAgentAIProfile,
          'applyRuntimeAgentAIProfile',
        );
        const payload = runtimeAgentAIProfilePayload(profile, input.requirementDeclarations);
        const response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) =>
          applyRuntimeAgentAIProfile({
            context: buildContext(subjectUserId, input),
            expectedRevision,
            ...payload,
          }, callOptions));
        const outcome = projectRuntimeAgentAIProfileOutcome(response.outcome);
        const config = response.config ? projectAIConfigSnapshot(response.config).aiConfig : null;
        if ((outcome === 'ready_to_apply') !== Boolean(config)) {
          agentAIConfigResponseError('Runtime Agent AIProfile apply outcome and committed config disagree.');
        }
        const setupProjection = projectRuntimeAgentAIProfileSetup(outcome, response);
        const reasonCodes = normalizeRuntimeAgentAIProfileStrings(response.reasonCodes);
        return {
          success: outcome === 'ready_to_apply',
          config,
          failureReason: outcome === 'ready_to_apply'
            ? null
            : reasonCodes.join(',') || outcome,
          outcome,
          ...(setupProjection ? { setupProjection } : {}),
          probeWarnings: normalizeRuntimeAgentAIProfileStrings(response.probeWarnings),
        };
      },
    },
    async readiness(input) {
      const getRuntimeAgentAIConfigReadiness = requireAIConfigMethod(
        runtime.agent.getRuntimeAgentAIConfigReadiness,
        'getRuntimeAgentAIConfigReadiness',
      );
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], (callOptions) =>
        getRuntimeAgentAIConfigReadiness({ context: buildContext(subjectUserId, input) }, callOptions));
      return projectNimiRuntimeAgentAIConfigReadinessSnapshot(response.snapshot);
    },
    subscribeReadiness(input) {
      const subscribeRuntimeAgentAIConfigReadiness = requireAIConfigMethod(
        runtime.agent.subscribeRuntimeAgentAIConfigReadiness,
        'subscribeRuntimeAgentAIConfigReadiness',
      );
      // The server stream delivers the initial snapshot followed by change
      // snapshots (K-AGCORE-149). Scope acquisition is deferred to the first
      // pull so the surface stays synchronous like other typed stream methods.
      return {
        [Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAgentAIConfigReadinessSnapshotProjection> {
          let iterator: AsyncIterator<RuntimeAgentAIConfigReadinessSnapshot> | null = null;
          let closed = false;
          const ensureIterator = async (): Promise<AsyncIterator<RuntimeAgentAIConfigReadinessSnapshot>> => {
            if (iterator) {
              return iterator;
            }
            const subjectUserId = await resolveSubject(input.subjectUserId);
            const stream = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], async (callOptions) =>
              subscribeRuntimeAgentAIConfigReadiness({ context: buildContext(subjectUserId, input) }, callOptions));
            iterator = stream[Symbol.asyncIterator]();
            return iterator;
          };
          return {
            next: async () => {
              if (closed) {
                return { done: true, value: undefined };
              }
              const next = await (await ensureIterator()).next();
              if (next.done) {
                return { done: true, value: undefined };
              }
              return {
                done: false,
                value: projectNimiRuntimeAgentAIConfigReadinessSnapshot(next.value),
              };
            },
            return: async () => {
              closed = true;
              if (iterator) {
                await Promise.resolve(iterator.return?.()).catch(() => undefined);
              }
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
  };
}
