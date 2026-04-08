import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { localRuntime, type LocalRuntimeAssetRecord, type LocalRuntimeSnapshot } from '@runtime/local-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { type RuntimeCanonicalCapability, type RuntimeRouteBinding, type RuntimeRouteConnectorOption, type RuntimeRouteLocalOption, type RuntimeRouteOptionsSnapshot } from "@nimiplatform/sdk/mod";
import { normalizeLocalEngine, normalizeLocalModelRoot } from './runtime-bootstrap-utils';
type RuntimeFields = {
    provider: string;
    runtimeModelType: string;
    localProviderEndpoint: string;
    localProviderModel: string;
    localOpenAiEndpoint: string;
    connectorId: string;
};
type ConnectorDescriptor = {
    id: string;
    label?: string;
    vendor?: string;
    provider?: string;
};
/**
 * Extract a human-readable model name from an assetId.
 * Strips common prefixes like "local/local-import/", "local/", "media/" etc.
 */
function extractModelDisplayName(assetId: string): string {
    const raw = String(assetId || '').trim();
    // Strip known prefixes: "local/local-import/", "local/", "media/"
    const stripped = raw
        .replace(/^local\/local-import\//, '')
        .replace(/^local\//, '')
        .replace(/^media\//, '');
    return stripped || raw;
}

const LOCAL_SNAPSHOT_TIMEOUT_MS = 3500;
let localRoutePlatformForTests: 'windows' | 'darwin' | 'linux' | 'unknown' | null = null;

function resolveLocalRoutePlatform(): 'windows' | 'darwin' | 'linux' | 'unknown' {
    if (localRoutePlatformForTests) {
        return localRoutePlatformForTests;
    }
    const globalProcess = (globalThis as { process?: { platform?: string } }).process;
    const processPlatform = String(globalProcess?.platform || '').trim().toLowerCase();
    if (processPlatform === 'win32')
        return 'windows';
    if (processPlatform === 'darwin')
        return 'darwin';
    if (processPlatform === 'linux')
        return 'linux';
    const nav = globalThis as { navigator?: { platform?: string; userAgent?: string } };
    const navigatorPlatform = `${String(nav.navigator?.platform || '').trim().toLowerCase()} ${String(nav.navigator?.userAgent || '').trim().toLowerCase()}`;
    if (navigatorPlatform.includes('win'))
        return 'windows';
    if (navigatorPlatform.includes('mac'))
        return 'darwin';
    if (navigatorPlatform.includes('linux'))
        return 'linux';
    return 'unknown';
}

export function setLocalRoutePlatformForTests(value: 'windows' | 'darwin' | 'linux' | 'unknown' | null): void {
    localRoutePlatformForTests = value;
}

function mapCanonicalCapabilityToLocalCapability(capability: RuntimeCanonicalCapability): 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | undefined {
    if (capability === 'text.generate')
        return 'chat';
    if (capability === 'text.embed')
        return 'embedding';
    if (capability === 'image.generate')
        return 'image';
    if (capability === 'video.generate')
        return 'video';
    if (capability === 'audio.synthesize')
        return 'tts';
    if (capability === 'audio.transcribe')
        return 'stt';
    return undefined;
}
function normalizeCapabilityToken(value: unknown): RuntimeCanonicalCapability | null {
    const normalized = String(value || '').trim();
    if (normalized === 'text.generate'
        || normalized === 'text.embed'
        || normalized === 'image.generate'
        || normalized === 'video.generate'
        || normalized === 'audio.synthesize'
        || normalized === 'audio.transcribe'
        || normalized === 'voice_workflow.tts_v2v'
        || normalized === 'voice_workflow.tts_t2v') {
        return normalized;
    }
    if (normalized === 'chat')
        return 'text.generate';
    if (normalized === 'embedding')
        return 'text.embed';
    if (normalized === 'image')
        return 'image.generate';
    if (normalized === 'video')
        return 'video.generate';
    if (normalized === 'tts')
        return 'audio.synthesize';
    if (normalized === 'stt')
        return 'audio.transcribe';
    return null;
}
function fallbackLocalEngine(capability?: RuntimeCanonicalCapability): string {
    const platform = resolveLocalRoutePlatform();
    if (capability === 'image.generate' || capability === 'video.generate') {
        return 'media';
    }
    if (capability === 'audio.synthesize' || (platform === 'windows' && capability === 'voice_workflow.tts_t2v')) {
        return 'sidecar';
    }
    return 'llama';
}
function inferLocalEngine(provider: string, capability?: RuntimeCanonicalCapability, runtimeDefaultEngine?: string): string {
    const rawProvider = String(provider || '').trim().toLowerCase();
    if (rawProvider === 'llama' || rawProvider === 'media' || rawProvider === 'speech' || rawProvider === 'sidecar') {
        return normalizeLocalEngine(rawProvider);
    }
    const defaultEngine = String(runtimeDefaultEngine || '').trim();
    if (defaultEngine) {
        const normalizedDefault = normalizeLocalEngine(defaultEngine);
        return normalizedDefault;
    }
    return fallbackLocalEngine(capability);
}
function bindingKey(input: RuntimeRouteBinding | null | undefined): string {
    if (!input)
        return '';
    return [
        String(input.source || '').trim(),
        String(input.connectorId || '').trim(),
        normalizeLocalModelRoot(String(input.modelId || input.model || '').trim()),
        String(input.localModelId || '').trim(),
        normalizeLocalEngine(String(input.engine || '').trim()),
    ].join('|');
}
function mergeCloudBindingProvider(binding: RuntimeRouteBinding, connectors: RuntimeRouteConnectorOption[]): RuntimeRouteBinding {
    if (binding.source !== 'cloud') {
        return binding;
    }
    const connector = connectors.find((item) => item.id === binding.connectorId) || null;
    if (!connector) {
        return binding;
    }
    return {
        ...binding,
        provider: String(binding.provider || connector.provider || '').trim() || undefined,
    };
}
function modelSupportsCapability(capabilities: string[] | undefined, capability: RuntimeCanonicalCapability): boolean {
    return (capabilities || []).some((item) => normalizeCapabilityToken(item) === capability);
}
function rankRuntimeLocalStatus(value: unknown): number {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'active')
        return 0;
    if (status === 'unhealthy')
        return 1;
    if (status === 'installed')
        return 2;
    if (status === 'removed')
        return 3;
    return 4;
}
function rankLocalStatus(value: unknown): number {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'active')
        return 0;
    if (status === 'installed')
        return 1;
    if (status === 'unhealthy')
        return 2;
    if (status === 'removed')
        return 3;
    return 4;
}
function providerDefaultRank(providerHints: RuntimeRouteLocalOption['providerHints']): number {
    const extra = providerHints?.extra;
    if (!extra || typeof extra !== 'object') {
        return Number.MAX_SAFE_INTEGER;
    }
    const numeric = Number((extra as Record<string, unknown>).local_default_rank);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}
export function pickPreferredRuntimeLocalModel(runtimeLocalModels: Array<{
    localModelId?: string;
    modelId?: string;
    engine?: string;
    status?: string;
}>, modelId: string, engine: string): {
    localModelId?: string;
    status?: string;
} | null {
    const matches = runtimeLocalModels
        .filter((goModel) => syncLookup(goModel.modelId || '', goModel.engine || '') === syncLookup(modelId, engine))
        .filter((goModel) => String(goModel.status || '').trim().toLowerCase() !== 'removed')
        .sort((left, right) => {
        const rankDelta = rankRuntimeLocalStatus(left.status) - rankRuntimeLocalStatus(right.status);
        if (rankDelta !== 0) {
            return rankDelta;
        }
        return String(left.localModelId || '').localeCompare(String(right.localModelId || ''));
    });
    if (matches.length === 0) {
        return null;
    }
    return {
        localModelId: String(matches[0]?.localModelId || '').trim() || undefined,
        status: String(matches[0]?.status || '').trim() || undefined,
    };
}
function toLocalBinding(option: RuntimeRouteLocalOption): RuntimeRouteBinding {
    const modelId = String(option.modelId || option.model || '').trim();
    const engine = normalizeLocalEngine(option.engine);
    return {
        source: 'local',
        connectorId: '',
        model: modelId,
        modelId,
        provider: String(option.provider || engine).trim() || engine,
        localModelId: String(option.localModelId || '').trim() || undefined,
        engine,
        adapter: String(option.adapter || '').trim() || undefined,
        providerHints: option.providerHints,
        endpoint: String(option.endpoint || '').trim() || undefined,
        goRuntimeLocalModelId: String(option.goRuntimeLocalModelId || '').trim() || undefined,
        goRuntimeStatus: String(option.goRuntimeStatus || '').trim() || undefined,
    };
}
function pickMatchingLocalOption(localModels: RuntimeRouteLocalOption[], binding: RuntimeRouteBinding): RuntimeRouteLocalOption | null {
    const bindingLocalModelId = String(binding.localModelId || '').trim();
    if (bindingLocalModelId) {
        const byLocalModelId = localModels.find((item) => String(item.localModelId || '').trim() === bindingLocalModelId) || null;
        if (byLocalModelId) {
            return byLocalModelId;
        }
    }
    const targetModelId = normalizeLocalModelRoot(String(binding.modelId || binding.model || '').trim());
    return localModels.find((item) => (normalizeLocalModelRoot(String(item.modelId || item.model || '').trim()) === targetModelId)) || null;
}
async function pollLocalSnapshotWithTimeout(): Promise<LocalRuntimeSnapshot> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            localRuntime.pollSnapshot().catch((error) => {
                throw asNimiError(error, {
                    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
                    actionHint: 'check_runtime_daemon_health',
                    source: 'runtime',
                });
            }),
            new Promise<never>((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(createNimiError({
                        message: `local runtime snapshot timed out after ${LOCAL_SNAPSHOT_TIMEOUT_MS}ms`,
                        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
                        actionHint: 'check_runtime_daemon_health',
                        source: 'runtime',
                    }));
                }, LOCAL_SNAPSHOT_TIMEOUT_MS);
            }),
        ]);
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
type LocalRouteMetadata = {
    snapshot: Awaited<ReturnType<typeof pollLocalSnapshotWithTimeout>>;
    nodeCatalog: Awaited<ReturnType<typeof localRuntime.listNodesCatalog>>;
    runtimeLocalModels: LocalRuntimeAssetRecord[];
};
type LocalRouteMetadataDeps = {
    pollLocalSnapshotWithTimeout: typeof pollLocalSnapshotWithTimeout;
    listNodesCatalog: typeof localRuntime.listNodesCatalog;
    listRuntimeLocalAssets: () => Promise<LocalRuntimeAssetRecord[]>;
};
function rethrowLocalRouteMetadataError(input: {
    error: unknown;
    action: 'list-nodes-catalog' | 'list-runtime-local-models';
}): never {
    const normalized = asNimiError(input.error, {
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        actionHint: 'check_runtime_daemon_health',
        source: 'runtime',
    });
    emitRuntimeLog({
        level: 'warn',
        area: 'route-options',
        message: `${input.action}:failed`,
        traceId: normalized.traceId,
        details: {
            reasonCode: normalized.reasonCode,
            actionHint: normalized.actionHint,
            retryable: normalized.retryable,
            traceId: normalized.traceId,
            error: normalized.message,
        },
    });
    throw normalized;
}
export async function loadLocalRouteMetadata(capability: RuntimeCanonicalCapability, deps?: Partial<LocalRouteMetadataDeps>): Promise<LocalRouteMetadata> {
    const localCapability = mapCanonicalCapabilityToLocalCapability(capability);
    const resolvedDeps: LocalRouteMetadataDeps = {
        pollLocalSnapshotWithTimeout,
        listNodesCatalog: localRuntime.listNodesCatalog,
        listRuntimeLocalAssets: () => localRuntime.listAssets(),
        ...deps,
    };
    const snapshot = await resolvedDeps.pollLocalSnapshotWithTimeout().catch((error) => {
        const normalized = asNimiError(error, {
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'check_runtime_daemon_health',
            source: 'runtime',
        });
        emitRuntimeLog({
            level: 'warn',
            area: 'route-options',
            message: 'action:poll-local-snapshot:degraded',
            traceId: normalized.traceId,
            details: {
                capability,
                reasonCode: normalized.reasonCode,
                actionHint: normalized.actionHint,
                retryable: normalized.retryable,
                traceId: normalized.traceId,
                error: normalized.message,
            },
        });
        return {
            assets: [],
            health: [],
            generatedAt: new Date().toISOString(),
        } satisfies LocalRuntimeSnapshot;
    });
    const [nodeCatalog, runtimeLocalModels] = await Promise.all([
        resolvedDeps.listNodesCatalog(localCapability ? { capability: localCapability } : undefined).catch((error: unknown) => rethrowLocalRouteMetadataError({
            error,
            action: 'list-nodes-catalog',
        })),
        resolvedDeps.listRuntimeLocalAssets().catch((error: unknown) => rethrowLocalRouteMetadataError({
            error,
            action: 'list-runtime-local-models',
        })),
    ]);
    return {
        snapshot,
        nodeCatalog,
        runtimeLocalModels,
    };
}
type LoadRuntimeRouteOptionsDeps = {
    sdkListConnectors: typeof import('@renderer/features/runtime-config/runtime-config-connector-sdk-service').sdkListConnectors;
    sdkListConnectorModelDescriptors: typeof import('@renderer/features/runtime-config/runtime-config-connector-sdk-service').sdkListConnectorModelDescriptors;
    loadLocalRouteMetadata: typeof loadLocalRouteMetadata;
};
function buildLocalRouteMetadataFallback(error: unknown, capability: RuntimeCanonicalCapability, modId?: string): LocalRouteMetadata {
    const normalized = asNimiError(error, {
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        actionHint: 'check_runtime_daemon_health',
        source: 'runtime',
    });
    emitRuntimeLog({
        level: 'warn',
        area: 'route-options',
        message: 'action:load-local-route-metadata:degraded',
        traceId: normalized.traceId,
        details: {
            modId: String(modId || '').trim() || undefined,
            capability,
            reasonCode: normalized.reasonCode,
            actionHint: normalized.actionHint,
            retryable: normalized.retryable,
            traceId: normalized.traceId,
            error: normalized.message,
        },
    });
    return {
        snapshot: {
            assets: [],
            health: [],
            generatedAt: new Date().toISOString(),
        },
        nodeCatalog: [],
        runtimeLocalModels: [],
    };
}
function firstAvailableBinding(localModels: RuntimeRouteLocalOption[], connectors: RuntimeRouteConnectorOption[]): RuntimeRouteBinding | null {
  if (localModels.length > 0) {
    return toLocalBinding(localModels[0]!);
  }
  for (const connector of connectors) {
    const model = String(connector.models[0] || '').trim();
    if (!model) {
      continue;
    }
    return {
      source: 'cloud',
      connectorId: connector.id,
      model,
      provider: String(connector.provider || '').trim() || undefined,
    };
  }
  return null;
}

