import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteConnectorOption,
  RuntimeRouteLocalOption,
  RuntimeRouteModelProfile,
  RuntimeRouteOptionsSnapshot,
} from './runtime-route-core.js';
import {
  normalizeRuntimeRouteModelRoot,
} from './runtime-route-core.js';
import {
  inferCanonicalLocalEngine,
  isCanonicalLocalEngine,
} from './runtime-route-options-local.js';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isRuntimeRouteLocalOptionSelectable(option: RuntimeRouteLocalOption): boolean {
  return Boolean(String(option.localModelId || '').trim())
    && String(option.status || '').trim().toLowerCase() !== 'removed';
}

export function runtimeRouteLocalOptionToBinding(
  option: RuntimeRouteLocalOption,
  input?: {
    defaultEndpoint?: string;
  },
): RuntimeRouteBinding {
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
    endpoint: String(option.endpoint || input?.defaultEndpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(option.goRuntimeLocalModelId || '').trim() || undefined,
    goRuntimeStatus: String(option.goRuntimeStatus || '').trim() || undefined,
  };
}

export function findRuntimeRouteModelProfile(
  snapshot: RuntimeRouteOptionsSnapshot | null | undefined,
  binding: RuntimeRouteBinding | null | undefined,
): RuntimeRouteModelProfile | null {
  if (!snapshot || !binding) {
    return null;
  }
  if (
    Number.isFinite(Number(binding.maxContextTokens))
    || Number.isFinite(Number(binding.maxOutputTokens))
  ) {
    return {
      model: normalizeText(binding.modelId) || normalizeText(binding.model),
      ...(Number.isFinite(Number(binding.maxContextTokens)) && Number(binding.maxContextTokens) > 0
        ? { maxContextTokens: Math.floor(Number(binding.maxContextTokens)) }
        : {}),
      ...(Number.isFinite(Number(binding.maxOutputTokens)) && Number(binding.maxOutputTokens) > 0
        ? { maxOutputTokens: Math.floor(Number(binding.maxOutputTokens)) }
        : {}),
    };
  }
  if (binding.source !== 'cloud') {
    return null;
  }
  const connector = snapshot.connectors.find((item) => (
    normalizeText(item.id) === normalizeText(binding.connectorId)
  )) || null;
  if (!connector) {
    return null;
  }
  const targetModel = normalizeText(binding.modelId) || normalizeText(binding.model);
  if (!targetModel) {
    return null;
  }
  return connector.modelProfiles?.find((profile) => (
    normalizeText(profile.model) === targetModel
  )) || null;
}

function routeBindingModelToken(binding: RuntimeRouteBinding): string {
  return normalizeText(binding.modelId) || normalizeText(binding.model);
}

export function runtimeRouteBindingsMatch(
  left: RuntimeRouteBinding | null | undefined,
  right: RuntimeRouteBinding | null | undefined,
): boolean {
  if (!left || !right || left.source !== right.source) {
    return false;
  }
  if (left.source === 'local') {
    const leftLocalModelId = normalizeText(left.localModelId);
    const rightLocalModelId = normalizeText(right.localModelId);
    if (leftLocalModelId && rightLocalModelId) {
      return leftLocalModelId === rightLocalModelId;
    }
    const leftModel = routeBindingModelToken(left);
    const rightModel = routeBindingModelToken(right);
    return Boolean(leftModel && rightModel && leftModel === rightModel);
  }
  const leftConnectorId = normalizeText(left.connectorId);
  const rightConnectorId = normalizeText(right.connectorId);
  const leftModel = routeBindingModelToken(left);
  const rightModel = routeBindingModelToken(right);
  return Boolean(
    leftConnectorId
    && rightConnectorId
    && leftConnectorId === rightConnectorId
    && leftModel
    && rightModel
    && leftModel === rightModel,
  );
}

function bindingKey(input: RuntimeRouteBinding | null | undefined): string {
  if (!input) {
    return '';
  }
  return [
    String(input.source || '').trim(),
    String(input.connectorId || '').trim(),
    String(input.modelId || input.model || '').trim(),
    String(input.localModelId || '').trim(),
    String(input.engine || '').trim(),
  ].join('|');
}

