import {
  buildNimiRuntimeRouteCapabilityProjection,
  createDefaultNimiRuntimeRouteCapabilitySelectionStore,
  normalizeNimiRuntimeRouteTargetRef,
  updateNimiRuntimeRouteCapabilityTargetRef,
  type NimiRuntimeRouteAppCapability,
  type NimiRuntimeResolvedBinding,
  type NimiRuntimeRouteCapabilityRuntime,
  type NimiRuntimeRouteCapabilitySelectionStore,
  type NimiRuntimeRouteTargetRef,
} from '@nimiplatform/sdk/runtime';
import type { NimiAIConfig, NimiAIConfigTargetRef } from '@nimiplatform/sdk/ai';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  createZhiyuAgentHomeAIScopeRef,
  loadZhiyuAIConfig,
} from '../ai-config/zhiyu-ai-config-store';
import {
  createZhiyuRuntimeRouteCapabilityRuntime,
} from '../ai-config/zhiyu-runtime-model-provider';

export type ZhiyuRuntimeRouteStatus = ZhiyuEvidence['route'];

export {
  createZhiyuAgentHomeAIScopeRef,
} from '../ai-config/zhiyu-ai-config-store';

export const ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES = [
  'text.generate',
  'chat.stream',
  'text.embed',
  'image.generate',
] as const;

export type ZhiyuAIConfigEnabledCapability = (typeof ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES)[number];

export const ZHIYU_AI_CONFIG_BINDING_CAPABILITIES: Readonly<Record<ZhiyuAIConfigEnabledCapability, NimiRuntimeRouteAppCapability>> = {
  'text.generate': 'text.generate',
  'chat.stream': 'text.generate',
  'text.embed': 'text.embed',
  'image.generate': 'image.generate',
};

export type ZhiyuRuntimeRouteProjectionInput = {
  readonly config?: NimiAIConfig | null;
  readonly selectionStore?: NimiRuntimeRouteCapabilitySelectionStore | null;
  readonly routeRuntime?: NimiRuntimeRouteCapabilityRuntime | null;
};

export async function probeZhiyuRuntimeRouteProjection(
  input: ZhiyuRuntimeRouteProjectionInput = {},
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

  const executionBinding = executionBindingFromResolvedBinding(projection.resolvedBinding);
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
  };
}

function selectionStoreFromAIConfig(config: NimiAIConfig): NimiRuntimeRouteCapabilitySelectionStore {
  let store = createDefaultNimiRuntimeRouteCapabilitySelectionStore();
  for (const capability of ['text.generate', 'text.embed', 'image.generate'] as const) {
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

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
