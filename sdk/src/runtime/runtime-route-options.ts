import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteConnectorOption,
  RuntimeRouteLocalOption,
  RuntimeRouteOptionsSnapshot,
} from './runtime-route-core.js';
import {
  projectRuntimeRouteLocalModels,
} from './runtime-route-options-local.js';
import type {
  RuntimeRouteLocalAssetProjectionInput,
  RuntimeRouteLocalStatusMismatch,
  RuntimeRouteNodeCatalogProjectionInput,
} from './runtime-route-options-local.js';
import {
  buildRuntimeRouteSelectedBinding,
} from './runtime-route-bindings.js';
import {
  projectRuntimeRouteConnectors,
} from './runtime-route-connectors.js';
import type {
  RuntimeRouteConnectorProjectionInput,
} from './runtime-route-connectors.js';

export {
  normalizeRuntimeRouteCapabilityToken,
  projectRuntimeRouteCapabilityCoverage,
  projectRuntimeRouteCapabilityCoverageList,
  runtimeRouteCapabilitiesMatch,
  runtimeRouteLocalKindForCapability,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModalityForCapability,
  runtimeRouteModelSupportsCapability,
  type RuntimeRouteCapabilityCoverageConnectorInput,
  type RuntimeRouteCapabilityCoverageLocalModelInput,
  type RuntimeRouteCapabilityCoverageLocalNodeInput,
  type RuntimeRouteCapabilityCoverageProjection,
  type RuntimeRouteCapabilityCoverageProjectionInput,
} from './runtime-route-capability-coverage.js';
export type {
  RuntimeRouteLocalAssetProjectionInput,
  RuntimeRouteLocalStatusMismatch,
  RuntimeRouteNodeCatalogProjectionInput,
} from './runtime-route-options-local.js';
export {
  buildRuntimeRouteSelectedBinding,
  findRuntimeRouteModelProfile,
  isRuntimeRouteLocalOptionSelectable,
  runtimeRouteBindingsMatch,
  runtimeRouteLocalOptionToBinding,
} from './runtime-route-bindings.js';
export type {
  RuntimeRouteConnectorDescriptorProjectionInput,
  RuntimeRouteConnectorModelDescriptorProjectionInput,
  RuntimeRouteConnectorProjectionInput,
} from './runtime-route-connectors.js';

export type RuntimeRouteOptionsProjectionInput = {
  capability: RuntimeCanonicalCapability;
  selectedBinding?: RuntimeRouteBinding | null;
  connectors?: RuntimeRouteConnectorProjectionInput[];
  snapshotAssets?: RuntimeRouteLocalAssetProjectionInput[];
  nodeCatalog?: RuntimeRouteNodeCatalogProjectionInput[];
  runtimeLocalModels?: RuntimeRouteLocalAssetProjectionInput[];
  localMetadataDegraded?: boolean;
  onLocalStatusMismatch?: (mismatch: RuntimeRouteLocalStatusMismatch) => void;
};

export function buildRuntimeRouteOptionsProjection(input: RuntimeRouteOptionsProjectionInput): RuntimeRouteOptionsSnapshot {
  const connectors = projectRuntimeRouteConnectors(input.connectors, input.capability);
  const { localModels, runtimeDefaultEngine } = projectRuntimeRouteLocalModels(input);
  const selected = buildRuntimeRouteSelectedBinding({
    capability: input.capability,
    selectedBinding: input.selectedBinding,
    localModels,
    connectors,
    localMetadataDegraded: input.localMetadataDegraded,
    runtimeDefaultEngine,
  });
  const defaultLocalEndpoint = localModels.find((model) => String(model.endpoint || '').trim())?.endpoint;
  return buildRuntimeRouteOptionsSnapshot({
    capability: input.capability,
    selectedBinding: input.selectedBinding,
    selectedOverride: selected,
    localModels,
    connectors,
    defaultLocalEndpoint,
    localMetadataDegraded: input.localMetadataDegraded,
    runtimeDefaultEngine,
  });
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
  return {
    capability: input.capability,
    selected,
    local: {
      models: input.localModels,
      defaultEndpoint: String(input.defaultLocalEndpoint || '').trim() || undefined,
    },
    connectors: input.connectors,
  };
}
