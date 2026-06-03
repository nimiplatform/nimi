import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteConnectorOption,
  RuntimeRouteLocalOption,
  RuntimeRouteModelProfile,
  RuntimeRouteOptionsSnapshot,
} from './runtime-route.js';
import {
  normalizeRuntimeRouteModelRoot,
} from './runtime-route.js';
import {
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  isLocalRuntimeRunnableAssetKindId,
  localRuntimeCapabilitiesForAssetKind,
  parseLocalRuntimeAssetKindId,
  type LocalRuntimeRunnableAssetKindId,
} from './local-asset-kind.js';
import type { JsonObject } from '../internal/utils.js';

export type RuntimeRouteConnectorDescriptorProjectionInput = {
  id?: string;
  label?: string;
  vendor?: string;
  provider?: string;
};

export type RuntimeRouteConnectorModelDescriptorProjectionInput = {
  modelId?: string;
  capabilities?: string[];
};

export type RuntimeRouteConnectorProjectionInput = {
  descriptor: RuntimeRouteConnectorDescriptorProjectionInput;
  modelDescriptors: RuntimeRouteConnectorModelDescriptorProjectionInput[];
};

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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCapabilityAlias(value: string): RuntimeCanonicalCapability | null {
  if (value === 'chat') return 'text.generate';
  if (value === 'embedding') return 'text.embed';
  if (value === 'image') return 'image.generate';
  if (value === 'image.edit') return 'image.generate';
  if (value === 'video') return 'video.generate';
  if (value === 'world') return 'world.generate';
  if (value === 'tts') return 'audio.synthesize';
  if (value === 'stt' || value === 'speech.transcribe') return 'audio.transcribe';
  // Runtime keeps `music` as a coarse runtime-only token until the music
  // product surface gets its own canonical identity.
  if (value === 'music') return 'music.generate';
  return null;
}

