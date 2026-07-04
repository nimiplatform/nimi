import {
  buildNimiRuntimeRouteCapabilityProjection,
  createDefaultNimiRuntimeRouteCapabilitySelectionStore,
  normalizeNimiRuntimeRouteTargetRef,
  updateNimiRuntimeRouteCapabilityTargetRef,
  type NimiRuntimeResolvedBinding,
  type NimiRuntimeRouteCapabilityRuntime,
  type NimiRuntimeRouteCapabilitySelectionStore,
  type NimiRuntimeRouteTargetRef,
  type NimiRuntimeAgentExecutionBinding,
} from '@nimiplatform/sdk/runtime';
import type { NimiAIConfig, NimiAIConfigTargetRef } from '@nimiplatform/sdk/ai';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuConversationHomeStatus } from '../agent/conversation-home';
import {
  createZhiyuAgentHomeAIScopeRef,
  loadZhiyuAIConfig,
} from '../ai-config/zhiyu-ai-config-store';
import {
  ZHIYU_AI_CONFIG_BINDING_CAPABILITIES,
  ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES,
  type ZhiyuAIConfigEnabledCapability,
} from '../ai-config/zhiyu-ai-config-capabilities';
import {
  createZhiyuRuntimeRouteCapabilityRuntime,
} from '../ai-config/zhiyu-runtime-model-provider';
import {
  resolveZhiyuRuntimeAgentBindingDecision,
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
  type ZhiyuRuntimeAgentBindingDecision,
} from './runtime-agent-binding';

export type ZhiyuRuntimeRouteStatus = ZhiyuEvidence['route'];
export type ZhiyuRuntimeTurnStatus = ZhiyuEvidence['turn'];
export type ZhiyuRuntimeTurnExecutionBinding = NimiRuntimeAgentExecutionBinding;

export {
  createZhiyuAgentHomeAIScopeRef,
  resolveZhiyuRuntimeAgentBindingDecision,
};

export type ZhiyuAgentRouteReadinessInput = {
  readonly config?: NimiAIConfig | null;
  readonly selectionStore?: NimiRuntimeRouteCapabilitySelectionStore | null;
  readonly routeRuntime?: NimiRuntimeRouteCapabilityRuntime | null;
};

export async function probeZhiyuAgentRouteReadiness(
  input: ZhiyuAgentRouteReadinessInput = {},
): Promise<ZhiyuRuntimeRouteStatus> {
  const config = input.config || loadZhiyuAIConfig();
  const scopeRef = config.scopeRef;
  const selectionStore = input.selectionStore || selectionStoreFromAIConfig(config);
  const routeRuntime = input.routeRuntime === undefined
    ? await createZhiyuRuntimeRouteCapabilityRuntime()
    : input.routeRuntime;
  const targetRefKinds = targetRefKindMap(config);

  const projection = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore,
    routeRuntime: routeRuntime || null,
  });
  const imageProjection = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'image.generate',
    selectionStore,
    routeRuntime: routeRuntime || null,
  });

  const executionBinding = executionBindingFromResolvedBinding(projection.resolvedBinding);
  const imageExecutionBinding = imageProjection.supported
    ? executionBindingFromResolvedBinding(imageProjection.resolvedBinding)
    : null;
  const executionBindings = {
    'text.generate': executionBinding,
    'image.generate': imageExecutionBinding,
  };
  if (projection.supported && executionBinding) {
    return {
      transport: 'electron-ipc',
      ready: true,
      capability: 'text.generate',
      aiConfigScopeOwnerId: scopeRef.ownerId,
      aiConfigScopeSurfaceId: scopeRef.surfaceId || '',
      enabledCapabilities: ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES,
      bindingCapabilities: ZHIYU_AI_CONFIG_BINDING_CAPABILITIES,
      targetRefKinds,
      reasonCode: 'runtime-route-ready',
      actionHint: 'send_runtime_agent_turn',
      source: 'sdk',
      message: 'Runtime route projection resolved a text.generate execution binding.',
      selectedTargetRefKind: projection.selectedTargetRef?.kind || null,
      resolvedBindingRef: projection.resolvedBinding?.resolvedBindingRef || null,
      executionBinding,
      executionBindings,
    };
  }

  return {
    transport: 'electron-ipc',
    ready: false,
    capability: 'text.generate',
    aiConfigScopeOwnerId: scopeRef.ownerId,
    aiConfigScopeSurfaceId: scopeRef.surfaceId || '',
    enabledCapabilities: ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES,
    bindingCapabilities: ZHIYU_AI_CONFIG_BINDING_CAPABILITIES,
    targetRefKinds,
    reasonCode: reasonCodeFromProjection(projection.reasonCode),
    actionHint: actionHintFromProjection(projection.reasonCode),
    source: 'sdk',
    message: messageFromProjection(projection.reasonCode),
    selectedTargetRefKind: projection.selectedTargetRef?.kind || null,
    resolvedBindingRef: projection.resolvedBinding?.resolvedBindingRef || null,
    executionBinding: null,
    executionBindings,
  };
}

