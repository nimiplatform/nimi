import {
  normalizeCapabilityV11,
  normalizeSourceV11,
  vendorToAdapterFamily,
  vendorToProviderPrefix,
  type CapabilityV11,
  type RuntimeConfigStateV11,
  type SourceIdV11,
} from './v11/types';
import {
  loadRuntimeConfigStateV11,
  type RuntimeConfigSeedV11,
} from './v11/storage';
import {
  RuntimeRouteResolutionError,
  throwRouteError,
  type RuntimeRouteResolutionErrorCode,
} from './routing/errors';

export type { RuntimeRouteResolutionErrorCode };
export { RuntimeRouteResolutionError };

type ResolvedRuntimeCapabilityConfigBaseV11 = {
  provider: string;
  runtimeModelType: CapabilityV11;
  model: string;
  endpoint: string;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter' | string;
  providerHints?: RuntimeConfigStateV11['localRuntime']['nodeMatrix'][number]['providerHints'];
  policyGate?: string;
  localOpenAiEndpoint: string;
  localOpenAiApiKey: string;
  localProviderEndpoint: string;
  localProviderModel: string;
};

export type ResolvedLocalRuntimeCapabilityConfigV11 = ResolvedRuntimeCapabilityConfigBaseV11 & {
  source: 'local-runtime';
  connectorId: '';
  localModelId: string;
  engine: string;
};

export type ResolvedTokenApiCapabilityConfigV11 = ResolvedRuntimeCapabilityConfigBaseV11 & {
  source: 'token-api';
  connectorId: string;
};

export type ResolvedRuntimeCapabilityConfigV11 =
  | ResolvedLocalRuntimeCapabilityConfigV11
  | ResolvedTokenApiCapabilityConfigV11;

type RuntimeRouteOverrideInput = {
  source?: SourceIdV11;
  connectorId?: string;
  model?: string;
  localModelId?: string;
  engine?: string;
};

function normalizeRuntimeProvider(value: unknown): 'localai' | 'nexa' | string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'localai';
  if (normalized === 'nexa' || normalized.startsWith('nexa-')) return 'nexa';
  return normalized === 'localai' ? 'localai' : normalized;
}

function providerFromEngine(engine: unknown): 'localai' | 'nexa' | string {
  const normalized = String(engine || '').trim().toLowerCase();
  if (normalized.startsWith('openai') || normalized.includes('openai-compatible')) {
    return 'localai';
  }
  return normalizeRuntimeProvider(normalized);
}

function providerPriority(
  nodeProvider: unknown,
  preferredProvider: string,
): number {
  const normalized = normalizeRuntimeProvider(nodeProvider);
  if (normalized === preferredProvider) return 0;
  return 1;
}

function compareNodeMatrixRows(
  left: RuntimeConfigStateV11['localRuntime']['nodeMatrix'][number],
  right: RuntimeConfigStateV11['localRuntime']['nodeMatrix'][number],
  preferredProvider: string,
): number {
  const availabilityRank = Number(Boolean(right.available)) - Number(Boolean(left.available));
  if (availabilityRank !== 0) return availabilityRank;

  const providerRank = providerPriority(left.provider, preferredProvider) - providerPriority(right.provider, preferredProvider);
  if (providerRank !== 0) return providerRank;

  return [
    String(left.serviceId || '').localeCompare(String(right.serviceId || '')),
    String(left.nodeId || '').localeCompare(String(right.nodeId || '')),
    String(left.adapter || '').localeCompare(String(right.adapter || '')),
    String(left.backend || '').localeCompare(String(right.backend || '')),
  ].find((value) => value !== 0) || 0;
}

function hasLocalCapabilityModel(state: RuntimeConfigStateV11, capability: CapabilityV11): boolean {
  const hasModel = state.localRuntime.models.some((model) => model.capabilities.includes(capability));
  const hasAvailableNode = (state.localRuntime.nodeMatrix || []).some((row) => (
    row.capability === capability && row.available
  ));
  return hasModel && hasAvailableNode;
}

function resolvePreferredSource(
  state: RuntimeConfigStateV11,
  capability: CapabilityV11,
  overrideSource?: SourceIdV11,
): SourceIdV11 {
  if (overrideSource === 'token-api' || overrideSource === 'local-runtime') {
    return overrideSource;
  }
  return hasLocalCapabilityModel(state, capability) ? 'local-runtime' : 'token-api';
}

