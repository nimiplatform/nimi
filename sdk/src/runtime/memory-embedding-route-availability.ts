import type {
  MemoryEmbeddingBindingRef,
  MemoryEmbeddingConfig,
  MemoryEmbeddingSourceKind,
} from './memory-embedding-config.js';
import type { RuntimeRouteOptionsSnapshot } from './runtime-route-core.js';

export type MemoryEmbeddingRouteAvailabilityState =
  | 'unconfigured'
  | 'ready'
  | 'unavailable';

export type MemoryEmbeddingRouteAvailabilityReason =
  | 'binding_missing'
  | 'source_binding_mismatch'
  | 'route_options_unavailable'
  | 'route_options_capability_mismatch'
  | 'cloud_model_available'
  | 'cloud_model_unavailable'
  | 'local_model_active'
  | 'local_model_unavailable';

export type MemoryEmbeddingRouteAvailabilityProjection = {
  readonly state: MemoryEmbeddingRouteAvailabilityState;
  readonly reason: MemoryEmbeddingRouteAvailabilityReason;
  readonly sourceKind: MemoryEmbeddingSourceKind | null;
  readonly bindingRef: MemoryEmbeddingBindingRef | null;
};

function memoryEmbeddingTargetMatches(candidate: unknown, targetId: string): boolean {
  return String(candidate || '').trim() === targetId;
}

/**
 * Project whether a host-owned memory embedding binding intent is present in
 * the SDK route-options snapshot. This does not resolve Runtime memory bank
 * truth; canonical bind/cutover readiness remains Runtime/Cognition-owned.
 */
export function projectMemoryEmbeddingRouteAvailability(input: {
  readonly config: MemoryEmbeddingConfig;
  readonly routeOptions?: RuntimeRouteOptionsSnapshot | null;
}): MemoryEmbeddingRouteAvailabilityProjection {
  const sourceKind = input.config.sourceKind;
  const bindingRef = input.config.bindingRef;
  if (!sourceKind || !bindingRef) {
    return {
      state: 'unconfigured',
      reason: 'binding_missing',
      sourceKind: null,
      bindingRef: null,
    };
  }
  if (sourceKind !== bindingRef.kind) {
    return {
      state: 'unavailable',
      reason: 'source_binding_mismatch',
      sourceKind,
      bindingRef,
    };
  }
  const routeOptions = input.routeOptions;
  if (!routeOptions) {
    return {
      state: 'unavailable',
      reason: 'route_options_unavailable',
      sourceKind,
      bindingRef,
    };
  }
  if (String(routeOptions.capability || '').trim() !== 'text.embed') {
    return {
      state: 'unavailable',
      reason: 'route_options_capability_mismatch',
      sourceKind,
      bindingRef,
    };
  }
  if (bindingRef.kind === 'cloud') {
    const connector = routeOptions.connectors.find((item) => item.id === bindingRef.connectorId);
    const available = Boolean(connector?.models.includes(bindingRef.modelId));
    return {
      state: available ? 'ready' : 'unavailable',
      reason: available ? 'cloud_model_available' : 'cloud_model_unavailable',
      sourceKind,
      bindingRef,
    };
  }
  const targetId = bindingRef.targetId.trim();
  const model = routeOptions.local.models.find((item) =>
    memoryEmbeddingTargetMatches(item.model, targetId)
    || memoryEmbeddingTargetMatches(item.modelId, targetId)
    || memoryEmbeddingTargetMatches(item.localModelId, targetId));
  const active = String(model?.status || '').trim().toLowerCase() === 'active';
  return {
    state: active ? 'ready' : 'unavailable',
    reason: active ? 'local_model_active' : 'local_model_unavailable',
    sourceKind,
    bindingRef,
  };
}
