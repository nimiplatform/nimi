import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { localRuntime, type LocalRuntimeAssetRecord, type LocalRuntimeSnapshot } from '@runtime/local-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
    buildRuntimeRouteOptionsSnapshot,
    buildRuntimeRouteSelectedBinding,
    normalizeRuntimeRouteCapabilityToken,
    runtimeRouteLocalKindSupportsCapability,
    runtimeRouteModelSupportsCapability,
    type RuntimeCanonicalCapability,
    type RuntimeRouteBinding,
    type RuntimeRouteConnectorOption,
    type RuntimeRouteLocalOption,
    type RuntimeRouteOptionsSnapshot,
} from "@nimiplatform/sdk/mod";
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
    const snapshotPromise = resolvedDeps.pollLocalSnapshotWithTimeout().catch((error) => {
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
    const nodeCatalogPromise = resolvedDeps.listNodesCatalog(localCapability ? { capability: localCapability } : undefined).catch((error: unknown) => rethrowLocalRouteMetadataError({
            error,
            action: 'list-nodes-catalog',
        }));
    const runtimeLocalModelsPromise = resolvedDeps.listRuntimeLocalAssets().catch((error: unknown) => rethrowLocalRouteMetadataError({
            error,
            action: 'list-runtime-local-models',
        }));
    const [snapshot, nodeCatalog, runtimeLocalModels] = await Promise.all([
        snapshotPromise,
        nodeCatalogPromise,
        runtimeLocalModelsPromise,
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
type LoadRuntimeRouteOptionsData = {
    connectors: RuntimeRouteConnectorOption[];
    snapshot: LocalRouteMetadata['snapshot'];
    nodeCatalog: LocalRouteMetadata['nodeCatalog'];
    runtimeLocalModels: LocalRouteMetadata['runtimeLocalModels'];
    localMetadataDegraded: boolean;
};
const DEFAULT_RUNTIME_ROUTE_OPTIONS_DEPS_SCOPE: Record<string, never> = {};
const runtimeRouteOptionsInflightByScope = new WeakMap<object, Map<string, Promise<LoadRuntimeRouteOptionsData>>>();
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
function getRuntimeRouteOptionsInflightMap(scope: object): Map<string, Promise<LoadRuntimeRouteOptionsData>> {
    const existing = runtimeRouteOptionsInflightByScope.get(scope);
    if (existing) {
        return existing;
    }
    const created = new Map<string, Promise<LoadRuntimeRouteOptionsData>>();
    runtimeRouteOptionsInflightByScope.set(scope, created);
    return created;
}
async function loadRuntimeRouteOptionsData(capability: RuntimeCanonicalCapability, modId: string | undefined, resolvedDeps: LoadRuntimeRouteOptionsDeps): Promise<LoadRuntimeRouteOptionsData> {
    const connectorDescriptorsPromise = resolvedDeps.sdkListConnectors();
    let localMetadataDegraded = false;
    const localMetadataPromise = resolvedDeps.loadLocalRouteMetadata(capability)
        .catch((error) => {
        localMetadataDegraded = true;
        return buildLocalRouteMetadataFallback(error, capability, modId);
    });
    const [connectorDescriptors, localMetadata] = await Promise.all([
        connectorDescriptorsPromise,
        localMetadataPromise,
    ]);
    const connectorResults: Array<RuntimeRouteConnectorOption | null> = await Promise.all((connectorDescriptors as ConnectorDescriptor[]).map(async (connector) => {
        const descriptors = await resolvedDeps.sdkListConnectorModelDescriptors(connector.id, false);
        const models = descriptors
            .filter((item) => runtimeRouteModelSupportsCapability(item.capabilities, capability))
            .map((item) => item.modelId);
        if (models.length === 0) {
            return null;
        }
        const modelCapabilities = descriptors.reduce<Record<string, string[]>>((accumulator, item) => {
            if (!runtimeRouteModelSupportsCapability(item.capabilities, capability)) {
                return accumulator;
            }
            accumulator[item.modelId] = item.capabilities;
            return accumulator;
        }, {});
        return {
            id: connector.id,
            label: String(connector.label || ''),
            vendor: String(connector.vendor || '').trim() || undefined,
            provider: String(connector.provider || '').trim() || undefined,
            models,
            modelCapabilities,
            modelProfiles: [],
        };
    }));
    const connectors = connectorResults.filter((connector): connector is RuntimeRouteConnectorOption => connector !== null);
    return {
        connectors,
        snapshot: localMetadata.snapshot,
        nodeCatalog: localMetadata.nodeCatalog,
        runtimeLocalModels: localMetadata.runtimeLocalModels,
        localMetadataDegraded,
    };
}
function loadRuntimeRouteOptionsDataSingleFlight(capability: RuntimeCanonicalCapability, modId: string | undefined, resolvedDeps: LoadRuntimeRouteOptionsDeps, scope: object): Promise<LoadRuntimeRouteOptionsData> {
    const inflight = getRuntimeRouteOptionsInflightMap(scope);
    const existing = inflight.get(capability);
    if (existing) {
        return existing;
    }
    const request = loadRuntimeRouteOptionsData(capability, modId, resolvedDeps)
        .finally(() => {
        if (inflight.get(capability) === request) {
            inflight.delete(capability);
        }
    });
    inflight.set(capability, request);
    return request;
}
export function buildSelectedBinding(input: {
    capability: RuntimeCanonicalCapability;
    selectedBinding?: RuntimeRouteBinding | null;
    localModels: RuntimeRouteLocalOption[];
    connectors: RuntimeRouteConnectorOption[];
    localMetadataDegraded?: boolean;
    runtimeDefaultEngine?: string;
}): RuntimeRouteBinding | null {
    const selected = buildRuntimeRouteSelectedBinding(input);
    if (selected?.source === 'local') {
        const normalizedModelId = normalizeLocalModelRoot(String(selected.modelId || selected.model || '').trim()) || undefined;
        if (!String(selected.engine || '').trim()) {
            const inferredEngine = inferLocalEngine(
                String(selected.provider || input.selectedBinding?.engine || input.selectedBinding?.provider || '').trim(),
                input.capability,
                input.runtimeDefaultEngine,
            );
            return {
                ...selected,
                model: normalizedModelId || String(selected.model || '').trim(),
                modelId: normalizedModelId,
                engine: inferredEngine,
                provider: String(selected.provider || inferredEngine).trim() || undefined,
            };
        }
        return {
            ...selected,
            model: normalizedModelId || String(selected.model || '').trim(),
            modelId: normalizedModelId,
        };
    }
    return selected;
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
    let connectorService: typeof import('@renderer/features/runtime-config/runtime-config-connector-sdk-service') | null = null;
    const getConnectorService = async () => {
        if (!connectorService) {
            connectorService = await import('@renderer/features/runtime-config/runtime-config-connector-sdk-service');
        }
        return connectorService;
    };
    const resolvedDeps: LoadRuntimeRouteOptionsDeps = {
        sdkListConnectors: deps?.sdkListConnectors || (await getConnectorService()).sdkListConnectors,
        sdkListConnectorModelDescriptors: deps?.sdkListConnectorModelDescriptors || (await getConnectorService()).sdkListConnectorModelDescriptors,
        loadLocalRouteMetadata,
        ...deps,
    };
    const depsScope = deps || DEFAULT_RUNTIME_ROUTE_OPTIONS_DEPS_SCOPE;
    const { connectors, snapshot, nodeCatalog, runtimeLocalModels, localMetadataDegraded } = await loadRuntimeRouteOptionsDataSingleFlight(
        input.capability,
        input.modId,
        resolvedDeps,
        depsScope,
    );
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
        .filter((item: LocalRuntimeAssetRecord) => runtimeRouteModelSupportsCapability(item.capabilities, input.capability)
        || runtimeRouteLocalKindSupportsCapability(item.kind, input.capability))
        .map((item: LocalRuntimeAssetRecord) => {
        const snapshotModel = snapshotByLocalModelId.get(String(item.localAssetId || '').trim())
            || snapshotByLookup.get(syncLookup(item.assetId, item.engine))
            || null;
        const normalizedCapabilities = (item.capabilities || [])
            .map((capability: string) => normalizeRuntimeRouteCapabilityToken(capability))
            .filter((capability: RuntimeCanonicalCapability | null): capability is RuntimeCanonicalCapability => Boolean(capability));
        const routeCapabilities = normalizedCapabilities.length > 0
            ? normalizedCapabilities
            : (runtimeRouteLocalKindSupportsCapability(item.kind, input.capability) ? [input.capability] : []);
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
            capabilities: routeCapabilities,
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
    return buildRuntimeRouteOptionsSnapshot({
        capability: input.capability,
        selectedBinding,
        selectedOverride: selected,
        localModels,
        connectors,
        defaultLocalEndpoint: String(runtimeFields.localProviderEndpoint || runtimeFields.localOpenAiEndpoint || '').trim() || undefined,
        localMetadataDegraded,
        runtimeDefaultEngine,
    });
}
function syncLookup(modelId: string, engine: string): string {
    return `${normalizeLocalEngine(engine)}::${String(modelId || '').trim().toLowerCase()}`;
}
