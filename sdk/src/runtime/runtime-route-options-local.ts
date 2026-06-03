import type { JsonObject } from '../internal/utils.js';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteLocalOption,
} from './runtime-route-core.js';
import {
  normalizeRuntimeRouteCapabilityToken,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModelSupportsCapability,
} from './runtime-route-capability-coverage.js';

export type RuntimeRouteLocalAssetProjectionInput = {
  localAssetId?: string;
  assetId?: string;
  kind?: string;
  engine?: string;
  endpoint?: string;
  status?: string;
  capabilities?: string[];
};

export type RuntimeRouteNodeCatalogProjectionInput = {
  provider?: string;
  providerHints?: RuntimeRouteLocalOption['providerHints'];
};

export type RuntimeRouteLocalStatusMismatch = {
  capability: RuntimeCanonicalCapability;
  localModelId?: string;
  modelId?: string;
  engine?: string;
  runtimeStatus?: string;
  snapshotStatus?: string;
};

export type RuntimeRouteLocalModelsProjectionInput = {
  capability: RuntimeCanonicalCapability;
  snapshotAssets?: RuntimeRouteLocalAssetProjectionInput[];
  nodeCatalog?: RuntimeRouteNodeCatalogProjectionInput[];
  runtimeLocalModels?: RuntimeRouteLocalAssetProjectionInput[];
  onLocalStatusMismatch?: (mismatch: RuntimeRouteLocalStatusMismatch) => void;
};

export function canonicalLocalEngine(value: unknown): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'llama'
    || normalized === 'media'
    || normalized === 'speech'
    || normalized === 'sidecar'
  ) {
    return normalized;
  }
  return undefined;
}

export function isCanonicalLocalEngine(value: unknown): boolean {
  return Boolean(canonicalLocalEngine(value));
}

export function inferCanonicalLocalEngine(
  engineLike: unknown,
  runtimeDefaultEngine: unknown,
): string | undefined {
  return canonicalLocalEngine(engineLike) || canonicalLocalEngine(runtimeDefaultEngine);
}

