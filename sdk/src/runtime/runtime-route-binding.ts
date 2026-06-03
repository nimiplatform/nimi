import {
  DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
  normalizeLocalProviderAdapterId,
} from './runtime-route-types.js';
import type { LocalProviderAdapter } from './runtime-route-types.js';
import {
  normalizeRuntimeRouteEngineEvidence,
  normalizeRuntimeRouteModelRoot,
  normalizeRuntimeRouteSource,
  type RuntimeCanonicalCapability,
  type RuntimeResolvedBinding,
  type RuntimeRouteBinding,
  type RuntimeRouteConnectorOption,
  type RuntimeRouteExecutionCallTarget,
  type RuntimeRouteLocalOption,
  type RuntimeRouteLocalWarmAssetEvidence,
  type RuntimeRouteLocalWarmCandidate,
  type RuntimeRouteOptionsSnapshot,
  type RuntimeRouteSource,
} from './runtime-route-core.js';

function routeBindingKey(input: RuntimeRouteBinding | null | undefined): string {
  if (!input) return '';
  return [
    String(input.source || '').trim(),
    String(input.connectorId || '').trim(),
    String(input.modelId || input.model || '').trim(),
    String(input.localModelId || input.goRuntimeLocalModelId || '').trim(),
    String(input.engine || input.provider || '').trim(),
  ].join('|');
}

function sameRuntimeLocalBindingRoute(left: RuntimeRouteBinding, right: RuntimeRouteBinding): boolean {
  if (left.source !== 'local' || right.source !== 'local') {
    return false;
  }
  const leftLocalModelId = String(left.localModelId || left.goRuntimeLocalModelId || '').trim();
  const rightLocalModelId = String(right.localModelId || right.goRuntimeLocalModelId || '').trim();
  if (leftLocalModelId && rightLocalModelId) {
    return leftLocalModelId === rightLocalModelId;
  }
  const leftModel = normalizeRuntimeRouteModelRoot(left.modelId || left.model);
  const rightModel = normalizeRuntimeRouteModelRoot(right.modelId || right.model);
  if (!leftModel || !rightModel || leftModel !== rightModel) {
    return false;
  }
  const leftEngine = normalizeRuntimeRouteEngineEvidence(left.engine || left.provider);
  const rightEngine = normalizeRuntimeRouteEngineEvidence(right.engine || right.provider);
  return Boolean(leftEngine && rightEngine && leftEngine === rightEngine);
}

function sameRuntimeCloudBindingRoute(left: RuntimeRouteBinding, right: RuntimeRouteBinding): boolean {
  if (left.source !== 'cloud' || right.source !== 'cloud') {
    return false;
  }
  const leftConnectorId = String(left.connectorId || '').trim();
  const rightConnectorId = String(right.connectorId || '').trim();
  const leftModel = String(left.modelId || left.model || '').trim();
  const rightModel = String(right.modelId || right.model || '').trim();
  return Boolean(leftConnectorId && rightConnectorId && leftConnectorId === rightConnectorId && leftModel && rightModel && leftModel === rightModel);
}

function sameRuntimeBindingRoute(left: RuntimeRouteBinding, right: RuntimeRouteBinding): boolean {
  return sameRuntimeLocalBindingRoute(left, right) || sameRuntimeCloudBindingRoute(left, right);
}