function resolveLocalRuntimeCapabilityConfig(input: {
  state: RuntimeConfigStateV11;
  seed: RuntimeConfigSeedV11;
  capability: CapabilityV11;
  override: RuntimeRouteOverrideInput;
}): ResolvedRuntimeCapabilityConfigV11 {
  const localRuntime = input.state.localRuntime;
  const explicitLocalModelId = String(input.override.localModelId || '').trim();
  const explicitModel = String(input.override.model || '').trim();

  let modelEntry: RuntimeConfigStateV11['localRuntime']['models'][number] | null = null;
  if (explicitLocalModelId) {
    modelEntry = localRuntime.models.find((item) => item.localModelId === explicitLocalModelId) || null;
  }

  if (!modelEntry && explicitModel) {
    modelEntry = localRuntime.models.find((item) => item.model === explicitModel && item.capabilities.includes(input.capability))
      || localRuntime.models.find((item) => item.model === explicitModel)
      || null;
  }

  if (!modelEntry) {
    modelEntry = localRuntime.models.find((item) => item.capabilities.includes(input.capability))
      || localRuntime.models[0]
      || null;
  }

  if (!modelEntry) {
    throwRouteError(
      'RUNTIME_ROUTE_MODEL_MISSING',
      `Local runtime model is missing for capability: ${input.capability}`,
    );
  }

  if (!modelEntry.capabilities.includes(input.capability)) {
    throwRouteError(
      'RUNTIME_ROUTE_CAPABILITY_MISMATCH',
      `Local runtime model capability mismatch: model=${modelEntry.localModelId}, required=${input.capability}`,
    );
  }

  const preferredProvider = providerFromEngine(input.override.engine || modelEntry.engine);
  const capabilityNodes = (localRuntime.nodeMatrix || [])
    .filter((row) => row.capability === input.capability)
    .sort((left, right) => compareNodeMatrixRows(left, right, preferredProvider));
  const providerMatchedNodes = capabilityNodes
    .filter((row) => normalizeRuntimeProvider(row.provider) === preferredProvider);
  const candidateNodes = providerMatchedNodes.length > 0
    ? providerMatchedNodes
    : capabilityNodes;
  const availableNode = candidateNodes.find((row) => row.available) || null;
  if (!availableNode) {
    const unavailable = candidateNodes[0] || null;
    throwRouteError(
      'RUNTIME_ROUTE_CAPABILITY_MISSING',
      unavailable?.reasonCode
        ? `Local runtime capability unavailable: ${unavailable.reasonCode}${unavailable.policyGate ? ` policyGate=${unavailable.policyGate}` : ''}`
        : `Local runtime capability unavailable: ${input.capability}`,
      {
        reasonCode: unavailable?.reasonCode || 'LOCAL_AI_CAPABILITY_MISSING',
        policyGate: unavailable?.policyGate || null,
        provider: unavailable?.provider || preferredProvider,
        nodeId: unavailable?.nodeId || null,
        providerHints: unavailable?.providerHints || null,
      },
    );
  }

  const connector = input.state.connectors.find((item) => item.id === input.state.selectedConnectorId)
    || input.state.connectors[0]
    || null;

  const model = explicitModel || String(modelEntry.model || '').trim();
  if (!model) {
    throwRouteError(
      'RUNTIME_ROUTE_MODEL_MISSING',
      `Local runtime model is missing for capability: ${input.capability}`,
    );
  }

  const localProviderEndpoint = String(
    modelEntry.endpoint
    || localRuntime.endpoint
    || input.seed.localProviderEndpoint,
  ).trim();
  const localOpenAiEndpoint = String(
    connector?.endpoint
    || input.seed.localOpenAiEndpoint
    || localProviderEndpoint,
  ).trim();
  const providerHints = availableNode.providerHints || (
    normalizeRuntimeProvider(availableNode.provider) === 'nexa'
      ? {
        nexa: {
          backend: availableNode.backend,
          preferredAdapter: availableNode.adapter,
          policyGate: availableNode.policyGate,
        },
      }
      : {
        localai: {
          backend: availableNode.backend,
          preferredAdapter: availableNode.adapter,
        },
      }
  );

  return {
    provider: `local-runtime:${normalizeRuntimeProvider(availableNode.provider)}:${availableNode.adapter}:${model}`,
    runtimeModelType: input.capability,
    source: 'local-runtime',
    model,
    adapter: availableNode.adapter,
    providerHints,
    policyGate: availableNode.policyGate,
    connectorId: '',
    endpoint: localProviderEndpoint,
    localOpenAiEndpoint,
    localOpenAiApiKey: String(connector?.tokenApiKey || input.seed.localOpenAiApiKey || '').trim(),
    localProviderEndpoint,
    localProviderModel: model,
    localModelId: String(modelEntry.localModelId || ''),
    engine: String(input.override.engine || modelEntry.engine || 'localai'),
  };
}