export function buildSelectedBinding(input: {
    capability: RuntimeCanonicalCapability;
    selectedBinding?: RuntimeRouteBinding | null;
    localModels: RuntimeRouteLocalOption[];
    connectors: RuntimeRouteConnectorOption[];
    localMetadataDegraded?: boolean;
    runtimeDefaultEngine?: string;
}): RuntimeRouteBinding | null {
    const { selectedBinding, localModels, connectors, localMetadataDegraded } = input;
    if (selectedBinding?.source === 'local') {
        const matchedLocalModel = pickMatchingLocalOption(localModels, selectedBinding);
        if (matchedLocalModel) {
            return toLocalBinding(matchedLocalModel);
        }
        return {
            ...selectedBinding,
            model: String(selectedBinding.model || selectedBinding.modelId || '').trim(),
            modelId: normalizeLocalModelRoot(String(selectedBinding.modelId || selectedBinding.model || '').trim()) || undefined,
            engine: inferLocalEngine(
                String(selectedBinding.engine || selectedBinding.provider || '').trim(),
                input.capability,
                input.runtimeDefaultEngine,
            ),
            provider: String(selectedBinding.provider || selectedBinding.engine || '').trim() || undefined,
            goRuntimeStatus: String(selectedBinding.goRuntimeStatus || '').trim() || (localMetadataDegraded ? 'degraded' : 'unavailable'),
        };
    }
    if (selectedBinding?.source === 'cloud') {
        const matchedBinding = connectors
            .flatMap((connector) => connector.models.map((model) => ({
                source: 'cloud' as const,
                connectorId: connector.id,
                model,
                provider: String(connector.provider || '').trim() || undefined,
            })))
            .find((item) => bindingKey(item) === bindingKey(selectedBinding)) || null;
        if (matchedBinding) {
            return matchedBinding;
        }
        return mergeCloudBindingProvider({
            ...selectedBinding,
            connectorId: String(selectedBinding.connectorId || '').trim(),
            model: String(selectedBinding.model || selectedBinding.modelId || '').trim(),
        }, connectors);
    }
    return null;
}
export async function loadRuntimeRouteOptions(input: {
    capability: RuntimeCanonicalCapability;
    modId?: string;
}, deps?: Partial<LoadRuntimeRouteOptionsDeps>): Promise<RuntimeRouteOptionsSnapshot> {
    const appStore = useAppStore.getState();
    const runtimeFields = appStore.runtimeFields as RuntimeFields;
    const selectedBinding = input.capability === 'text.embed'
        ? undefined
        : appStore.aiConfig.capabilities.selectedBindings[input.capability] as import('@nimiplatform/sdk/mod').RuntimeRouteBinding | null | undefined;
    const connectorService = await import('@renderer/features/runtime-config/runtime-config-connector-sdk-service');
    const resolvedDeps: LoadRuntimeRouteOptionsDeps = {
        sdkListConnectors: connectorService.sdkListConnectors,
        sdkListConnectorModelDescriptors: connectorService.sdkListConnectorModelDescriptors,
        loadLocalRouteMetadata,
        ...deps,
    };
    const connectorDescriptors = await resolvedDeps.sdkListConnectors();
    const connectors: RuntimeRouteConnectorOption[] = [];
    for (const connector of connectorDescriptors as ConnectorDescriptor[]) {
        const descriptors = await resolvedDeps.sdkListConnectorModelDescriptors(connector.id, false);
        const models = descriptors
            .filter((item) => modelSupportsCapability(item.capabilities, input.capability))
            .map((item) => item.modelId);
        if (models.length === 0) {
            continue;
        }
        const modelCapabilities = descriptors.reduce<Record<string, string[]>>((accumulator, item) => {
            if (!modelSupportsCapability(item.capabilities, input.capability)) {
                return accumulator;
            }
            accumulator[item.modelId] = item.capabilities;
            return accumulator;
        }, {});
        connectors.push({
            id: connector.id,
            label: String(connector.label || ''),
            vendor: String(connector.vendor || '').trim() || undefined,
            provider: String(connector.provider || '').trim() || undefined,
            models,
            modelCapabilities,
            modelProfiles: [],
        });
    }
    let localMetadataDegraded = false;
    const { snapshot, nodeCatalog, runtimeLocalModels } = await resolvedDeps.loadLocalRouteMetadata(input.capability)
        .catch((error) => {
        localMetadataDegraded = true;
        return buildLocalRouteMetadataFallback(error, input.capability, input.modId);
    });
    const nodeByProvider = new Map<string, {
        provider: string;
        providerHints?: RuntimeRouteLocalOption['providerHints'];
        defaultRank: number;
    }>();
    for (const node of nodeCatalog) {
        const provider = normalizeLocalEngine(node.provider);
        const current = nodeByProvider.get(provider);
        const candidateRank = providerDefaultRank(node.providerHints);
        if (!current
            || candidateRank < current.defaultRank
            || (!current.providerHints && node.providerHints)) {
            nodeByProvider.set(provider, {
                provider,
                providerHints: node.providerHints,
                defaultRank: candidateRank,
            });
        }
    }
    const snapshotByLocalModelId = new Map(snapshot.assets.map((item: LocalRuntimeAssetRecord) => [String(item.localAssetId || '').trim(), item]));
    const snapshotByLookup = new Map(snapshot.assets.map((item: LocalRuntimeAssetRecord) => [syncLookup(item.assetId, item.engine), item]));
    const localModels: RuntimeRouteLocalOption[] = runtimeLocalModels
        .filter((item: LocalRuntimeAssetRecord) => item.status !== 'removed')
        .filter((item: LocalRuntimeAssetRecord) => modelSupportsCapability(item.capabilities, input.capability))
        .map((item: LocalRuntimeAssetRecord) => {
        const snapshotModel = snapshotByLocalModelId.get(String(item.localAssetId || '').trim())
            || snapshotByLookup.get(syncLookup(item.assetId, item.engine))
            || null;
        if (snapshotModel && String(snapshotModel.status || '').trim().toLowerCase() !== String(item.status || '').trim().toLowerCase()) {
            emitRuntimeLog({
                level: 'warn',
                area: 'route-options',
                message: 'action:local-route-status-mismatch',
                details: {
                    capability: input.capability,
                    localModelId: item.localAssetId,
                    modelId: item.assetId,
                    engine: item.engine,
                    runtimeStatus: item.status,
                    snapshotStatus: snapshotModel.status,
                },
            });
        }
        return {
            localModelId: item.localAssetId,
            label: extractModelDisplayName(item.assetId),
            engine: item.engine,
            model: item.assetId,
            modelId: item.assetId,
            provider: normalizeLocalEngine(item.engine),
            providerHints: nodeByProvider.get(normalizeLocalEngine(item.engine))?.providerHints,
            endpoint: String(item.endpoint || snapshotModel?.endpoint || '').trim() || undefined,
            status: item.status,
            goRuntimeLocalModelId: String(item.localAssetId || '').trim() || undefined,
            goRuntimeStatus: String(item.status || '').trim() || undefined,
            capabilities: (item.capabilities || [])
                .map((capability: string) => normalizeCapabilityToken(capability))
                .filter((capability: RuntimeCanonicalCapability | null): capability is RuntimeCanonicalCapability => Boolean(capability)),
        };
    })
        .sort((left: RuntimeRouteLocalOption, right: RuntimeRouteLocalOption) => {
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
    const selected = buildSelectedBinding({
        capability: input.capability,
        selectedBinding,
        localModels: localModels,
        connectors,
        localMetadataDegraded,
        runtimeDefaultEngine,
    });
    const resolvedDefault = (localMetadataDegraded && selected?.source === 'local')
        ? selected
        : (firstAvailableBinding(localModels, connectors) || selected || undefined);
    return {
        capability: input.capability,
        selected,
        resolvedDefault,
        local: {
            models: localModels,
            defaultEndpoint: String(runtimeFields.localProviderEndpoint || runtimeFields.localOpenAiEndpoint || '').trim() || undefined,
        },
        connectors,
    };
}
function syncLookup(modelId: string, engine: string): string {
    return `${normalizeLocalEngine(engine)}::${String(modelId || '').trim().toLowerCase()}`;
}