function localOptionToBinding(option: RuntimeRouteLocalOption): RuntimeRouteBinding {
  const modelId = String(option.modelId || option.model || '').trim();
  return {
    source: 'local',
    connectorId: '',
    model: modelId,
    modelId: modelId || undefined,
    provider: String(option.provider || option.engine || '').trim() || undefined,
    localModelId: String(option.localModelId || '').trim() || undefined,
    engine: String(option.engine || '').trim() || undefined,
    adapter: option.adapter,
    providerHints: option.providerHints,
    endpoint: String(option.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(option.goRuntimeLocalModelId || '').trim() || undefined,
    goRuntimeStatus: String(option.goRuntimeStatus || '').trim() || undefined,
  };
}

function findRuntimeLocalEvidence(
  binding: RuntimeRouteBinding,
  localModels: RuntimeRouteLocalOption[],
): RuntimeRouteBinding | null {
  const bindingLocalModelId = String(binding.localModelId || binding.goRuntimeLocalModelId || '').trim();
  if (bindingLocalModelId) {
    const byLocalModelId = localModels.find((item) => (
      String(item.localModelId || item.goRuntimeLocalModelId || '').trim() === bindingLocalModelId
    )) || null;
    if (byLocalModelId) return localOptionToBinding(byLocalModelId);
  }

  const bindingModelRoot = normalizeRuntimeRouteModelRoot(binding.modelId || binding.model);
  const bindingEngine = normalizeRuntimeRouteEngineEvidence(binding.engine || binding.provider);
  if (!bindingModelRoot || !bindingEngine) return null;

  const byModelAndEngine = localModels.find((item) => (
    normalizeRuntimeRouteModelRoot(item.modelId || item.model) === bindingModelRoot
    && normalizeRuntimeRouteEngineEvidence(item.engine || item.provider) === bindingEngine
  )) || null;
  return byModelAndEngine ? localOptionToBinding(byModelAndEngine) : null;
}

function findRuntimeCloudEvidence(
  binding: RuntimeRouteBinding,
  connectors: RuntimeRouteConnectorOption[],
): RuntimeRouteBinding | null {
  const connectorId = String(binding.connectorId || '').trim();
  const model = String(binding.modelId || binding.model || '').trim();
  if (!connectorId || !model) return null;
  const connector = connectors.find((item) => String(item.id || '').trim() === connectorId) || null;
  if (!connector || !connector.models.includes(model)) return null;
  return {
    ...binding,
    source: 'cloud',
    connectorId,
    model,
    modelId: model,
    provider: String(binding.provider || connector.provider || '').trim() || undefined,
  };
}

function runtimeResolvedBindingRefFor(
  capability: RuntimeCanonicalCapability,
  binding: RuntimeRouteBinding,
): string {
  if (binding.source === 'cloud') {
    return [
      'cloud',
      capability,
      encodeURIComponent(String(binding.connectorId || '').trim()),
      encodeURIComponent(String(binding.modelId || binding.model || '').trim()),
    ].join(':');
  }
  return [
    'local',
    capability,
    encodeURIComponent(normalizeRuntimeRouteEngineEvidence(binding.engine || binding.provider)),
    encodeURIComponent(String(binding.localModelId || binding.goRuntimeLocalModelId || binding.modelId || binding.model || '').trim()),
  ].join(':');
}

function resolveRuntimeLocalBinding(
  capability: RuntimeCanonicalCapability,
  binding: RuntimeRouteBinding,
): RuntimeResolvedBinding {
  const modelId = normalizeRuntimeRouteModelRoot(binding.modelId || binding.model || binding.localModelId || '');
  const engine = normalizeRuntimeRouteEngineEvidence(binding.engine || binding.provider);
  if (!modelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  if (!engine) {
    throw new Error('RUNTIME_ROUTE_BINDING_ENGINE_REQUIRED');
  }
  const localModelId = String(binding.localModelId || binding.goRuntimeLocalModelId || '').trim();
  if (!localModelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_LOCAL_MODEL_REQUIRED');
  }
  return {
    ...binding,
    capability,
    source: 'local',
    connectorId: '',
    provider: String(binding.provider || '').trim() || engine,
    engine,
    model: modelId,
    modelId,
    localModelId,
    endpoint: String(binding.endpoint || binding.localProviderEndpoint || binding.localOpenAiEndpoint || '').trim() || undefined,
    localProviderEndpoint: String(binding.localProviderEndpoint || binding.endpoint || '').trim() || undefined,
    localOpenAiEndpoint: String(binding.localOpenAiEndpoint || binding.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(binding.goRuntimeLocalModelId || binding.localModelId || '').trim() || undefined,
    goRuntimeStatus: String(binding.goRuntimeStatus || '').trim() || undefined,
    resolvedBindingRef: runtimeResolvedBindingRefFor(capability, binding),
  } as RuntimeResolvedBinding;
}

function resolveRuntimeCloudBinding(
  capability: RuntimeCanonicalCapability,
  binding: RuntimeRouteBinding,
): RuntimeResolvedBinding {
  const connectorId = String(binding.connectorId || '').trim();
  const provider = String(binding.provider || '').trim();
  const modelId = String(binding.modelId || binding.model || '').trim();
  if (!connectorId) {
    throw new Error('RUNTIME_ROUTE_BINDING_CONNECTOR_REQUIRED');
  }
  if (!provider) {
    throw new Error('RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED');
  }
  if (!modelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  return {
    ...binding,
    capability,
    source: 'cloud',
    connectorId,
    provider,
    model: modelId,
    modelId,
    endpoint: String(binding.endpoint || '').trim() || undefined,
    resolvedBindingRef: runtimeResolvedBindingRefFor(capability, binding),
  } as RuntimeResolvedBinding;
}

export function resolveRuntimeRouteBindingFromSnapshot(input: {
  capability: RuntimeCanonicalCapability;
  binding: RuntimeRouteBinding | null | undefined;
  snapshot: RuntimeRouteOptionsSnapshot;
}): RuntimeResolvedBinding {
  const binding = input.binding;
  if (!binding) {
    throw new Error('RUNTIME_ROUTE_BINDING_REQUIRED');
  }
  const selected = input.snapshot.selected && sameRuntimeBindingRoute(binding, input.snapshot.selected)
    ? input.snapshot.selected
    : null;
  const candidate = selected || binding;
  const evidence = candidate.source === 'cloud'
    ? findRuntimeCloudEvidence(candidate, input.snapshot.connectors)
    : findRuntimeLocalEvidence(candidate, input.snapshot.local.models);
  if (!evidence) {
    throw new Error(candidate.source === 'cloud'
      ? 'RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED'
      : 'RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED');
  }
  return evidence.source === 'cloud'
    ? resolveRuntimeCloudBinding(input.capability, evidence)
    : resolveRuntimeLocalBinding(input.capability, evidence);
}

function ensureRuntimeRoutePrefixedModelId(prefix: string, model: unknown): string {
  const modelRoot = normalizeRuntimeRouteModelRoot(model);
  if (!modelRoot) {
    throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  return `${prefix}/${modelRoot}`;
}

export function runtimeRouteCallTargetFromResolvedBinding(
  resolved: RuntimeResolvedBinding,
): RuntimeRouteExecutionCallTarget {
  if (resolved.source === 'cloud') {
    const connectorId = String(resolved.connectorId || '').trim();
    const provider = String(resolved.provider || '').trim();
    if (!connectorId) throw new Error('RUNTIME_ROUTE_BINDING_CONNECTOR_REQUIRED');
    if (!provider) throw new Error('RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED');
    return {
      source: 'cloud',
      routePolicy: 2,
      modelId: ensureRuntimeRoutePrefixedModelId('cloud', resolved.modelId || resolved.model),
      provider,
      adapter: resolved.adapter || DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
      endpoint: String(resolved.endpoint || '').trim(),
      connectorId,
    };
  }

  const engine = normalizeRuntimeRouteEngineEvidence(resolved.engine || resolved.provider);
  if (!engine) throw new Error('RUNTIME_ROUTE_BINDING_ENGINE_REQUIRED');
  const localModelId = String(resolved.localModelId || '').trim();
  const goRuntimeLocalModelId = String(resolved.goRuntimeLocalModelId || resolved.localModelId || '').trim();
  if (!localModelId && !goRuntimeLocalModelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_LOCAL_MODEL_REQUIRED');
  }
  return {
    source: 'local',
    routePolicy: 1,
    modelId: ensureRuntimeRoutePrefixedModelId(engine, resolved.modelId || resolved.model || resolved.localModelId),
    provider: String(resolved.provider || '').trim() || engine,
    adapter: resolved.adapter || DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
    endpoint: String(resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint || '').trim(),
    localModelId: localModelId || undefined,
    goRuntimeLocalModelId: goRuntimeLocalModelId || undefined,
    engine,
  };
}

export function selectRuntimeLocalWarmCandidateFromResolvedBinding(input: {
  resolved: RuntimeResolvedBinding;
  assets: RuntimeRouteLocalWarmAssetEvidence[];
}): RuntimeRouteLocalWarmCandidate | null {
  if (input.resolved.source !== 'local') {
    return null;
  }
  const targetLocalModelId = String(input.resolved.goRuntimeLocalModelId || input.resolved.localModelId || '').trim();
  const targetModelRoot = normalizeRuntimeRouteModelRoot(input.resolved.modelId || input.resolved.model);
  const targetEndpoint = String(input.resolved.localProviderEndpoint || input.resolved.localOpenAiEndpoint || input.resolved.endpoint || '').trim();
  const targetEngine = normalizeRuntimeRouteEngineEvidence(input.resolved.engine || input.resolved.provider);
  if (!targetLocalModelId && (!targetModelRoot || !targetEngine)) {
    throw new Error('RUNTIME_ROUTE_BINDING_LOCAL_EVIDENCE_REQUIRED');
  }

  const candidates = input.assets
    .map((item) => ({
      localAssetId: String(item.localAssetId || '').trim(),
      assetId: String(item.assetId || '').trim(),
      engine: String(item.engine || '').trim(),
      endpoint: String(item.endpoint || '').trim(),
      updatedAt: String(item.updatedAt || '').trim(),
      status: Number(item.status || 0),
    }))
    .filter((item) => item.localAssetId && item.assetId && item.status !== 4);

  if (targetLocalModelId) {
    const direct = candidates.find((item) => item.localAssetId === targetLocalModelId) || null;
    if (direct) return direct;
  }

  const scored = candidates
    .filter((item) => normalizeRuntimeRouteModelRoot(item.assetId) === targetModelRoot)
    .filter((item) => normalizeRuntimeRouteEngineEvidence(item.engine) === targetEngine)
    .map((item) => {
      let score = 0;
      if (targetEndpoint && item.endpoint === targetEndpoint) score += 4;
      if (item.status === 2) score += 1;
      return { item, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.localAssetId.localeCompare(right.item.localAssetId);
    });

  return scored[0]?.item || null;
}