function extractRuntimeRouteModelDisplayName(assetId: string): string {
  const raw = String(assetId || '').trim();
  const stripped = raw
    .replace(/^local\/local-import\//, '')
    .replace(/^local\//, '')
    .replace(/^media\//, '');
  return stripped || raw;
}

function rankLocalStatus(value: unknown): number {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'active') return 0;
  if (status === 'installed') return 1;
  if (status === 'unhealthy') return 2;
  if (status === 'removed') return 3;
  return 4;
}

function providerDefaultRank(providerHints: RuntimeRouteLocalOption['providerHints']): number {
  const extra = providerHints?.extra;
  if (!extra || typeof extra !== 'object') {
    return Number.MAX_SAFE_INTEGER;
  }
  const numeric = Number((extra as JsonObject).local_default_rank);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function localAssetLookupKey(modelId: unknown, engine: unknown): string {
  const normalizedEngine = canonicalLocalEngine(engine);
  const normalizedModel = String(modelId || '').trim().toLowerCase();
  return normalizedEngine && normalizedModel ? `${normalizedEngine}::${normalizedModel}` : '';
}

function normalizedRouteCapabilities(capabilities: string[] | undefined): RuntimeCanonicalCapability[] {
  return (capabilities || [])
    .map((capability) => normalizeRuntimeRouteCapabilityToken(capability))
    .filter((capability): capability is RuntimeCanonicalCapability => Boolean(capability));
}

function localAssetSupportsCapability(
  item: RuntimeRouteLocalAssetProjectionInput,
  capability: RuntimeCanonicalCapability,
): boolean {
  return runtimeRouteModelSupportsCapability(item.capabilities, capability)
    || runtimeRouteLocalKindSupportsCapability(item.kind, capability);
}

function routeCapabilitiesForLocalAsset(
  item: RuntimeRouteLocalAssetProjectionInput,
  capability: RuntimeCanonicalCapability,
): RuntimeCanonicalCapability[] {
  const normalized = normalizedRouteCapabilities(item.capabilities);
  if (normalized.length > 0) {
    return normalized;
  }
  return runtimeRouteLocalKindSupportsCapability(item.kind, capability) ? [capability] : [];
}

export function projectRuntimeRouteLocalModels(input: RuntimeRouteLocalModelsProjectionInput): {
  localModels: RuntimeRouteLocalOption[];
  runtimeDefaultEngine?: string;
} {
  const nodeByProvider = new Map<string, {
    provider: string;
    providerHints?: RuntimeRouteLocalOption['providerHints'];
    defaultRank: number;
  }>();
  for (const node of input.nodeCatalog || []) {
    const provider = canonicalLocalEngine(node.provider);
    if (!provider) {
      continue;
    }
    const current = nodeByProvider.get(provider);
    const candidateRank = providerDefaultRank(node.providerHints);
    if (
      !current
      || candidateRank < current.defaultRank
      || (!current.providerHints && node.providerHints)
    ) {
      nodeByProvider.set(provider, {
        provider,
        providerHints: node.providerHints,
        defaultRank: candidateRank,
      });
    }
  }

  const snapshotAssets = input.snapshotAssets || [];
  const snapshotByLocalModelId = new Map(
    snapshotAssets.map((item) => [String(item.localAssetId || '').trim(), item]),
  );
  const snapshotByLookup = new Map(
    snapshotAssets
      .map((item) => [localAssetLookupKey(item.assetId, item.engine), item] as const)
      .filter(([key]) => Boolean(key)),
  );

  const localModels = (input.runtimeLocalModels || [])
    .filter((item) => String(item.status || '').trim().toLowerCase() !== 'removed')
    .filter((item) => localAssetSupportsCapability(item, input.capability))
    .map((item): RuntimeRouteLocalOption => {
      const engine = canonicalLocalEngine(item.engine);
      const snapshotModel = snapshotByLocalModelId.get(String(item.localAssetId || '').trim())
        || snapshotByLookup.get(localAssetLookupKey(item.assetId, item.engine))
        || null;
      const routeCapabilities = routeCapabilitiesForLocalAsset(item, input.capability);
      const runtimeStatus = String(item.status || '').trim();
      const snapshotStatus = String(snapshotModel?.status || '').trim();
      if (snapshotModel && snapshotStatus.toLowerCase() !== runtimeStatus.toLowerCase()) {
        input.onLocalStatusMismatch?.({
          capability: input.capability,
          localModelId: String(item.localAssetId || '').trim() || undefined,
          modelId: String(item.assetId || '').trim() || undefined,
          engine,
          runtimeStatus: runtimeStatus || undefined,
          snapshotStatus: snapshotStatus || undefined,
        });
      }
      return {
        localModelId: String(item.localAssetId || '').trim(),
        label: extractRuntimeRouteModelDisplayName(String(item.assetId || '').trim()),
        engine,
        model: String(item.assetId || '').trim(),
        modelId: String(item.assetId || '').trim() || undefined,
        provider: engine,
        providerHints: engine ? nodeByProvider.get(engine)?.providerHints : undefined,
        endpoint: String(item.endpoint || snapshotModel?.endpoint || '').trim() || undefined,
        status: runtimeStatus || undefined,
        goRuntimeLocalModelId: String(item.localAssetId || '').trim() || undefined,
        goRuntimeStatus: runtimeStatus || undefined,
        capabilities: routeCapabilities,
      };
    })
    .sort((left, right) => {
      const rankDelta = providerDefaultRank(left.providerHints) - providerDefaultRank(right.providerHints);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      const statusDelta = rankLocalStatus(left.status) - rankLocalStatus(right.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return String(left.localModelId || '').localeCompare(String(right.localModelId || ''));
    });

  const runtimeDefaultEngine = [...nodeByProvider.values()]
    .sort((left, right) => left.defaultRank - right.defaultRank)[0]?.provider;
  return {
    localModels,
    runtimeDefaultEngine,
  };
}
