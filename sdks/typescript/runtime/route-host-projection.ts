import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteCloudTargetRef,
  NimiRuntimeRouteOptionsSnapshot,
  NimiRuntimeRouteTargetRef,
  NimiRuntimeTargetInventoryItem,
} from './route-options';
import {
  normalizeNimiRuntimeRouteCapabilityToken,
  nimiRuntimeRouteTargetRefKey,
  nimiRuntimeRouteTargetRefsMatch,
  runtimeNimiRouteCapabilitiesMatch,
} from './route-options';
import { parseNimiRuntimeLocalAssetStatusId } from './local-asset-vocabulary';
import {
  normalizeLower,
  normalizeNimiRuntimeHostRouteCapability,
  normalizeText,
  nimiRuntimeRouteCapabilitiesMatch,
  nimiRuntimeRouteLocalKindSupportsCapability,
} from './route-host-codecs';

export interface NimiRuntimeRouteLocalAssetProjectionInput {
  readonly localAssetId?: unknown;
  readonly assetId?: unknown;
  readonly logicalModelId?: unknown;
  readonly kind?: unknown;
  readonly engine?: unknown;
  readonly endpoint?: unknown;
  readonly status?: unknown;
  readonly capabilities?: readonly unknown[];
  readonly artifactRoles?: readonly unknown[];
  readonly displayName?: unknown;
  readonly sourceFileName?: unknown;
  readonly updatedAt?: unknown;
  readonly durableTargetRef?: unknown;
  readonly durableTargetStatus?: unknown;
  readonly durableTargetReasonCode?: unknown;
}

export interface NimiRuntimeRouteNodeCatalogProjectionInput {
  readonly provider?: unknown;
  readonly providerHints?: Record<string, unknown>;
}

export interface NimiRuntimeRouteLocalStatusMismatch {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly localAssetId?: string;
  readonly modelId?: string;
  readonly engine?: string;
  readonly runtimeStatus?: string;
  readonly snapshotStatus?: string;
}

export interface NimiRuntimeRouteConnectorDescriptorProjectionInput {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly vendor?: unknown;
  readonly provider?: unknown;
}

export interface NimiRuntimeRouteConnectorModelDescriptorProjectionInput {
  readonly modelId?: unknown;
  readonly modelLabel?: unknown;
  readonly available?: unknown;
  readonly capabilities?: readonly unknown[];
  readonly remoteModelCatalogId?: unknown;
  readonly providerModelId?: unknown;
  readonly provider?: unknown;
  readonly connectorSnapshotId?: unknown;
  readonly endpointProfileId?: unknown;
  readonly inventorySnapshotId?: unknown;
}

export interface NimiRuntimeRouteConnectorProjectionInput {
  readonly descriptor: NimiRuntimeRouteConnectorDescriptorProjectionInput;
  readonly modelDescriptors: readonly NimiRuntimeRouteConnectorModelDescriptorProjectionInput[];
}

export interface NimiRuntimeRouteHostLocalMetadata {
  readonly snapshotAssets?: readonly NimiRuntimeRouteLocalAssetProjectionInput[];
  readonly nodeCatalog?: readonly NimiRuntimeRouteNodeCatalogProjectionInput[];
  readonly runtimeLocalModels?: readonly NimiRuntimeRouteLocalAssetProjectionInput[];
}

export interface NimiRuntimeRouteOptionsProjectionInput {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly selectedTargetRef?: NimiRuntimeRouteTargetRef | null;
  readonly connectors?: readonly NimiRuntimeRouteConnectorProjectionInput[];
  readonly snapshotAssets?: readonly NimiRuntimeRouteLocalAssetProjectionInput[];
  readonly nodeCatalog?: readonly NimiRuntimeRouteNodeCatalogProjectionInput[];
  readonly runtimeLocalModels?: readonly NimiRuntimeRouteLocalAssetProjectionInput[];
  readonly localMetadataDegraded?: boolean;
  readonly onLocalStatusMismatch?: (mismatch: NimiRuntimeRouteLocalStatusMismatch) => void;
}

function localAssetSupportsCapability(
  asset: NimiRuntimeRouteLocalAssetProjectionInput,
  capability: NimiRuntimeCanonicalCapability,
): boolean {
  return nimiRuntimeRouteCapabilitiesMatch(asset.capabilities, capability)
    || nimiRuntimeRouteLocalKindSupportsCapability(asset.kind, capability);
}

