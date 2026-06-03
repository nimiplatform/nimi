import type { RuntimeCanonicalCapability } from './runtime-route-core.js';
import {
  normalizeRuntimeCapabilityToken,
  runtimeCanonicalCapabilityToAssetKind,
} from './runtime-capability-vocabulary.generated.js';
import {
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  isLocalRuntimeRunnableAssetKindId,
  localRuntimeCapabilitiesForAssetKind,
  parseLocalRuntimeAssetKindId,
  type LocalRuntimeRunnableAssetKindId,
} from './local-asset-kind.js';

export type RuntimeRouteCapabilityCoverageLocalNodeInput = {
  capability?: unknown;
  available?: unknown;
  provider?: unknown;
  reasonCode?: unknown;
};

export type RuntimeRouteCapabilityCoverageLocalModelInput = {
  status?: unknown;
  capabilities?: readonly unknown[];
};

export type RuntimeRouteCapabilityCoverageConnectorInput = {
  status?: unknown;
  models?: readonly unknown[];
  modelCapabilities?: Record<string, readonly unknown[] | undefined>;
};

export type RuntimeRouteCapabilityCoverageProjectionInput = {
  capability: LocalRuntimeRunnableAssetKindId;
  localNodes?: readonly RuntimeRouteCapabilityCoverageLocalNodeInput[];
  localModels?: readonly RuntimeRouteCapabilityCoverageLocalModelInput[];
  connectors?: readonly RuntimeRouteCapabilityCoverageConnectorInput[];
};

export type RuntimeRouteCapabilityCoverageProjection = {
  capability: LocalRuntimeRunnableAssetKindId;
  localAvailable: boolean;
  cloudAvailable: boolean;
  localProvider?: string;
  errorReason?: string;
};

export function normalizeRuntimeRouteCapabilityToken(value: unknown): RuntimeCanonicalCapability | null {
  return normalizeRuntimeCapabilityToken(value);
}

function runtimeCanonicalCapabilitiesForRunnableAssetKind(
  capability: LocalRuntimeRunnableAssetKindId,
): RuntimeCanonicalCapability[] {
  return localRuntimeCapabilitiesForAssetKind(capability)
    .map((item) => normalizeRuntimeRouteCapabilityToken(item))
    .filter((item): item is RuntimeCanonicalCapability => Boolean(item));
}

function evidenceCapabilitiesSupportRunnableAssetKind(
  capabilities: readonly unknown[] | undefined,
  capability: LocalRuntimeRunnableAssetKindId,
): boolean {
  const canonicalCapabilities = runtimeCanonicalCapabilitiesForRunnableAssetKind(capability);
  return (capabilities || []).some((item) => {
    const raw = String(item ?? '').trim().toLowerCase();
    if (raw === capability) {
      return true;
    }
    const normalized = normalizeRuntimeRouteCapabilityToken(raw);
    return Boolean(normalized && canonicalCapabilities.includes(normalized));
  });
}

function connectorSupportsRunnableAssetKind(
  connector: RuntimeRouteCapabilityCoverageConnectorInput,
  capability: LocalRuntimeRunnableAssetKindId,
): boolean {
  if (String(connector.status || '').trim().toLowerCase() !== 'healthy') {
    return false;
  }
  const models = (connector.models || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (models.length === 0) {
    return false;
  }
  const modelCapabilities = connector.modelCapabilities || {};
  return models.some((modelId) => evidenceCapabilitiesSupportRunnableAssetKind(
    modelCapabilities[modelId],
    capability,
  ));
}

export function projectRuntimeRouteCapabilityCoverage(
  input: RuntimeRouteCapabilityCoverageProjectionInput,
): RuntimeRouteCapabilityCoverageProjection {
  const capability = input.capability;
  const localNode = (input.localNodes || []).find((node) => (
    String(node.capability || '').trim().toLowerCase() === capability
    && Boolean(node.available)
  )) || null;
  const hasLocalModel = (input.localModels || []).some((model) => (
    String(model.status || '').trim().toLowerCase() === 'active'
    && evidenceCapabilitiesSupportRunnableAssetKind(model.capabilities, capability)
  ));
  const localAvailable = Boolean(localNode) || hasLocalModel;
  const cloudAvailable = (input.connectors || []).some((connector) => (
    connectorSupportsRunnableAssetKind(connector, capability)
  ));
  const errorNode = !localAvailable && !cloudAvailable
    ? (input.localNodes || []).find((node) => (
      String(node.capability || '').trim().toLowerCase() === capability
      && !Boolean(node.available)
      && String(node.reasonCode || '').trim()
    )) || null
    : null;
  return {
    capability,
    localAvailable,
    cloudAvailable,
    localProvider: localNode ? String(localNode.provider || '').trim() || undefined : undefined,
    errorReason: errorNode ? String(errorNode.reasonCode || '').trim() || undefined : undefined,
  };
}

export function projectRuntimeRouteCapabilityCoverageList(input: {
  capabilities?: readonly LocalRuntimeRunnableAssetKindId[];
  localNodes?: readonly RuntimeRouteCapabilityCoverageLocalNodeInput[];
  localModels?: readonly RuntimeRouteCapabilityCoverageLocalModelInput[];
  connectors?: readonly RuntimeRouteCapabilityCoverageConnectorInput[];
}): RuntimeRouteCapabilityCoverageProjection[] {
  return [...(input.capabilities || LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS)].map((capability) => (
    projectRuntimeRouteCapabilityCoverage({
      capability,
      localNodes: input.localNodes,
      localModels: input.localModels,
      connectors: input.connectors,
    })
  ));
}

export function runtimeRouteModelSupportsCapability(
  capabilities: string[] | undefined,
  capability: RuntimeCanonicalCapability,
): boolean {
  return (capabilities || []).some((item) => normalizeRuntimeRouteCapabilityToken(item) === capability);
}

export function runtimeRouteCapabilitiesMatch(
  capabilities: readonly unknown[] | undefined,
  filter: unknown,
): boolean {
  const capability = normalizeRuntimeRouteCapabilityToken(filter);
  if (!capability) {
    return false;
  }
  return (capabilities || []).some((item) => normalizeRuntimeRouteCapabilityToken(item) === capability);
}

export function runtimeRouteLocalKindForCapability(
  capability: RuntimeCanonicalCapability,
): LocalRuntimeRunnableAssetKindId | null {
  const assetKind = runtimeCanonicalCapabilityToAssetKind(capability);
  return isLocalRuntimeRunnableAssetKindId(assetKind) ? assetKind : null;
}

export function runtimeRouteModalityForCapability(
  capability: RuntimeCanonicalCapability,
): LocalRuntimeRunnableAssetKindId {
  return runtimeRouteLocalKindForCapability(capability) || 'chat';
}

export function runtimeRouteLocalKindSupportsCapability(
  kind: string | null | undefined,
  capability: RuntimeCanonicalCapability,
): boolean {
  const normalizedKind = parseLocalRuntimeAssetKindId(kind);
  if (!normalizedKind || !isLocalRuntimeRunnableAssetKindId(normalizedKind)) {
    return false;
  }
  return normalizedKind === runtimeRouteLocalKindForCapability(capability);
}
