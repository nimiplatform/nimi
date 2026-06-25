import { createNimiError } from '../types';
import {
  findNimiRuntimeTargetInventoryItem,
  normalizeNimiRuntimeRouteCapabilityToken,
  normalizeNimiRuntimeRouteTargetRef,
  runtimeNimiRouteCapabilitiesMatch,
  type NimiRuntimeCanonicalCapability,
  type NimiRuntimeRouteOptionsSnapshot,
  type NimiRuntimeRouteTargetRef,
  type NimiRuntimeTargetInventoryItem,
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

function routeMetadataRefFor(capability: NimiRuntimeCanonicalCapability, targetRef: NimiRuntimeRouteTargetRef): string {
  if (targetRef.kind === 'cloud-connector') {
    return [
      'route-metadata',
      'cloud',
      capability,
      encodeURIComponent(targetRef.connectorId),
      encodeURIComponent(targetRef.remoteModelCatalogId),
    ].join(':');
  }
  return [
    'route-metadata',
    'local',
    capability,
    encodeURIComponent(targetRef.profileBindingId || targetRef.readinessRef || ''),
  ].join(':');
}

function resolvedBindingRefFor(capability: NimiRuntimeCanonicalCapability, targetRef: NimiRuntimeRouteTargetRef): string {
  if (targetRef.kind === 'cloud-connector') {
    return [
      'cloud',
      capability,
      encodeURIComponent(targetRef.connectorId),
      encodeURIComponent(targetRef.remoteModelCatalogId),
      encodeURIComponent(targetRef.providerModelId),
    ].join(':');
  }
  return [
    'local',
    capability,
    encodeURIComponent(targetRef.profileBindingId || targetRef.readinessRef || ''),
  ].join(':');
}

function resolveCloudTarget(
  capability: NimiRuntimeCanonicalCapability,
  targetRef: NimiRuntimeRouteTargetRef,
  item: NimiRuntimeTargetInventoryItem,
): NimiRuntimeResolvedBinding {
  if (targetRef.kind !== 'cloud-connector' || item.evidence.source !== 'cloud-connector') {
    throw new Error('NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED');
  }
  const connectorId = normalizeText(item.evidence.connectorId || targetRef.connectorId);
  const remoteModelCatalogId = normalizeText(item.evidence.remoteModelCatalogId || targetRef.remoteModelCatalogId);
  const providerModelId = normalizeText(item.evidence.providerModelId || targetRef.providerModelId);
  const provider = normalizeText(item.evidence.provider || targetRef.provider || item.display.provider);
  if (!connectorId) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_CONNECTOR_REQUIRED');
  if (!remoteModelCatalogId) throw new Error('NIMI_RUNTIME_ROUTE_REMOTE_MODEL_CATALOG_REQUIRED');
  if (!providerModelId) throw new Error('NIMI_RUNTIME_ROUTE_PROVIDER_MODEL_REQUIRED');
  if (!provider) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED');
  return {
    capability,
    source: 'cloud-connector',
    targetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId,
      remoteModelCatalogId,
      providerModelId,
      provider,
    },
    resolvedBindingRef: resolvedBindingRefFor(capability, targetRef),
    routeMetadataRef: routeMetadataRefFor(capability, targetRef),
    connectorId,
    remoteModelCatalogId,
    providerModelId,
    provider,
    model: providerModelId,
    modelId: providerModelId,
    endpoint: normalizeText(item.evidence.endpoint) || undefined,
    endpointProfileId: normalizeText(item.evidence.endpointProfileId) || undefined,
    connectorSnapshotId: normalizeText(item.evidence.connectorSnapshotId) || undefined,
  };
}

function resolveLocalTarget(
  capability: NimiRuntimeCanonicalCapability,
  targetRef: NimiRuntimeRouteTargetRef,
  item: NimiRuntimeTargetInventoryItem,
): NimiRuntimeResolvedBinding {
  if (targetRef.kind !== 'local-runtime' || item.evidence.source !== 'local-runtime') {
    throw new Error('NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED');
  }
  const localAssetId = normalizeText(item.evidence.localAssetId);
  const modelId = normalizeNimiRuntimeRouteModelRoot(item.evidence.resolvedModelId || item.display.model);
  const engine = normalizeNimiRuntimeRouteEngineEvidence(item.evidence.engine || item.display.engine || item.display.provider);
  if (!localAssetId) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_LOCAL_ASSET_REQUIRED');
  if (!modelId) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  if (!engine) throw new Error('NIMI_RUNTIME_ROUTE_BINDING_ENGINE_REQUIRED');
  const endpoint = normalizeText(item.evidence.endpoint || item.readiness.endpoint) || undefined;
  return {
    capability,
    source: 'local-runtime',
    targetRef,
    resolvedBindingRef: resolvedBindingRefFor(capability, targetRef),
    routeMetadataRef: routeMetadataRefFor(capability, targetRef),
    provider: engine,
    engine,
    model: modelId,
    modelId,
    localAssetId,
    endpoint,
    localProviderEndpoint: endpoint,
    localOpenAiEndpoint: endpoint,
    localRuntimeStatus: normalizeText(item.evidence.runtimeStatus || item.readiness.status) || undefined,
  };
}

export function resolveNimiRuntimeRouteTargetRefFromSnapshot(input: {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetRef: NimiRuntimeRouteTargetRef | null | undefined;
  readonly snapshot: NimiRuntimeRouteOptionsSnapshot;
}): NimiRuntimeResolvedBinding {
  if (!input.targetRef) {
    throw new Error('NIMI_RUNTIME_ROUTE_TARGET_REF_REQUIRED');
  }
  const targetRef = normalizeNimiRuntimeRouteTargetRef(input.targetRef);
  const item = findNimiRuntimeTargetInventoryItem(input.snapshot.inventory, targetRef);
  if (!item) {
    throw new Error(targetRef.kind === 'cloud-connector'
      ? 'NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED'
      : 'NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED');
  }
  if (!runtimeNimiRouteCapabilitiesMatch(item.compatibility.capabilities, input.capability)) {
    throw new Error(targetRef.kind === 'cloud-connector'
      ? 'NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED'
      : 'NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED');
  }
  return targetRef.kind === 'cloud-connector'
    ? resolveCloudTarget(input.capability, targetRef, item)
    : resolveLocalTarget(input.capability, targetRef, item);
}

export function nimiRuntimeRouteHealthInputFromResolvedBinding(
  resolved: NimiRuntimeResolvedBinding,
): NimiRuntimeRouteHealthInput {
  return {
    provider: normalizeText(resolved.provider || resolved.engine),
    capability: resolved.capability,
    localProviderEndpoint: normalizeText(resolved.localProviderEndpoint || resolved.endpoint) || undefined,
    localProviderModel: normalizeText(resolved.modelId || resolved.model || resolved.providerModelId) || undefined,
    localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint || resolved.endpoint) || undefined,
    localAssetId: normalizeText(resolved.localAssetId) || undefined,
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
      || (input.resolved.source === 'cloud-connector' ? 'verify-connector' : 'install-local-model'));
  return {
    healthy: available,
    status: available ? normalizeText(input.health.status) : 'unavailable',
    provider: normalizeText(input.health.provider || input.resolved.provider),
    detail: normalizeText(input.health.detail),
    reasonCode: normalizeText(input.health.reasonCode) || undefined,
    actionHint,
  };
}