function localAssetHasArtifactRole(
  asset: NimiRuntimeRouteLocalAssetProjectionInput,
  role: string,
): boolean {
  const target = normalizeLower(role);
  return Boolean(target && (asset.artifactRoles || []).some((item) => normalizeLower(item) === target));
}

function localAssetIsCompanionOnly(asset: NimiRuntimeRouteLocalAssetProjectionInput): boolean {
  return localAssetHasArtifactRole(asset, 'uncond_diffusion_model');
}

function normalizedCapabilitiesForLocalAsset(
  asset: NimiRuntimeRouteLocalAssetProjectionInput,
  capability: NimiRuntimeCanonicalCapability,
): readonly string[] {
  const capabilities = (asset.capabilities || [])
    .map(normalizeNimiRuntimeHostRouteCapability)
    .filter((item): item is string => Boolean(item));
  return capabilities.length > 0 ? [...new Set(capabilities)] : [capability];
}

function displayNameForAsset(asset: NimiRuntimeRouteLocalAssetProjectionInput, assetId: string): string {
  return normalizeText(asset.displayName)
    || normalizeText(asset.sourceFileName)
    || assetId
      .replace(/^local\/local-import\//u, '')
      .replace(/^local\//u, '')
      .replace(/^media\//u, '')
    || assetId;
}

function localAssetLookupKey(modelId: unknown, engine: unknown): string {
  const model = normalizeLower(modelId);
  const normalizedEngine = normalizeLower(engine);
  return model && normalizedEngine ? `${normalizedEngine}::${model}` : '';
}

function statusRank(value: unknown): number {
  switch (parseNimiRuntimeLocalAssetStatusId(value)) {
    case 'active':
      return 0;
    case 'installed':
      return 1;
    case 'unhealthy':
      return 2;
    case 'removed':
      return 3;
    default:
      return 4;
  }
}

function localTargetRefForAsset(
  asset: NimiRuntimeRouteLocalAssetProjectionInput,
): NimiRuntimeRouteTargetRef | null {
  if (!asset.durableTargetRef || typeof asset.durableTargetRef !== 'object' || Array.isArray(asset.durableTargetRef)) {
    return null;
  }
  const target = asset.durableTargetRef as {
    readonly version?: unknown;
    readonly ref?: {
      readonly oneofKind?: unknown;
      readonly profileBindingId?: unknown;
      readonly readinessRef?: unknown;
    };
  };
  if (normalizeText(target.version) !== 'v2' || !target.ref || typeof target.ref !== 'object') {
    return null;
  }
  if (target.ref.oneofKind === 'profileBindingId') {
    const profileBindingId = normalizeText(target.ref.profileBindingId);
    return profileBindingId
      ? { kind: 'local-runtime', version: 'v2', profileBindingId }
      : null;
  }
  if (target.ref.oneofKind === 'readinessRef') {
    const readinessRef = normalizeText(target.ref.readinessRef);
    return readinessRef
      ? { kind: 'local-runtime', version: 'v2', readinessRef }
      : null;
  }
  return null;
}

function projectLocalTargetItems(input: NimiRuntimeRouteOptionsProjectionInput): readonly NimiRuntimeTargetInventoryItem[] {
  if (input.localMetadataDegraded) return [];
  const snapshotByLocalId = new Map(
    (input.snapshotAssets || []).map((asset) => [normalizeText(asset.localAssetId), asset] as const),
  );
  const snapshotByLookup = new Map(
    (input.snapshotAssets || [])
      .map((asset) => [localAssetLookupKey(asset.assetId, asset.engine), asset] as const)
      .filter(([key]) => Boolean(key)),
  );
  return (input.runtimeLocalModels || [])
    .filter((asset) => parseNimiRuntimeLocalAssetStatusId(asset.durableTargetStatus || asset.status) !== 'removed')
    .filter((asset) => !localAssetIsCompanionOnly(asset))
    .filter((asset) => localAssetSupportsCapability(asset, input.capability))
    .map((asset): NimiRuntimeTargetInventoryItem | null => {
      const localAssetId = normalizeText(asset.localAssetId);
      const assetId = normalizeText(asset.assetId);
      const logicalModelId = normalizeText(asset.logicalModelId);
      const targetRef = localTargetRefForAsset(asset);
      const resolvedModelId = logicalModelId;
      const engine = normalizeLower(asset.engine);
      if (!localAssetId || !assetId || !resolvedModelId || !targetRef) return null;
      const snapshot = snapshotByLocalId.get(localAssetId) || snapshotByLookup.get(localAssetLookupKey(assetId, engine));
      const runtimeStatus = parseNimiRuntimeLocalAssetStatusId(asset.durableTargetStatus)
        || parseNimiRuntimeLocalAssetStatusId(asset.status)
        || normalizeText(asset.durableTargetStatus)
        || normalizeText(asset.status)
        || 'unknown';
      const snapshotStatus = parseNimiRuntimeLocalAssetStatusId(snapshot?.status) || normalizeText(snapshot?.status);
      if (snapshot && normalizeLower(snapshotStatus) !== normalizeLower(runtimeStatus)) {
        input.onLocalStatusMismatch?.({
          capability: input.capability,
          localAssetId,
          modelId: assetId || undefined,
          engine: engine || undefined,
          runtimeStatus: runtimeStatus || undefined,
          snapshotStatus: snapshotStatus || undefined,
        });
      }
      return {
        targetRef,
        display: {
          label: displayNameForAsset(asset, resolvedModelId),
          model: resolvedModelId,
          provider: engine || undefined,
          engine: engine || undefined,
        },
        readiness: {
          status: runtimeStatus,
          reasonCode: normalizeText(asset.durableTargetReasonCode) || undefined,
          endpoint: normalizeText(asset.endpoint || snapshot?.endpoint) || undefined,
        },
        compatibility: {
          capabilities: normalizedCapabilitiesForLocalAsset(asset, input.capability),
        },
        evidence: {
          source: 'local-runtime',
          localAssetId,
          resolvedModelId,
          engine: engine || undefined,
          endpoint: normalizeText(asset.endpoint || snapshot?.endpoint) || undefined,
          runtimeStatus,
          updatedAt: normalizeText(asset.updatedAt || snapshot?.updatedAt) || undefined,
        },
      };
    })
    .filter((item): item is NimiRuntimeTargetInventoryItem => item !== null)
    .sort((left, right) => {
      const statusDelta = statusRank(left.readiness.status) - statusRank(right.readiness.status);
      return statusDelta !== 0
        ? statusDelta
        : nimiRuntimeRouteTargetRefKey(left.targetRef).localeCompare(nimiRuntimeRouteTargetRefKey(right.targetRef));
    });
}

function cloudTargetRefForModel(input: {
  readonly connectorId: string;
  readonly provider: string;
  readonly model: NimiRuntimeRouteConnectorModelDescriptorProjectionInput;
}): NimiRuntimeRouteCloudTargetRef | null {
  const remoteModelCatalogId = normalizeText(input.model.remoteModelCatalogId);
  const providerModelId = normalizeText(input.model.providerModelId);
  const provider = normalizeText(input.model.provider || input.provider);
  if (!input.connectorId || !remoteModelCatalogId || !providerModelId) {
    return null;
  }
  return {
    kind: 'cloud-connector',
    version: 'v2',
    connectorId: input.connectorId,
    remoteModelCatalogId,
    providerModelId,
    ...(provider ? { provider } : {}),
  };
}

function projectCloudTargetItems(
  connectors: readonly NimiRuntimeRouteConnectorProjectionInput[] | undefined,
  capability: NimiRuntimeCanonicalCapability,
): readonly NimiRuntimeTargetInventoryItem[] {
  return (connectors || [])
    .flatMap((connector): NimiRuntimeTargetInventoryItem[] => {
      const descriptor = connector.descriptor || {};
      const connectorId = normalizeText(descriptor.id);
      if (!connectorId) return [];
      const provider = normalizeText(descriptor.provider);
      const connectorLabel = normalizeText(descriptor.label) || connectorId;
      const connectorProviderLabel = normalizeText(descriptor.vendor) || provider;
      return connector.modelDescriptors
        .filter((model) => model.available !== false)
        .filter((model) => runtimeNimiRouteCapabilitiesMatch(
          (model.capabilities || []).map((item) => normalizeNimiRuntimeRouteCapabilityToken(item)).filter((item): item is string => Boolean(item)),
          capability,
        ))
        .map((model): NimiRuntimeTargetInventoryItem | null => {
          const targetRef = cloudTargetRefForModel({ connectorId, provider, model });
          if (!targetRef) return null;
          const capabilities = (model.capabilities || [])
            .map(normalizeNimiRuntimeHostRouteCapability)
            .filter((item): item is string => Boolean(item));
          return {
            targetRef,
            display: {
              label: normalizeText(model.modelLabel) || targetRef.providerModelId,
              connectorLabel,
              connectorProviderLabel,
              modelLabel: normalizeText(model.modelLabel) || undefined,
              provider: targetRef.provider || provider || undefined,
              model: targetRef.providerModelId,
            },
            readiness: {
              status: 'ready',
            },
            compatibility: {
              capabilities: [...new Set(capabilities)],
            },
            evidence: {
              source: 'cloud-connector',
              connectorId,
              remoteModelCatalogId: targetRef.remoteModelCatalogId,
              providerModelId: targetRef.providerModelId,
              provider: targetRef.provider || provider || undefined,
              connectorSnapshotId: normalizeText(model.connectorSnapshotId) || undefined,
              endpointProfileId: normalizeText(model.endpointProfileId) || undefined,
              inventorySnapshotId: normalizeText(model.inventorySnapshotId) || undefined,
            },
          };
        })
        .filter((item): item is NimiRuntimeTargetInventoryItem => item !== null);
    });
}

function selectedTargetRefFromInventory(input: {
  readonly selectedTargetRef?: NimiRuntimeRouteTargetRef | null;
  readonly targets: readonly NimiRuntimeTargetInventoryItem[];
  readonly localMetadataDegraded?: boolean;
}): NimiRuntimeRouteTargetRef | null {
  const selected = input.selectedTargetRef || null;
  if (!selected) return null;
  const matched = input.targets.find((item) => nimiRuntimeRouteTargetRefsMatch(item.targetRef, selected)) || null;
  if (matched) return matched.targetRef;
  if (selected.kind === 'local-runtime' && input.localMetadataDegraded) return null;
  return selected;
}

function routeOptionsSnapshotRevision(input: {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targets: readonly NimiRuntimeTargetInventoryItem[];
}): string {
  const tokens = input.targets.map((item) => {
    const targetKey = nimiRuntimeRouteTargetRefKey(item.targetRef);
    const status = normalizeLower(item.readiness.status);
    const capabilities = [...item.compatibility.capabilities].map(normalizeNimiRuntimeHostRouteCapability).sort().join(',');
    if (item.evidence.source === 'cloud-connector') {
      return [
        'cloud',
        targetKey,
        status,
        capabilities,
        normalizeText(item.evidence.connectorSnapshotId),
        normalizeText(item.evidence.endpointProfileId),
        normalizeText(item.evidence.inventorySnapshotId),
      ].join('|');
    }
    return [
      'local',
      targetKey,
      status,
      capabilities,
      normalizeText(item.evidence.localAssetId),
      normalizeText(item.evidence.resolvedModelId),
      normalizeText(item.evidence.engine),
      normalizeText(item.evidence.endpoint),
      normalizeText(item.evidence.runtimeStatus),
      normalizeText(item.evidence.updatedAt),
    ].join('|');
  }).sort();
  return [
    'route-options:v1',
    normalizeNimiRuntimeHostRouteCapability(input.capability) || input.capability,
    ...tokens,
  ].join(':');
}

export function buildNimiRuntimeRouteOptionsProjection(
  input: NimiRuntimeRouteOptionsProjectionInput,
): NimiRuntimeRouteOptionsSnapshot {
  const capability = normalizeNimiRuntimeHostRouteCapability(input.capability) || input.capability;
  const localTargets = projectLocalTargetItems({ ...input, capability });
  const cloudTargets = projectCloudTargetItems(input.connectors, capability);
  const targets = [...localTargets, ...cloudTargets];
  return {
    capability,
    snapshotRevision: routeOptionsSnapshotRevision({ capability, targets }),
    selectedTargetRef: selectedTargetRefFromInventory({
      selectedTargetRef: input.selectedTargetRef,
      targets,
      localMetadataDegraded: input.localMetadataDegraded,
    }),
    inventory: {
      capability,
      targets,
    },
  };
}