function hydrateSelectedLocalBinding(
  binding: RuntimeRouteBinding,
  localModels: RuntimeRouteLocalOption[],
): RuntimeRouteBinding {
  const bindingLocalModelId = String(binding.localModelId || '').trim();
  if (bindingLocalModelId) {
    const byLocalModelId = localModels.find((item) => String(item.localModelId || '').trim() === bindingLocalModelId) || null;
    if (byLocalModelId) {
      return runtimeRouteLocalOptionToBinding(byLocalModelId);
    }
  }

  const targetModelId = String(binding.modelId || binding.model || '').trim();
  const byModelId = localModels.find((item) => String(item.modelId || item.model || '').trim() === targetModelId) || null;
  if (byModelId) {
    return runtimeRouteLocalOptionToBinding(byModelId);
  }

  return {
    ...binding,
    model: normalizeRuntimeRouteModelRoot(binding.model || binding.modelId || '') || String(binding.model || binding.modelId || '').trim(),
    modelId: normalizeRuntimeRouteModelRoot(binding.modelId || binding.model || '') || undefined,
  };
}

function hydrateSelectedCloudBinding(
  binding: RuntimeRouteBinding,
  connectors: RuntimeRouteConnectorOption[],
): RuntimeRouteBinding {
  const exactMatch = connectors
    .flatMap((connector) => connector.models.map((model) => ({
      source: 'cloud' as const,
      connectorId: connector.id,
      model,
      provider: String(connector.provider || '').trim() || undefined,
    })))
    .find((item) => bindingKey(item) === bindingKey(binding)) || null;
  if (exactMatch) {
    return exactMatch;
  }

  const connector = connectors.find((item) => item.id === binding.connectorId) || null;
  if (!connector) {
    return {
      ...binding,
      connectorId: String(binding.connectorId || '').trim(),
      model: String(binding.model || binding.modelId || '').trim(),
    };
  }

  return {
    ...binding,
    connectorId: String(binding.connectorId || '').trim(),
    model: String(binding.model || binding.modelId || '').trim(),
    provider: String(binding.provider || connector.provider || '').trim() || undefined,
  };
}

export function buildRuntimeRouteSelectedBinding(input: {
  capability: RuntimeCanonicalCapability;
  selectedBinding?: RuntimeRouteBinding | null;
  localModels: RuntimeRouteLocalOption[];
  connectors: RuntimeRouteConnectorOption[];
  localMetadataDegraded?: boolean;
  runtimeDefaultEngine?: string;
}): RuntimeRouteBinding | null {
  const {
    selectedBinding,
    localModels,
    connectors,
    localMetadataDegraded,
    runtimeDefaultEngine,
  } = input;

  if (selectedBinding?.source === 'local') {
    const matchedLocalModel = hydrateSelectedLocalBinding(selectedBinding, localModels);
    const matchedKey = bindingKey(matchedLocalModel);
    const exactLocal = localModels.find((item) => bindingKey(runtimeRouteLocalOptionToBinding(item)) === matchedKey) || null;
    if (String(matchedLocalModel.localModelId || '').trim() || exactLocal) {
      if (exactLocal) {
        return runtimeRouteLocalOptionToBinding(exactLocal);
      }
    }
    const engine = inferCanonicalLocalEngine(
      matchedLocalModel.engine || matchedLocalModel.provider,
      runtimeDefaultEngine,
    );
    return {
      ...matchedLocalModel,
      provider: isCanonicalLocalEngine(matchedLocalModel.provider)
        ? String(matchedLocalModel.provider || '').trim()
        : engine,
      engine,
      goRuntimeStatus: String(matchedLocalModel.goRuntimeStatus || '').trim()
        || (localMetadataDegraded ? 'degraded' : 'unavailable'),
    };
  }

  if (selectedBinding?.source === 'cloud') {
    return hydrateSelectedCloudBinding(selectedBinding, connectors);
  }

  return null;
}