export function probeZhiyuAgentTurnReadiness(
  conversation: ZhiyuConversationHomeStatus,
  executionBinding?: ZhiyuRuntimeTurnExecutionBinding | null,
  runtimeBinding: ZhiyuRuntimeAgentBindingDecision = resolveZhiyuRuntimeAgentBindingDecisionFromHost(),
): ZhiyuRuntimeTurnStatus {
  const identity = conversationIdentity(conversation);
  if (!identity) {
    return turnUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: conversation.source,
      message: 'Zhiyu requires a Runtime-owned conversation anchor before sending a turn.',
      ownerUserId: conversation.ownerUserId,
      runtimeSourceRef: conversation.runtimeSourceRef,
      localAgentRef: conversation.localAgentRef,
      conversationAnchorId: conversation.conversationAnchorId,
    });
  }

  const binding = normalizeExecutionBinding(executionBinding);
  if (!binding) {
    return turnUnavailable({
      reasonCode: 'zhiyu-runtime-route-required',
      actionHint: 'select_runtime_agent_route',
      source: 'renderer',
      message: 'Zhiyu requires an admitted Runtime execution binding before sending a turn.',
      ...identity,
    });
  }

  if (runtimeBinding.kind === 'missing') {
    return turnUnavailable({
      reasonCode: runtimeBinding.reasonCode,
      actionHint: runtimeBinding.actionHint,
      source: 'runtime',
      message: runtimeBinding.message,
      ...identity,
    });
  }

  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-turn-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'renderer',
    message: 'Runtime Agent turn channel is ready.',
    ...identity,
    requestId: null,
    messageId: null,
  };
}

function selectionStoreFromAIConfig(config: NimiAIConfig): NimiRuntimeRouteCapabilitySelectionStore {
  let store = createDefaultNimiRuntimeRouteCapabilitySelectionStore();
  for (const capability of ['text.generate', 'text.embed', 'image.generate', 'audio.synthesize'] as const) {
    const targetRef = routeTargetRefFromAIConfig(config.capabilities.targetRefs[capability] || null);
    if (targetRef) {
      store = updateNimiRuntimeRouteCapabilityTargetRef(store, capability, targetRef);
    }
  }
  return store;
}

function targetRefKindMap(config: NimiAIConfig): Record<ZhiyuAIConfigEnabledCapability, string | null> {
  const entries = ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES.map((capability) => {
    const bindingCapability = ZHIYU_AI_CONFIG_BINDING_CAPABILITIES[capability];
    const targetRef = routeTargetRefFromAIConfig(config.capabilities.targetRefs[bindingCapability] || null);
    return [capability, targetRef?.kind || null] as const;
  });
  return Object.fromEntries(entries) as Record<ZhiyuAIConfigEnabledCapability, string | null>;
}

function routeTargetRefFromAIConfig(targetRef: NimiAIConfigTargetRef | null): NimiRuntimeRouteTargetRef | null {
  if (!targetRef || targetRef.kind === 'profile-slice') {
    return null;
  }
  try {
    return normalizeNimiRuntimeRouteTargetRef(targetRef);
  } catch {
    return null;
  }
}

