import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { localRuntime, listGoRuntimeModelsSnapshot } from '@runtime/local-runtime';
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
function inferSource(provider: string): 'local' | 'cloud' {
    const lower = String(provider || '').trim().toLowerCase();
    if (lower.startsWith('local') || lower === 'localai' || lower === 'nexa' || lower === 'nimi_media') {
        return 'local';
    }
    return 'cloud';
}
function fallbackLocalEngine(capability?: RuntimeCanonicalCapability): string {
    if (resolveLocalRoutePlatform() === 'windows') {
        if (capability === 'image.generate' || capability === 'video.generate') {
            return 'nimi_media';
        }
        if (capability === 'text.generate'
            || capability === 'text.embed'
            || capability === 'audio.synthesize'
            || capability === 'audio.transcribe') {
            return 'nexa';
        }
    }
    return 'localai';
}
function inferLocalEngine(provider: string, capability?: RuntimeCanonicalCapability, runtimeDefaultEngine?: string): string {
    const rawProvider = String(provider || '').trim().toLowerCase();
    if (rawProvider === 'localai' || rawProvider === 'nexa' || rawProvider === 'nimi_media' || rawProvider === 'nimimedia') {
        return normalizeLocalEngine(rawProvider);
    }
    const defaultEngine = String(runtimeDefaultEngine || '').trim();
    if (defaultEngine) {
        const normalizedDefault = normalizeLocalEngine(defaultEngine);
        return normalizedDefault;
    }
    return fallbackLocalEngine(capability);
}
function defaultLocalAdapter(provider: string, capability: RuntimeCanonicalCapability): string {
    const normalizedProvider = normalizeLocalEngine(provider);
    if (normalizedProvider === 'nexa') {
        return 'nexa_native_adapter';
    }
    if (normalizedProvider === 'nimi_media') {
        return 'nimi_media_native_adapter';
    }
    if (capability === 'image.generate'
        || capability === 'video.generate'
        || capability === 'audio.synthesize'
        || capability === 'audio.transcribe') {
        return 'localai_native_adapter';
    }
    return 'openai_compat_adapter';
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
function rankGoRuntimeStatus(value: unknown): number {
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
export function pickPreferredGoRuntimeModel(goRuntimeModels: Array<{
    localModelId?: string;
    modelId?: string;
    engine?: string;
    status?: string;
}>, modelId: string, engine: string): {
    localModelId?: string;
    status?: string;
} | null {
    const matches = goRuntimeModels
        .filter((goModel) => syncLookup(goModel.modelId || '', goModel.engine || '') === syncLookup(modelId, engine))
        .filter((goModel) => String(goModel.status || '').trim().toLowerCase() !== 'removed')
        .sort((left, right) => {
        const rankDelta = rankGoRuntimeStatus(left.status) - rankGoRuntimeStatus(right.status);
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
    const targetEngine = normalizeLocalEngine(binding.engine || binding.provider || '');
    const byModelAndEngine = localModels.find((item) => (normalizeLocalModelRoot(String(item.modelId || item.model || '').trim()) === targetModelId
        && normalizeLocalEngine(item.engine || item.provider || '') === targetEngine)) || null;
    if (byModelAndEngine) {
        return byModelAndEngine;
    }
    return localModels.find((item) => (normalizeLocalModelRoot(String(item.modelId || item.model || '').trim()) === targetModelId)) || null;
}
async function pollLocalSnapshotWithTimeout(): Promise<{
    models: Array<{
        localModelId: string;
        engine: string;
        modelId: string;
        endpoint: string;
        capabilities: string[];
        status: 'installed' | 'active' | 'unhealthy' | 'removed';
    }>;
}> {
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
    goRuntimeModels: Awaited<ReturnType<typeof listGoRuntimeModelsSnapshot>>;
};
type LocalRouteMetadataDeps = {
    pollLocalSnapshotWithTimeout: typeof pollLocalSnapshotWithTimeout;
    listNodesCatalog: typeof localRuntime.listNodesCatalog;
    listGoRuntimeModelsSnapshot: typeof listGoRuntimeModelsSnapshot;
};
function rethrowLocalRouteMetadataError(input: {
    error: unknown;
    action: 'list-nodes-catalog' | 'list-go-runtime-models';
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
        listGoRuntimeModelsSnapshot,
        ...deps,
    };
    const [snapshot, nodeCatalog, goRuntimeModels] = await Promise.all([
        resolvedDeps.pollLocalSnapshotWithTimeout(),
        resolvedDeps.listNodesCatalog(localCapability ? { capability: localCapability } : undefined).catch((error) => rethrowLocalRouteMetadataError({
            error,
            action: 'list-nodes-catalog',
        })),
        resolvedDeps.listGoRuntimeModelsSnapshot().catch((error) => rethrowLocalRouteMetadataError({
            error,
            action: 'list-go-runtime-models',
        })),
    ]);
    return {
        snapshot,
        nodeCatalog,
        goRuntimeModels,
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
            models: [],
        },
        nodeCatalog: [],
        goRuntimeModels: [],
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
    runtimeFields: RuntimeFields;
    localModels: RuntimeRouteLocalOption[];
    connectors: RuntimeRouteConnectorOption[];
    localMetadataDegraded?: boolean;
    runtimeDefaultEngine?: string;
}): RuntimeRouteBinding {
    const { runtimeFields, localModels, connectors, localMetadataDegraded } = input;
    const preferredSource = inferSource(runtimeFields.provider);
    if (preferredSource === 'local') {
        const preferredBinding: RuntimeRouteBinding = {
            source: 'local',
            connectorId: '',
            model: String(runtimeFields.localProviderModel || '').trim(),
            modelId: normalizeLocalModelRoot(String(runtimeFields.localProviderModel || '').trim()) || undefined,
            engine: inferLocalEngine(runtimeFields.provider, input.capability, input.runtimeDefaultEngine),
            provider: inferLocalEngine(runtimeFields.provider, input.capability, input.runtimeDefaultEngine),
        };
        const matchedLocalModel = pickMatchingLocalOption(localModels, preferredBinding);
        if (matchedLocalModel) {
            return toLocalBinding(matchedLocalModel);
        }
        if (localModels.length > 0) {
            return toLocalBinding(localModels[0]!);
        }
        if (input.capability === 'text.embed') {
            return firstAvailableBinding(localModels, connectors) || {
                ...preferredBinding,
                model: '',
                modelId: undefined,
            };
        }
        if (localMetadataDegraded) {
            return preferredBinding;
        }
        return {
            ...preferredBinding,
            adapter: defaultLocalAdapter(runtimeFields.provider, input.capability),
            endpoint: String(runtimeFields.localProviderEndpoint || runtimeFields.localOpenAiEndpoint || '').trim() || undefined,
        };
    }
    const preferredBinding: RuntimeRouteBinding = {
        source: 'cloud',
        connectorId: String(runtimeFields.connectorId || '').trim(),
        model: String(runtimeFields.localProviderModel || '').trim(),
        provider: String(runtimeFields.provider || '').trim() || undefined,
    };
    const availableBindings: RuntimeRouteBinding[] = [
        ...localModels.map((item) => toLocalBinding(item)),
        ...connectors.flatMap((connector) => connector.models.map((model) => ({
            source: 'cloud' as const,
            connectorId: connector.id,
            model,
            provider: String(connector.provider || '').trim() || undefined,
        }))),
    ];
    const matchedBinding = availableBindings.find((item) => bindingKey(item) === bindingKey(preferredBinding)) || null;
    if (matchedBinding) {
        return matchedBinding;
    }
    return firstAvailableBinding(localModels, connectors) || mergeCloudBindingProvider(preferredBinding, connectors);
}
export async function loadRuntimeRouteOptions(input: {
    capability: RuntimeCanonicalCapability;
    modId?: string;
}, deps?: Partial<LoadRuntimeRouteOptionsDeps>): Promise<RuntimeRouteOptionsSnapshot> {
    const runtimeFields = useAppStore.getState().runtimeFields as RuntimeFields;
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
    const { snapshot, nodeCatalog, goRuntimeModels } = await resolvedDeps.loadLocalRouteMetadata(input.capability)
        .catch((error) => {
        localMetadataDegraded = true;
        return buildLocalRouteMetadataFallback(error, input.capability, input.modId);
    });
    const nodeByProvider = new Map<string, {
        provider: string;
        adapter: string;
        providerHints?: RuntimeRouteLocalOption['providerHints'];
        defaultRank: number;
    }>();
    for (const node of nodeCatalog) {
        const provider = normalizeLocalEngine(node.provider);
        const current = nodeByProvider.get(provider);
        const candidateRank = providerDefaultRank(node.providerHints);
        if (!current
            || candidateRank < current.defaultRank
            || (!current.providerHints && node.providerHints)
            || (!current.adapter && node.adapter)) {
            nodeByProvider.set(provider, {
                provider,
                adapter: String(node.adapter || '').trim(),
                providerHints: node.providerHints,
                defaultRank: candidateRank,
            });
        }
    }
    const localModels: RuntimeRouteLocalOption[] = snapshot.models
        .filter((item) => item.status !== 'removed')
        .filter((item) => modelSupportsCapability(item.capabilities, input.capability))
        .map((item) => {
        const preferredGoRuntimeModel = pickPreferredGoRuntimeModel(goRuntimeModels, item.modelId, item.engine);
        return {
            localModelId: item.localModelId,
            label: item.modelId,
            engine: item.engine,
            model: item.modelId,
            modelId: item.modelId,
            provider: normalizeLocalEngine(item.engine),
            adapter: nodeByProvider.get(normalizeLocalEngine(item.engine))?.adapter
                || defaultLocalAdapter(item.engine, input.capability),
            providerHints: nodeByProvider.get(normalizeLocalEngine(item.engine))?.providerHints,
            endpoint: item.endpoint,
            status: item.status,
            goRuntimeLocalModelId: preferredGoRuntimeModel?.localModelId,
            goRuntimeStatus: preferredGoRuntimeModel?.status,
            capabilities: item.capabilities
                .map((capability) => normalizeCapabilityToken(capability))
                .filter((capability): capability is RuntimeCanonicalCapability => Boolean(capability)),
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
    const selected = buildSelectedBinding({
        capability: input.capability,
        runtimeFields,
        localModels: localModels,
        connectors,
        localMetadataDegraded,
        runtimeDefaultEngine,
    });
    const resolvedDefault = (localMetadataDegraded && selected.source === 'local')
        ? selected
        : (firstAvailableBinding(localModels, connectors) || selected);
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
