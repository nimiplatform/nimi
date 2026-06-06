import { createNimiError } from '../types';
import {
  normalizeNimiRuntimeRouteCapabilityToken,
  runtimeNimiRouteCapabilitiesMatch,
  type NimiRuntimeCanonicalCapability,
  type NimiRuntimeRouteBinding,
  type NimiRuntimeRouteOptionsSnapshot,
} from './route-options';
import type {
  NimiRuntimeResolvedBinding,
  NimiRuntimeRouteHealthInput,
  NimiRuntimeRouteHealthResult,
  NimiRuntimeRouteHostProviderHealth,
} from './route-capability-types';

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRequiredNimiRuntimeRouteCapability(value: unknown): NimiRuntimeCanonicalCapability {
  const capability = normalizeNimiRuntimeRouteCapabilityToken(value);
  if (!capability) {
    throw createNimiError({
      message: 'Runtime route capability is required.',
      reasonCode: 'SDK_RUNTIME_ROUTE_INPUT_INVALID',
      actionHint: 'provide_runtime_route_capability',
      source: 'sdk',
    });
  }
  return capability;
}

export function normalizeNimiRuntimeRouteModelRoot(model: unknown): string {
  const normalized = normalizeText(model);
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  for (const prefix of ['llama/', 'media/', 'speech/', 'sidecar/', 'local/', 'cloud/', 'token/']) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

export function normalizeNimiRuntimeRouteEngineEvidence(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function sameNimiRuntimeLocalBindingRoute(
  left: NimiRuntimeRouteBinding,
  right: NimiRuntimeRouteBinding,
): boolean {
  if (left.source !== 'local' || right.source !== 'local') {
    return false;
  }
  const leftLocalModelId = normalizeText(left.localModelId || left.goRuntimeLocalModelId);
  const rightLocalModelId = normalizeText(right.localModelId || right.goRuntimeLocalModelId);
  if (leftLocalModelId && rightLocalModelId) {
    return leftLocalModelId === rightLocalModelId;
  }
  const leftModel = normalizeNimiRuntimeRouteModelRoot(left.modelId || left.model);
  const rightModel = normalizeNimiRuntimeRouteModelRoot(right.modelId || right.model);
  if (!leftModel || !rightModel || leftModel !== rightModel) {
    return false;
  }
  const leftEngine = normalizeNimiRuntimeRouteEngineEvidence(left.engine || left.provider);
  const rightEngine = normalizeNimiRuntimeRouteEngineEvidence(right.engine || right.provider);
  return Boolean(leftEngine && rightEngine && leftEngine === rightEngine);
}

function sameNimiRuntimeCloudBindingRoute(
  left: NimiRuntimeRouteBinding,
  right: NimiRuntimeRouteBinding,
): boolean {
  if (left.source !== 'cloud' || right.source !== 'cloud') {
    return false;
  }
  const leftConnectorId = normalizeText(left.connectorId);
  const rightConnectorId = normalizeText(right.connectorId);
  const leftModel = normalizeText(left.modelId || left.model);
  const rightModel = normalizeText(right.modelId || right.model);
  return Boolean(
    leftConnectorId
    && rightConnectorId
    && leftConnectorId === rightConnectorId
    && leftModel
    && rightModel
    && leftModel === rightModel,
  );
}

function sameNimiRuntimeBindingRoute(left: NimiRuntimeRouteBinding, right: NimiRuntimeRouteBinding): boolean {
  return sameNimiRuntimeLocalBindingRoute(left, right) || sameNimiRuntimeCloudBindingRoute(left, right);
}

function localOptionToNimiRuntimeBinding(
  option: NimiRuntimeRouteOptionsSnapshot['local']['models'][number],
): NimiRuntimeRouteBinding {
  const modelId = normalizeText(option.modelId || option.model);
  return {
    source: 'local',
    connectorId: '',
    model: modelId,
    modelId: modelId || undefined,
    provider: normalizeText(option.provider || option.engine) || undefined,
    localModelId: normalizeText(option.localModelId) || undefined,
    engine: normalizeText(option.engine) || undefined,
    endpoint: normalizeText(option.endpoint) || undefined,
    goRuntimeLocalModelId: normalizeText(option.goRuntimeLocalModelId) || undefined,
    goRuntimeStatus: normalizeText(option.goRuntimeStatus) || undefined,
  };
}

function findNimiRuntimeLocalEvidence(
  capability: NimiRuntimeCanonicalCapability,
  binding: NimiRuntimeRouteBinding,
  localModels: readonly NimiRuntimeRouteOptionsSnapshot['local']['models'][number][],
): NimiRuntimeRouteBinding | null {
  const bindingLocalModelId = normalizeText(binding.localModelId || binding.goRuntimeLocalModelId);
  if (bindingLocalModelId) {
    const byLocalModelId = localModels.find((item) => (
      normalizeText(item.localModelId || item.goRuntimeLocalModelId) === bindingLocalModelId
    )) || null;
    if (byLocalModelId) {
      if (byLocalModelId.capabilities && !runtimeNimiRouteCapabilitiesMatch(byLocalModelId.capabilities, capability)) {
        return null;
      }
      return localOptionToNimiRuntimeBinding(byLocalModelId);
    }
  }

  const bindingModelRoot = normalizeNimiRuntimeRouteModelRoot(binding.modelId || binding.model);
  const bindingEngine = normalizeNimiRuntimeRouteEngineEvidence(binding.engine || binding.provider);
  if (!bindingModelRoot || !bindingEngine) return null;

  const byModelAndEngine = localModels.find((item) => (
    normalizeNimiRuntimeRouteModelRoot(item.modelId || item.model) === bindingModelRoot
    && normalizeNimiRuntimeRouteEngineEvidence(item.engine || item.provider) === bindingEngine
  )) || null;
  if (!byModelAndEngine) {
    return null;
  }
  if (byModelAndEngine.capabilities && !runtimeNimiRouteCapabilitiesMatch(byModelAndEngine.capabilities, capability)) {
    return null;
  }
  return localOptionToNimiRuntimeBinding(byModelAndEngine);
}

function findNimiRuntimeCloudEvidence(
  capability: NimiRuntimeCanonicalCapability,
  binding: NimiRuntimeRouteBinding,
  connectors: readonly NimiRuntimeRouteOptionsSnapshot['connectors'][number][],
): NimiRuntimeRouteBinding | null {
  const connectorId = normalizeText(binding.connectorId);
  const model = normalizeText(binding.modelId || binding.model);
  if (!connectorId || !model) return null;
  const connector = connectors.find((item) => normalizeText(item.id) === connectorId) || null;
  if (!connector || !connector.models.includes(model)) return null;
  const modelCapabilities = connector.modelCapabilities?.[model];
  if (modelCapabilities && !runtimeNimiRouteCapabilitiesMatch(modelCapabilities, capability)) {
    return null;
  }
  return {
    ...binding,
    source: 'cloud',
    connectorId,
    model,
    modelId: model,
    provider: normalizeText(binding.provider || connector.provider) || undefined,
  };
}

function nimiRuntimeResolvedBindingRefFor(
  capability: NimiRuntimeCanonicalCapability,
  binding: NimiRuntimeRouteBinding,
): string {
  if (binding.source === 'cloud') {
    return [
      'cloud',
      capability,
      encodeURIComponent(normalizeText(binding.connectorId)),
      encodeURIComponent(normalizeText(binding.modelId || binding.model)),
    ].join(':');
  }
  return [
    'local',
    capability,
    encodeURIComponent(normalizeNimiRuntimeRouteEngineEvidence(binding.engine || binding.provider)),
    encodeURIComponent(
      normalizeText(binding.localModelId || binding.goRuntimeLocalModelId || binding.modelId || binding.model),
    ),
  ].join(':');
}

function resolveNimiRuntimeCloudBinding(
  capability: NimiRuntimeCanonicalCapability,
  binding: NimiRuntimeRouteBinding,
): NimiRuntimeResolvedBinding {
  const connectorId = normalizeText(binding.connectorId);
  const provider = normalizeText(binding.provider);
  const modelId = normalizeText(binding.modelId || binding.model);
  if (!connectorId) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_CONNECTOR_REQUIRED');
  if (!provider) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED');
  if (!modelId) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  return {
    ...binding,
    capability,
    source: 'cloud',
    connectorId,
    provider,
    model: modelId,
    modelId,
    endpoint: normalizeText(binding.endpoint) || undefined,
    resolvedBindingRef: nimiRuntimeResolvedBindingRefFor(capability, binding),
  };
}

function resolveNimiRuntimeLocalBinding(
  capability: NimiRuntimeCanonicalCapability,
  binding: NimiRuntimeRouteBinding,
): NimiRuntimeResolvedBinding {
  const modelId = normalizeNimiRuntimeRouteModelRoot(binding.modelId || binding.model || binding.localModelId);
  const engine = normalizeNimiRuntimeRouteEngineEvidence(binding.engine || binding.provider);
  const localModelId = normalizeText(binding.localModelId || binding.goRuntimeLocalModelId);
  if (!modelId) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  if (!engine) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_ENGINE_REQUIRED');
  if (!localModelId) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_LOCAL_MODEL_REQUIRED');
  return {
    ...binding,
    capability,
    source: 'local',
    connectorId: '',
    provider: normalizeText(binding.provider) || engine,
    engine,
    model: modelId,
    modelId,
    localModelId,
    endpoint: normalizeText(binding.endpoint || binding.localProviderEndpoint || binding.localOpenAiEndpoint) || undefined,
    localProviderEndpoint: normalizeText(binding.localProviderEndpoint || binding.endpoint) || undefined,
    localOpenAiEndpoint: normalizeText(binding.localOpenAiEndpoint || binding.endpoint) || undefined,
    goRuntimeLocalModelId: normalizeText(binding.goRuntimeLocalModelId || binding.localModelId) || undefined,
    goRuntimeStatus: normalizeText(binding.goRuntimeStatus) || undefined,
    resolvedBindingRef: nimiRuntimeResolvedBindingRefFor(capability, binding),
  };
}

export function resolveNimiRuntimeRouteBindingFromSnapshot(input: {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly binding: NimiRuntimeRouteBinding | null | undefined;
  readonly snapshot: NimiRuntimeRouteOptionsSnapshot;
}): NimiRuntimeResolvedBinding {
  const binding = input.binding;
  if (!binding) {
    throw new Error('NIMI_RUNTIME_ROUTE_BINDING_REQUIRED');
  }
  const selected = input.snapshot.selected && sameNimiRuntimeBindingRoute(binding, input.snapshot.selected)
    ? input.snapshot.selected
    : null;
  const candidate = selected || binding;
  const evidence = candidate.source === 'cloud'
    ? findNimiRuntimeCloudEvidence(input.capability, candidate, input.snapshot.connectors)
    : findNimiRuntimeLocalEvidence(input.capability, candidate, input.snapshot.local.models);
  if (!evidence) {
    throw new Error(candidate.source === 'cloud'
      ? 'NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED'
      : 'NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED');
  }
  return evidence.source === 'cloud'
    ? resolveNimiRuntimeCloudBinding(input.capability, evidence)
    : resolveNimiRuntimeLocalBinding(input.capability, evidence);
}

export function nimiRuntimeRouteHealthInputFromResolvedBinding(
  resolved: NimiRuntimeResolvedBinding,
): NimiRuntimeRouteHealthInput {
  return {
    provider: normalizeText(resolved.provider || resolved.engine),
    capability: resolved.capability,
    localProviderEndpoint: normalizeText(resolved.localProviderEndpoint || resolved.endpoint) || undefined,
    localProviderModel: normalizeText(resolved.modelId || resolved.model || resolved.localModelId) || undefined,
    localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint || resolved.endpoint) || undefined,
    localModelId: normalizeText(resolved.localModelId) || undefined,
    goRuntimeLocalModelId: normalizeText(resolved.goRuntimeLocalModelId || resolved.localModelId) || undefined,
    connectorId: normalizeText(resolved.connectorId) || undefined,
  };
}

export function nimiRuntimeRouteHealthResultFromProviderHealth(input: {
  readonly resolved: NimiRuntimeResolvedBinding;
  readonly health: NimiRuntimeRouteHostProviderHealth;
}): NimiRuntimeRouteHealthResult {
  const available = input.health.status === 'healthy' || input.health.status === 'degraded';
  const actionHint = available
    ? (normalizeText(input.health.actionHint) || 'none')
    : (normalizeText(input.health.actionHint)
      || (input.resolved.source === 'cloud' ? 'verify-connector' : 'install-local-model'));
  return {
    healthy: available,
    status: available ? normalizeText(input.health.status) : 'unavailable',
    provider: normalizeText(input.health.provider || input.resolved.provider),
    detail: normalizeText(input.health.detail),
    reasonCode: normalizeText(input.health.reasonCode) || undefined,
    actionHint,
  };
}
