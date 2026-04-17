import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteConnectorOption,
  RuntimeRouteLocalOption,
  RuntimeRouteOptionsSnapshot,
} from './runtime-route.js';

function normalizeCapabilityAlias(value: string): RuntimeCanonicalCapability | null {
  if (value === 'chat') return 'text.generate';
  if (value === 'embedding') return 'text.embed';
  if (value === 'image') return 'image.generate';
  if (value === 'video') return 'video.generate';
  if (value === 'world') return 'world.generate';
  if (value === 'tts') return 'audio.synthesize';
  if (value === 'stt' || value === 'speech.transcribe') return 'audio.transcribe';
  if (value === 'music') return 'music.generate';
  return null;
}

function isCanonicalLocalEngine(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'llama'
    || normalized === 'media'
    || normalized === 'speech'
    || normalized === 'sidecar';
}

function inferCanonicalLocalEngine(
  capability: RuntimeCanonicalCapability,
  engineLike: unknown,
  runtimeDefaultEngine: unknown,
): string | undefined {
  const normalizedEngineLike = String(engineLike || '').trim().toLowerCase();
  if (isCanonicalLocalEngine(normalizedEngineLike)) {
    return normalizedEngineLike;
  }
  const normalizedDefault = String(runtimeDefaultEngine || '').trim().toLowerCase();
  if (isCanonicalLocalEngine(normalizedDefault)) {
    return normalizedDefault;
  }
  if (capability === 'image.generate' || capability === 'video.generate') {
    return 'media';
  }
  if (
    capability === 'audio.synthesize'
    || capability === 'audio.transcribe'
    || capability === 'voice_workflow.tts_v2v'
    || capability === 'voice_workflow.tts_t2v'
  ) {
    return 'speech';
  }
  return 'llama';
}

function firstAvailableBinding(
  localModels: RuntimeRouteLocalOption[],
  connectors: RuntimeRouteConnectorOption[],
): RuntimeRouteBinding | null {
  if (localModels.length > 0) {
    const firstLocal = localModels[0]!;
    return {
      source: 'local',
      connectorId: '',
      model: firstLocal.model,
      modelId: firstLocal.modelId,
      localModelId: firstLocal.localModelId,
      provider: firstLocal.provider,
      engine: firstLocal.engine,
      adapter: firstLocal.adapter,
      providerHints: firstLocal.providerHints,
      endpoint: firstLocal.endpoint,
      goRuntimeLocalModelId: firstLocal.goRuntimeLocalModelId,
      goRuntimeStatus: firstLocal.goRuntimeStatus,
    };
  }
  for (const connector of connectors) {
    const model = String(connector.models[0] || '').trim();
    if (!model) {
      continue;
    }
    return {
      source: 'cloud',
      connectorId: connector.id,
      model,
      provider: String(connector.provider || '').trim() || undefined,
    };
  }
  return null;
}

function toLocalBinding(option: RuntimeRouteLocalOption): RuntimeRouteBinding {
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
      return toLocalBinding(byLocalModelId);
    }
  }

  const targetModelId = String(binding.modelId || binding.model || '').trim();
  const byModelId = localModels.find((item) => String(item.modelId || item.model || '').trim() === targetModelId) || null;
  if (byModelId) {
    return toLocalBinding(byModelId);
  }

  return {
    ...binding,
    model: String(binding.model || binding.modelId || '').trim(),
    modelId: String(binding.modelId || binding.model || '').trim() || undefined,
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

export function normalizeRuntimeRouteCapabilityToken(value: unknown): RuntimeCanonicalCapability | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'text.generate'
    || normalized === 'text.embed'
    || normalized === 'image.generate'
    || normalized === 'video.generate'
    || normalized === 'world.generate'
    || normalized === 'audio.synthesize'
    || normalized === 'audio.transcribe'
    || normalized === 'music.generate'
    || normalized === 'voice_workflow.tts_v2v'
    || normalized === 'voice_workflow.tts_t2v'
  ) {
    return normalized;
  }
  return normalizeCapabilityAlias(normalized);
}

export function runtimeRouteModelSupportsCapability(
  capabilities: string[] | undefined,
  capability: RuntimeCanonicalCapability,
): boolean {
  return (capabilities || []).some((item) => normalizeRuntimeRouteCapabilityToken(item) === capability);
}

export function runtimeRouteLocalKindSupportsCapability(
  kind: string | null | undefined,
  capability: RuntimeCanonicalCapability,
): boolean {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  if (!normalizedKind) {
    return false;
  }
  if (capability === 'text.generate' && normalizedKind === 'chat') {
    return true;
  }
  if (capability === 'text.embed' && normalizedKind === 'embedding') {
    return true;
  }
  if (capability === 'image.generate' && normalizedKind === 'image') {
    return true;
  }
  if (capability === 'video.generate' && normalizedKind === 'video') {
    return true;
  }
  if (capability === 'audio.synthesize' && normalizedKind === 'tts') {
    return true;
  }
  if (capability === 'audio.transcribe' && normalizedKind === 'stt') {
    return true;
  }
  return false;
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
    if (String(matchedLocalModel.localModelId || '').trim() || localModels.some((item) => bindingKey(toLocalBinding(item)) === bindingKey(matchedLocalModel))) {
      const exactLocal = localModels.find((item) => bindingKey(toLocalBinding(item)) === bindingKey(matchedLocalModel)) || null;
      if (exactLocal) {
        return toLocalBinding(exactLocal);
      }
    }
    const engine = inferCanonicalLocalEngine(
      input.capability,
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

export function buildRuntimeRouteOptionsSnapshot(input: {
  capability: RuntimeCanonicalCapability;
  selectedBinding?: RuntimeRouteBinding | null;
  selectedOverride?: RuntimeRouteBinding | null;
  localModels: RuntimeRouteLocalOption[];
  connectors: RuntimeRouteConnectorOption[];
  defaultLocalEndpoint?: string;
  localMetadataDegraded?: boolean;
  runtimeDefaultEngine?: string;
}): RuntimeRouteOptionsSnapshot {
  const selected = input.selectedOverride === undefined
    ? buildRuntimeRouteSelectedBinding({
      capability: input.capability,
      selectedBinding: input.selectedBinding,
      localModels: input.localModels,
      connectors: input.connectors,
      localMetadataDegraded: input.localMetadataDegraded,
      runtimeDefaultEngine: input.runtimeDefaultEngine,
    })
    : input.selectedOverride;
  const fallback = firstAvailableBinding(input.localModels, input.connectors);
  const resolvedDefault = (input.localMetadataDegraded && selected?.source === 'local')
    ? selected
    : (fallback || selected || undefined);

  return {
    capability: input.capability,
    selected,
    resolvedDefault,
    local: {
      models: input.localModels,
      defaultEndpoint: String(input.defaultLocalEndpoint || '').trim() || undefined,
    },
    connectors: input.connectors,
  };
}