function canonicalLocalEngine(value: unknown): string | undefined {
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

function isCanonicalLocalEngine(value: unknown): boolean {
  return Boolean(canonicalLocalEngine(value));
}

function inferCanonicalLocalEngine(
  engineLike: unknown,
  runtimeDefaultEngine: unknown,
): string | undefined {
  return canonicalLocalEngine(engineLike) || canonicalLocalEngine(runtimeDefaultEngine);
}

export function isRuntimeRouteLocalOptionSelectable(option: RuntimeRouteLocalOption): boolean {
  return Boolean(String(option.localModelId || '').trim())
    && String(option.status || '').trim().toLowerCase() !== 'removed';
}

export function runtimeRouteLocalOptionToBinding(
  option: RuntimeRouteLocalOption,
  input?: {
    defaultEndpoint?: string;
  },
): RuntimeRouteBinding {
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
    endpoint: String(option.endpoint || input?.defaultEndpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(option.goRuntimeLocalModelId || '').trim() || undefined,
    goRuntimeStatus: String(option.goRuntimeStatus || '').trim() || undefined,
  };
}

export function findRuntimeRouteModelProfile(
  snapshot: RuntimeRouteOptionsSnapshot | null | undefined,
  binding: RuntimeRouteBinding | null | undefined,
): RuntimeRouteModelProfile | null {
  if (!snapshot || !binding) {
    return null;
  }
  if (
    Number.isFinite(Number(binding.maxContextTokens))
    || Number.isFinite(Number(binding.maxOutputTokens))
  ) {
    return {
      model: normalizeText(binding.modelId) || normalizeText(binding.model),
      ...(Number.isFinite(Number(binding.maxContextTokens)) && Number(binding.maxContextTokens) > 0
        ? { maxContextTokens: Math.floor(Number(binding.maxContextTokens)) }
        : {}),
      ...(Number.isFinite(Number(binding.maxOutputTokens)) && Number(binding.maxOutputTokens) > 0
        ? { maxOutputTokens: Math.floor(Number(binding.maxOutputTokens)) }
        : {}),
    };
  }
  if (binding.source !== 'cloud') {
    return null;
  }
  const connector = snapshot.connectors.find((item) => (
    normalizeText(item.id) === normalizeText(binding.connectorId)
  )) || null;
  if (!connector) {
    return null;
  }
  const targetModel = normalizeText(binding.modelId) || normalizeText(binding.model);
  if (!targetModel) {
    return null;
  }
  return connector.modelProfiles?.find((profile) => (
    normalizeText(profile.model) === targetModel
  )) || null;
}

function routeBindingModelToken(binding: RuntimeRouteBinding): string {
  return normalizeText(binding.modelId) || normalizeText(binding.model);
}

export function runtimeRouteBindingsMatch(
  left: RuntimeRouteBinding | null | undefined,
  right: RuntimeRouteBinding | null | undefined,
): boolean {
  if (!left || !right || left.source !== right.source) {
    return false;
  }
  if (left.source === 'local') {
    const leftLocalModelId = normalizeText(left.localModelId);
    const rightLocalModelId = normalizeText(right.localModelId);
    if (leftLocalModelId && rightLocalModelId) {
      return leftLocalModelId === rightLocalModelId;
    }
    const leftModel = routeBindingModelToken(left);
    const rightModel = routeBindingModelToken(right);
    return Boolean(leftModel && rightModel && leftModel === rightModel);
  }
  const leftConnectorId = normalizeText(left.connectorId);
  const rightConnectorId = normalizeText(right.connectorId);
  const leftModel = routeBindingModelToken(left);
  const rightModel = routeBindingModelToken(right);
  return Boolean(
    leftConnectorId
    && rightConnectorId
    && leftConnectorId === rightConnectorId
    && leftModel
    && rightModel
    && leftModel === rightModel,
  );
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

function projectRuntimeRouteConnectors(
  connectors: RuntimeRouteConnectorProjectionInput[] | undefined,
  capability: RuntimeCanonicalCapability,
): RuntimeRouteConnectorOption[] {
  return (connectors || [])
    .map((connector): RuntimeRouteConnectorOption | null => {
      const descriptor = connector.descriptor || {};
      const id = String(descriptor.id || '').trim();
      if (!id) {
        return null;
      }
      const matchingModels = (connector.modelDescriptors || [])
        .filter((item) => runtimeRouteModelSupportsCapability(item.capabilities, capability))
        .map((item) => String(item.modelId || '').trim())
        .filter(Boolean);
      if (matchingModels.length === 0) {
        return null;
      }
      const modelCapabilities = (connector.modelDescriptors || []).reduce<Record<string, string[]>>((accumulator, item) => {
        if (!runtimeRouteModelSupportsCapability(item.capabilities, capability)) {
          return accumulator;
        }
        const modelId = String(item.modelId || '').trim();
        if (modelId) {
          accumulator[modelId] = Array.isArray(item.capabilities) ? [...item.capabilities] : [];
        }
        return accumulator;
      }, {});
      return {
        id,
        label: String(descriptor.label || ''),
        vendor: String(descriptor.vendor || '').trim() || undefined,
        provider: String(descriptor.provider || '').trim() || undefined,
        models: matchingModels,
        modelCapabilities,
        modelProfiles: [],
      };
    })
    .filter((connector): connector is RuntimeRouteConnectorOption => connector !== null);
}

function projectRuntimeRouteLocalModels(input: RuntimeRouteOptionsProjectionInput): {
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

function hydrateSelectedLocalBinding(
  binding: RuntimeRouteBinding,
  localModels: RuntimeRouteLocalOption[],
): RuntimeRouteBinding {
  const bindingLocalModelId = String(binding.localModelId || '').trim();
  if (bindingLocalModelId) {
    const byLocalModelId = localModels.find((item) => String(item.localModelId || '').trim() === bindingLocalModelId) || null;
    if (byLocalModelId) {
      return runtimeRouteLocalOptionToBinding(byLocalModelId);
    }
  }

  const targetModelId = String(binding.modelId || binding.model || '').trim();
  const byModelId = localModels.find((item) => String(item.modelId || item.model || '').trim() === targetModelId) || null;
  if (byModelId) {
    return runtimeRouteLocalOptionToBinding(byModelId);
  }

  return {
    ...binding,
    model: normalizeRuntimeRouteModelRoot(binding.model || binding.modelId || '') || String(binding.model || binding.modelId || '').trim(),
    modelId: normalizeRuntimeRouteModelRoot(binding.modelId || binding.model || '') || undefined,
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
    || normalized === 'voice_workflow.voice_clone'
    || normalized === 'voice_workflow.voice_design'
  ) {
    return normalized;
  }
  return normalizeCapabilityAlias(normalized);
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
  if (capability === 'text.generate') {
    return 'chat';
  }
  if (capability === 'text.embed') {
    return 'embedding';
  }
  if (capability === 'image.generate') {
    return 'image';
  }
  if (capability === 'video.generate') {
    return 'video';
  }
  if (
    capability === 'audio.synthesize'
    || capability === 'voice_workflow.voice_clone'
    || capability === 'voice_workflow.voice_design'
  ) {
    return 'tts';
  }
  if (capability === 'audio.transcribe') {
    return 'stt';
  }
  return null;
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
    const matchedKey = bindingKey(matchedLocalModel);
    const exactLocal = localModels.find((item) => bindingKey(runtimeRouteLocalOptionToBinding(item)) === matchedKey) || null;
    if (String(matchedLocalModel.localModelId || '').trim() || exactLocal) {
      if (exactLocal) {
        return runtimeRouteLocalOptionToBinding(exactLocal);
      }
    }
    const engine = inferCanonicalLocalEngine(
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