function resolveTokenApiCapabilityConfig(input: {
  state: RuntimeConfigStateV11;
  seed: RuntimeConfigSeedV11;
  capability: CapabilityV11;
  override: RuntimeRouteOverrideInput;
}): ResolvedRuntimeCapabilityConfigV11 {
  const connectorId = String(input.override.connectorId || '').trim();
  const connector = input.state.connectors.find((item) => item.id === connectorId)
    || input.state.connectors.find((item) => item.id === input.state.selectedConnectorId)
    || input.state.connectors[0]
    || null;
  if (!connector) {
    throwRouteError(
      'RUNTIME_ROUTE_CONNECTOR_MISSING',
      `Token API connector is missing for capability: ${input.capability}`,
    );
  }

  const token = String(connector.tokenApiKey || '').trim();

  const connectorModels = connector.models
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const overrideModel = String(input.override.model || '').trim();
  const overrideModelMatched = overrideModel && (
    connectorModels.length === 0
    || connectorModels.includes(overrideModel)
    || connectorModels.some((m) => m.endsWith(`/${overrideModel}`))
  );
  const model = overrideModelMatched
    ? overrideModel
    : String(connectorModels[0] || '').trim();

  if (!model) {
    throwRouteError(
      'RUNTIME_ROUTE_MODEL_MISSING',
      `Token API model is missing for capability: ${input.capability}`,
    );
  }

  const fallbackLocal = input.state.localRuntime.models.find((item) => item.capabilities.includes(input.capability))
    || input.state.localRuntime.models[0]
    || null;
  const localProviderEndpoint = String(
    fallbackLocal?.endpoint
    || input.state.localRuntime.endpoint
    || input.seed.localProviderEndpoint,
  ).trim();
  const localProviderModel = String(fallbackLocal?.model || model).trim();

  const prefix = vendorToProviderPrefix(connector.vendor);
  const adapterFamily = vendorToAdapterFamily(connector.vendor);
  const adapter = adapterFamily === 'openai-compatible'
    ? 'openai_compat_adapter'
    : `${adapterFamily.replace(/-/g, '_')}_adapter`;

  return {
    provider: `${prefix}:${model}`,
    runtimeModelType: input.capability,
    source: 'token-api',
    model,
    adapter,
    connectorId: connector.id,
    endpoint: String(connector.endpoint || '').trim(),
    localOpenAiEndpoint: String(connector.endpoint || '').trim(),
    localOpenAiApiKey: token,
    localProviderEndpoint,
    localProviderModel,
  };
}

export function resolveRuntimeCapabilityConfigFromStateV11(
  state: RuntimeConfigStateV11,
  seed: RuntimeConfigSeedV11,
  capabilityInput: CapabilityV11,
  options?: {
    modId?: string;
    routeOverride?: RuntimeRouteOverrideInput;
  },
): ResolvedRuntimeCapabilityConfigV11 {
  const capability = normalizeCapabilityV11(capabilityInput);
  void options?.modId;

  const normalizedOverrideSource = options?.routeOverride?.source === 'token-api'
    || options?.routeOverride?.source === 'local-runtime'
    ? normalizeSourceV11(options.routeOverride.source)
    : undefined;

  const override: RuntimeRouteOverrideInput = {
    source: normalizedOverrideSource,
    connectorId: String(options?.routeOverride?.connectorId || '').trim() || undefined,
    model: String(options?.routeOverride?.model || '').trim() || undefined,
    localModelId: String(options?.routeOverride?.localModelId || '').trim() || undefined,
    engine: String(options?.routeOverride?.engine || '').trim() || undefined,
  };

  const preferredSource = resolvePreferredSource(state, capability, override.source);
  if (preferredSource === 'local-runtime') {
    return resolveLocalRuntimeCapabilityConfig({
      state,
      seed,
      capability,
      override,
    });
  }

  return resolveTokenApiCapabilityConfig({
    state,
    seed,
    capability,
    override,
  });
}

export function resolveRuntimeCapabilityConfigFromV11(
  seed: RuntimeConfigSeedV11,
  capabilityInput: CapabilityV11,
  options?: {
    modId?: string;
    routeOverride?: RuntimeRouteOverrideInput;
  },
): ResolvedRuntimeCapabilityConfigV11 {
  const state = loadRuntimeConfigStateV11(seed);
  return resolveRuntimeCapabilityConfigFromStateV11(state, seed, capabilityInput, options);
}
