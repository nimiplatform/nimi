import { CAPABILITIES, type CapabilityId, type ImageResponseFormatMode } from './tester-types.js';
import { asString } from './tester-utils.js';
import type { RuntimeCanonicalCapability, RuntimeRouteBinding, RuntimeRouteOptionsSnapshot, RuntimeRouteSource } from '@nimiplatform/sdk/mod';

export function routeCapabilityFor(capabilityId: CapabilityId): RuntimeCanonicalCapability | null {
  return CAPABILITIES.find((item) => item.id === capabilityId)?.routeCapability || null;
}

export function linkedRouteCapabilityIds(capabilityId: CapabilityId): CapabilityId[] {
  const routeCapability = routeCapabilityFor(capabilityId);
  if (!routeCapability) {
    return [capabilityId];
  }
  return CAPABILITIES
    .filter((item) => item.routeCapability === routeCapability)
    .map((item) => item.id);
}

function hydrateTokenApiBinding(snapshot: RuntimeRouteOptionsSnapshot | null, binding: RuntimeRouteBinding | null): RuntimeRouteBinding | null {
  if (!snapshot || !binding || binding.source !== 'cloud') {
    return binding;
  }
  const connector = snapshot.connectors.find((item) => item.id === binding.connectorId) || null;
  if (!connector) {
    return binding;
  }
  return {
    ...binding,
    provider: asString(binding.provider || connector.provider) || undefined,
  };
}

export function ensureRouteOptionsSnapshotShape(snapshot: RuntimeRouteOptionsSnapshot | null): RuntimeRouteOptionsSnapshot | null {
  if (!snapshot) {
    return null;
  }
  return {
    ...snapshot,
    local: {
      models: snapshot.local?.models || [],
      defaultEndpoint: snapshot.local?.defaultEndpoint,
    },
    connectors: Array.isArray(snapshot.connectors) ? snapshot.connectors : [],
  };
}

export function normalizeLocalRuntimeModelRoot(value: unknown): string {
  const trimmed = asString(value);
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('media/')) return trimmed.slice('media/'.length).trim();
  if (lower.startsWith('local/')) return trimmed.slice('local/'.length).trim();
  return trimmed;
}

export function localBindingFromOption(option: RuntimeRouteOptionsSnapshot['local']['models'][number]): RuntimeRouteBinding {
  const modelId = asString(option.modelId || option.model);
  return {
    source: 'local',
    connectorId: '',
    model: modelId,
    modelId: modelId || undefined,
    provider: asString(option.provider || option.engine) || undefined,
    localModelId: asString(option.localModelId) || undefined,
    engine: asString(option.engine) || undefined,
    adapter: asString(option.adapter) || undefined,
    endpoint: asString(option.endpoint) || undefined,
    goRuntimeLocalModelId: asString(option.goRuntimeLocalModelId) || undefined,
    goRuntimeStatus: asString(option.goRuntimeStatus) || undefined,
    ...(option.providerHints ? { providerHints: option.providerHints } : {}),
  };
}

export function hydrateLocalRuntimeBinding(snapshot: RuntimeRouteOptionsSnapshot | null, binding: RuntimeRouteBinding | null): RuntimeRouteBinding | null {
  if (!snapshot || !binding || binding.source !== 'local') {
    return binding;
  }
  const normalizedLocalModelId = asString(binding.localModelId);
  const normalizedModelId = normalizeLocalRuntimeModelRoot(binding.modelId || binding.model);
  const localModel = (snapshot.local?.models || []).find((item) =>
    ((normalizedLocalModelId && asString(item.localModelId) === normalizedLocalModelId)
      || (normalizeLocalRuntimeModelRoot(item.modelId || item.model) === normalizedModelId))
  ) || null;
  if (!localModel) {
    return {
      ...binding,
      model: normalizedModelId || asString(binding.model),
      modelId: normalizedModelId || undefined,
    };
  }
  const authoritativeModelId = asString(localModel.modelId || localModel.model);
  const effectiveModelId = normalizeLocalRuntimeModelRoot(authoritativeModelId) === normalizedModelId && normalizedModelId
    ? normalizedModelId
    : authoritativeModelId;
  return {
    ...localBindingFromOption(localModel),
    model: effectiveModelId,
    modelId: effectiveModelId || undefined,
    localModelId: asString(binding.localModelId || localModel.localModelId) || undefined,
  };
}

export function resolveEffectiveBinding(snapshot: RuntimeRouteOptionsSnapshot | null, binding: RuntimeRouteBinding | null): RuntimeRouteBinding | null {
  if (binding?.source === 'cloud') return hydrateTokenApiBinding(snapshot, binding);
  if (binding?.source === 'local') return hydrateLocalRuntimeBinding(snapshot, binding);
  if (!snapshot) return null;
  const fallback = snapshot.selected || snapshot.resolvedDefault || null;
  if (fallback?.source === 'local') {
    return hydrateLocalRuntimeBinding(snapshot, fallback);
  }
  return hydrateTokenApiBinding(snapshot, fallback);
}

