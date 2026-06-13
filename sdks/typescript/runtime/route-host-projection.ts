import type { JsonObject } from '../types';
import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteBinding,
  NimiRuntimeRouteConnectorOption,
  NimiRuntimeRouteLocalOption,
  NimiRuntimeRouteOptionsSnapshot,
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
  readonly kind?: unknown;
  readonly engine?: unknown;
  readonly endpoint?: unknown;
  readonly status?: unknown;
  readonly capabilities?: readonly unknown[];
}

export interface NimiRuntimeRouteNodeCatalogProjectionInput {
  readonly provider?: unknown;
  readonly providerHints?: JsonObject;
}

export interface NimiRuntimeRouteLocalStatusMismatch {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly localModelId?: string;
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
  readonly capabilities?: readonly unknown[];
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
  readonly selectedBinding?: NimiRuntimeRouteBinding | null;
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

function normalizedCapabilitiesForLocalAsset(
  asset: NimiRuntimeRouteLocalAssetProjectionInput,
  capability: NimiRuntimeCanonicalCapability,
): readonly string[] {
  const capabilities = (asset.capabilities || [])
    .map(normalizeNimiRuntimeHostRouteCapability)
    .filter((item): item is string => Boolean(item));
  return capabilities.length > 0 ? [...new Set(capabilities)] : [capability];
}

function displayNameForAssetId(assetId: string): string {
  return assetId
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

function projectLocalModels(input: NimiRuntimeRouteOptionsProjectionInput): readonly NimiRuntimeRouteLocalOption[] {
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
    .filter((asset) => parseNimiRuntimeLocalAssetStatusId(asset.status) !== 'removed')
    .filter((asset) => localAssetSupportsCapability(asset, input.capability))
    .map((asset): NimiRuntimeRouteLocalOption => {
      const localAssetId = normalizeText(asset.localAssetId);
      const assetId = normalizeText(asset.assetId);
      const engine = normalizeLower(asset.engine);
      const snapshot = snapshotByLocalId.get(localAssetId) || snapshotByLookup.get(localAssetLookupKey(assetId, engine));
      const runtimeStatus = parseNimiRuntimeLocalAssetStatusId(asset.status) || normalizeText(asset.status);
      const snapshotStatus = parseNimiRuntimeLocalAssetStatusId(snapshot?.status) || normalizeText(snapshot?.status);
      if (snapshot && normalizeLower(snapshotStatus) !== normalizeLower(runtimeStatus)) {
        input.onLocalStatusMismatch?.({
          capability: input.capability,
          localModelId: localAssetId || undefined,
          modelId: assetId || undefined,
          engine: engine || undefined,
          runtimeStatus: runtimeStatus || undefined,
          snapshotStatus: snapshotStatus || undefined,
        });
      }
      return {
        localModelId: localAssetId,
        label: displayNameForAssetId(assetId),
        engine: engine || undefined,
        model: assetId,
        modelId: assetId || undefined,
        provider: engine || undefined,
        endpoint: normalizeText(asset.endpoint || snapshot?.endpoint) || undefined,
        status: runtimeStatus || undefined,
        goRuntimeLocalModelId: localAssetId || undefined,
        goRuntimeStatus: runtimeStatus || undefined,
        capabilities: normalizedCapabilitiesForLocalAsset(asset, input.capability),
      };
    })
    .sort((left, right) => {
      const statusDelta = statusRank(left.status) - statusRank(right.status);
      return statusDelta !== 0
        ? statusDelta
        : normalizeText(left.localModelId).localeCompare(normalizeText(right.localModelId));
    });
}

function projectConnectors(
  connectors: readonly NimiRuntimeRouteConnectorProjectionInput[] | undefined,
  capability: NimiRuntimeCanonicalCapability,
): readonly NimiRuntimeRouteConnectorOption[] {
  return (connectors || [])
    .map((connector): NimiRuntimeRouteConnectorOption | null => {
      const descriptor = connector.descriptor || {};
      const id = normalizeText(descriptor.id);
      if (!id) return null;
      const matchingModels = connector.modelDescriptors
        .filter((model) => nimiRuntimeRouteCapabilitiesMatch(model.capabilities, capability))
        .map((model) => normalizeText(model.modelId))
        .filter(Boolean);
      if (matchingModels.length === 0) return null;
      const modelCapabilities = connector.modelDescriptors.reduce<Record<string, readonly string[]>>((accumulator, model) => {
        const modelId = normalizeText(model.modelId);
        if (modelId && matchingModels.includes(modelId)) {
          accumulator[modelId] = (model.capabilities || []).map(normalizeText).filter(Boolean);
        }
        return accumulator;
      }, {});
      return {
        id,
        label: normalizeText(descriptor.label),
        vendor: normalizeText(descriptor.vendor) || undefined,
        provider: normalizeText(descriptor.provider) || undefined,
        models: matchingModels,
        modelCapabilities,
      };
    })
    .filter((connector): connector is NimiRuntimeRouteConnectorOption => connector !== null);
}

function localOptionToBinding(option: NimiRuntimeRouteLocalOption): NimiRuntimeRouteBinding {
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

function bindingKey(binding: NimiRuntimeRouteBinding | null | undefined): string {
  if (!binding) return '';
  return [
    normalizeText(binding.source),
    normalizeText(binding.connectorId),
    normalizeText(binding.modelId || binding.model),
    normalizeText(binding.localModelId || binding.goRuntimeLocalModelId),
    normalizeText(binding.engine || binding.provider),
  ].join('|');
}

function buildSelectedBinding(input: {
  readonly selectedBinding?: NimiRuntimeRouteBinding | null;
  readonly localModels: readonly NimiRuntimeRouteLocalOption[];
  readonly connectors: readonly NimiRuntimeRouteConnectorOption[];
  readonly localMetadataDegraded?: boolean;
}): NimiRuntimeRouteBinding | null {
  const selected = input.selectedBinding;
  if (!selected) return null;
  if (selected.source === 'local') {
    const localModelId = normalizeText(selected.localModelId || selected.goRuntimeLocalModelId);
    const matched = localModelId
      ? input.localModels.find((model) => normalizeText(model.localModelId || model.goRuntimeLocalModelId) === localModelId)
      : input.localModels.find((model) => normalizeText(model.modelId || model.model) === normalizeText(selected.modelId || selected.model));
    if (matched) return localOptionToBinding(matched);
    if (input.localMetadataDegraded) return null;
    return {
      ...selected,
      model: normalizeText(selected.modelId || selected.model),
      goRuntimeStatus: normalizeText(selected.goRuntimeStatus) || 'unavailable',
    };
  }
  const exactCloud = input.connectors
    .flatMap((connector) => connector.models.map((model) => ({
      source: 'cloud' as const,
      connectorId: connector.id,
      model,
      modelId: model,
      provider: normalizeText(connector.provider) || undefined,
    })))
    .find((binding) => bindingKey(binding) === bindingKey(selected));
  if (exactCloud) return exactCloud;
  const connector = input.connectors.find((item) => normalizeText(item.id) === normalizeText(selected.connectorId));
  return {
    ...selected,
    connectorId: normalizeText(selected.connectorId),
    model: normalizeText(selected.modelId || selected.model),
    provider: normalizeText(selected.provider || connector?.provider) || undefined,
  };
}

export function buildNimiRuntimeRouteOptionsProjection(
  input: NimiRuntimeRouteOptionsProjectionInput,
): NimiRuntimeRouteOptionsSnapshot {
  const capability = normalizeNimiRuntimeHostRouteCapability(input.capability) || input.capability;
  const localModels = projectLocalModels({ ...input, capability });
  const connectors = projectConnectors(input.connectors, capability);
  const selected = buildSelectedBinding({
    selectedBinding: input.selectedBinding,
    localModels,
    connectors,
    localMetadataDegraded: input.localMetadataDegraded,
  });
  return {
    capability,
    selected,
    local: {
      models: localModels,
      defaultEndpoint: localModels.find((model) => normalizeText(model.endpoint))?.endpoint,
    },
    connectors,
  };
}