function executionBindingFromResolvedBinding(
  resolved: NimiRuntimeResolvedBinding | null,
): ZhiyuRuntimeRouteStatus['executionBinding'] {
  if (!resolved) {
    return null;
  }
  const source = stringOr(resolved.source, '').toLowerCase();
  const route = source === 'local-runtime'
    ? 'local'
    : source === 'cloud-connector'
      ? 'cloud'
      : null;
  const modelId = stringOr(
    resolved.providerModelId
      || resolved.modelId
      || resolved.model
      || resolved.localAssetId,
    '',
  );
  if (!route || !modelId) {
    return null;
  }
  return {
    route,
    modelId,
    targetRef: resolved.targetRef,
    ...(stringOr(resolved.connectorId, '') ? { connectorId: stringOr(resolved.connectorId, '') } : {}),
  };
}

function conversationIdentity(conversation: ZhiyuConversationHomeStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
} | null {
  if (!conversation.ready) {
    return null;
  }
  const ownerUserId = stringOr(conversation.ownerUserId, '');
  const runtimeSourceRef = stringOr(conversation.runtimeSourceRef, '');
  const localAgentRef = stringOr(conversation.localAgentRef, '');
  const conversationAnchorId = stringOr(conversation.conversationAnchorId, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef || !conversationAnchorId) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
  };
}

function normalizeExecutionBinding(
  value: ZhiyuRuntimeTurnExecutionBinding | null | undefined,
): ZhiyuRuntimeTurnExecutionBinding | null {
  if (!value) {
    return null;
  }
  const route = value.route;
  const model = stringOr(value.modelId, '');
  if ((route !== 'local' && route !== 'cloud') || !model) {
    return null;
  }
  const modelId = model;
  return {
    route,
    modelId,
    targetRef: value.targetRef,
    ...(stringOr(value.connectorId, '') ? { connectorId: stringOr(value.connectorId, '') } : {}),
  };
}

function reasonCodeFromProjection(reasonCode: string | null): string {
  if (reasonCode === 'selection_missing' || reasonCode === 'selection_cleared') {
    return 'zhiyu-ai-config-route-selection-required';
  }
  if (reasonCode === 'binding_unresolved') {
    return 'zhiyu-runtime-route-binding-unresolved';
  }
  if (reasonCode === 'route_not_ready') {
    return 'zhiyu-runtime-route-not-ready';
  }
  if (reasonCode === 'route_unhealthy') {
    return 'zhiyu-runtime-route-unhealthy';
  }
  if (reasonCode === 'metadata_missing') {
    return 'zhiyu-runtime-route-metadata-missing';
  }
  if (reasonCode === 'capability_unsupported') {
    return 'zhiyu-runtime-route-capability-unsupported';
  }
  if (reasonCode === 'host_denied') {
    return 'zhiyu-runtime-route-host-denied';
  }
  return 'zhiyu-runtime-route-unavailable';
}

function actionHintFromProjection(reasonCode: string | null): string {
  if (reasonCode === 'selection_missing' || reasonCode === 'selection_cleared') {
    return 'select_runtime_agent_route';
  }
  if (reasonCode === 'route_not_ready') {
    return 'finish_runtime_route_readiness';
  }
  return 'check_runtime_route_projection';
}

function messageFromProjection(reasonCode: string | null): string {
  if (reasonCode === 'selection_missing' || reasonCode === 'selection_cleared') {
    return 'Zhiyu requires an admitted AIConfig route selection before sending Runtime Agent turns.';
  }
  if (reasonCode === 'binding_unresolved') {
    return 'Runtime route projection could not resolve the selected text.generate binding.';
  }
  if (reasonCode === 'route_not_ready') {
    return 'Runtime route projection resolved a binding that is not ready.';
  }
  if (reasonCode === 'route_unhealthy') {
    return 'Runtime route projection resolved an unhealthy binding.';
  }
  if (reasonCode === 'metadata_missing') {
    return 'Runtime route projection resolved a binding without required text.generate metadata.';
  }
  if (reasonCode === 'capability_unsupported') {
    return 'Runtime route projection does not support text.generate for the selected target.';
  }
  if (reasonCode === 'host_denied') {
    return 'Runtime route projection was denied by the host.';
  }
  return 'Runtime route projection is unavailable.';
}

function turnUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
  readonly conversationAnchorId?: string | null;
  readonly requestId?: string | null;
}): ZhiyuRuntimeTurnStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    conversationAnchorId: input.conversationAnchorId ?? null,
    requestId: input.requestId ?? null,
    messageId: null,
  };
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: null): string | null;
function stringOr(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