export function cloudBindingForConnector(connector: RuntimeRouteOptionsSnapshot['connectors'][number], model: string): RuntimeRouteBinding {
  return {
    source: 'cloud',
    connectorId: connector.id,
    provider: asString(connector.provider) || undefined,
    model,
  };
}

export function bindingForSource(snapshot: RuntimeRouteOptionsSnapshot | null, source: RuntimeRouteSource): RuntimeRouteBinding | null {
  if (source === 'cloud') {
    const connector = snapshot?.connectors[0] || null;
    if (!connector) return null;
    return cloudBindingForConnector(connector, connector.models[0] || '');
  }
  const local = snapshot?.local?.models[0] || null;
  if (!local) return null;
  return localBindingFromOption(local);
}

export function bindingForConnector(snapshot: RuntimeRouteOptionsSnapshot | null, connectorId: string, current: RuntimeRouteBinding | null): RuntimeRouteBinding | null {
  const connector = snapshot?.connectors.find((item) => item.id === connectorId) || null;
  if (!connector) return null;
  const currentModel = current?.source === 'cloud' ? current.model : '';
  const model = connector.models.includes(currentModel) ? currentModel : (connector.models[0] || '');
  return cloudBindingForConnector(connector, model);
}

export function bindingForModel(snapshot: RuntimeRouteOptionsSnapshot | null, model: string, current: RuntimeRouteBinding | null): RuntimeRouteBinding | null {
  const normalizedModel = asString(model);
  if (!normalizedModel) return current;
  const effective = resolveEffectiveBinding(snapshot, current);
  if (!effective) return null;
  if (effective.source === 'cloud') {
    return {
      source: 'cloud',
      connectorId: effective.connectorId,
      provider: asString(effective.provider) || undefined,
      model: normalizedModel,
    };
  }
  const normalizedLocalModel = normalizeLocalRuntimeModelRoot(normalizedModel);
  const localModel = snapshot?.local?.models.find((item) =>
    (normalizeLocalRuntimeModelRoot(item.modelId || item.model) === normalizedLocalModel)
  ) || null;
  if (localModel) {
    return localBindingFromOption(localModel);
  }
  return {
    source: 'local',
    connectorId: '',
    model: normalizedLocalModel,
    modelId: normalizedLocalModel || undefined,
    provider: asString(effective.provider) || undefined,
    localModelId: asString(effective.localModelId) || undefined,
    engine: asString(effective.engine) || undefined,
    adapter: asString(effective.adapter) || undefined,
    endpoint: asString(effective.endpoint) || undefined,
    goRuntimeLocalModelId: asString(effective.goRuntimeLocalModelId) || undefined,
    goRuntimeStatus: asString(effective.goRuntimeStatus) || undefined,
    ...(effective.providerHints ? { providerHints: effective.providerHints } : {}),
  };
}

export function resolveImageResponseFormat(mode: ImageResponseFormatMode): 'base64' | 'url' | undefined {
  return mode === 'base64' || mode === 'url' ? mode : undefined;
}

export function resolveRouteModelPickerState(snapshot: RuntimeRouteOptionsSnapshot | null, binding: RuntimeRouteBinding | null): {
  effectiveBinding: RuntimeRouteBinding | null;
  activeSource: RuntimeRouteSource;
  activeConnectorId: string;
  activeModel: string;
  modelOptions: string[];
  cloudCatalogMissing: boolean;
  activeModelInOptions: boolean;
} {
  const effectiveBinding = resolveEffectiveBinding(snapshot, binding);
  const activeSource = effectiveBinding?.source || snapshot?.selected?.source || 'local';
  const activeConnectorId = effectiveBinding?.connectorId || snapshot?.selected?.connectorId || '';
  const activeConnector = snapshot?.connectors.find((item) => item.id === activeConnectorId) || null;
  const activeModel = activeSource === 'local'
    ? normalizeLocalRuntimeModelRoot(effectiveBinding?.modelId || effectiveBinding?.model || snapshot?.selected?.modelId || snapshot?.selected?.model || '')
    : (effectiveBinding?.model || snapshot?.selected?.model || '');
  const localModels = snapshot?.local?.models || [];
  const modelOptions = activeSource === 'local'
    ? localModels.map((item) => normalizeLocalRuntimeModelRoot(item.modelId || item.model))
    : (activeConnector?.models || []);
  return {
    effectiveBinding,
    activeSource,
    activeConnectorId,
    activeModel,
    modelOptions,
    cloudCatalogMissing: activeSource === 'cloud' && activeConnectorId.length > 0 && modelOptions.length === 0,
    activeModelInOptions: modelOptions.includes(activeModel),
  };
}
