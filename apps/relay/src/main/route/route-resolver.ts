// Binding resolver — converts RelayRouteBinding + options → ResolvedRelayRoute

import type {
  RelayRouteBinding,
  RelayRouteOptions,
  ResolvedRelayRoute,
} from './types.js';

export function resolveRelayRoute(
  binding: RelayRouteBinding | null,
  options: RelayRouteOptions,
): ResolvedRelayRoute | null {
  // No binding: try first available local model, then first connector model
  if (!binding) {
    return resolveDefault(options);
  }

  if (binding.source === 'local') {
    return resolveLocal(binding, options);
  }

  if (binding.source === 'cloud') {
    return resolveCloud(binding, options);
  }

  return resolveDefault(options);
}

function resolveLocal(
  binding: RelayRouteBinding,
  options: RelayRouteOptions,
): ResolvedRelayRoute | null {
  const localModels = options.local.models;

  // Try to match by localModelId
  if (binding.localModelId) {
    const match = localModels.find((m) => m.localModelId === binding.localModelId);
    if (match) {
      return {
        source: 'local',
        model: `local/${match.modelId}`,
        localModelId: match.localModelId,
      };
    }
  }

  // Try to match by model name
  if (binding.model) {
    const modelName = binding.model.replace(/^local\//, '');
    const match = localModels.find(
      (m) => m.modelId === modelName || m.localModelId === modelName,
    );
    if (match) {
      return {
        source: 'local',
        model: `local/${match.modelId}`,
        localModelId: match.localModelId,
      };
    }
  }

  // Fallback to first available local model
  if (localModels.length > 0) {
    const first = localModels[0]!;
    return {
      source: 'local',
      model: `local/${first.modelId}`,
      localModelId: first.localModelId,
    };
  }

  // No local models — fail closed. User explicitly chose local source;
  // do not silently fallback to cloud (fallback hardcut).
  return null;
}

function resolveCloud(
  binding: RelayRouteBinding,
  options: RelayRouteOptions,
): ResolvedRelayRoute | null {
  const connectors = options.connectors;

  // Find matching connector
  if (binding.connectorId) {
    const connector = connectors.find((c) => c.connectorId === binding.connectorId);
    if (connector) {
      const model = binding.model || connector.models[0]?.modelId;
      if (model) {
        return {
          source: 'cloud',
          model: `${connector.provider}/${model}`,
          connectorId: connector.connectorId,
          provider: connector.provider,
        };
      }
    }
  }

  // Fallback to first connector with models
  for (const c of connectors) {
    if (c.models.length > 0) {
      return {
        source: 'cloud',
        model: `${c.provider}/${c.models[0]!.modelId}`,
        connectorId: c.connectorId,
        provider: c.provider,
      };
    }
  }

  // No cloud connectors — fail closed. User explicitly chose cloud source;
  // do not silently fallback to local (fallback hardcut).
  return null;
}

function resolveDefault(options: RelayRouteOptions): ResolvedRelayRoute | null {
  // Prefer local
  if (options.local.models.length > 0) {
    const first = options.local.models[0]!;
    return {
      source: 'local',
      model: `local/${first.modelId}`,
      localModelId: first.localModelId,
    };
  }

  return resolveCloudFallback(options);
}

function resolveCloudFallback(options: RelayRouteOptions): ResolvedRelayRoute | null {
  for (const c of options.connectors) {
    if (c.models.length > 0) {
      return {
        source: 'cloud',
        model: `${c.provider}/${c.models[0]!.modelId}`,
        connectorId: c.connectorId,
        provider: c.provider,
      };
    }
  }
  return null;
}
