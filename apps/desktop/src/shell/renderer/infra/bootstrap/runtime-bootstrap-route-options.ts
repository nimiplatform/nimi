import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { localRuntime, type LocalRuntimeAssetRecord, type LocalRuntimeSnapshot } from '@runtime/local-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
    buildRuntimeRouteOptionsProjection,
    runtimeRouteLocalKindForCapability,
    type RuntimeCanonicalCapability,
    type RuntimeRouteConnectorProjectionInput,
    type RuntimeRouteOptionsSnapshot,
} from "@nimiplatform/sdk/ai";
type ConnectorDescriptor = {
    id: string;
    label?: string;
    vendor?: string;
    provider?: string;
};

const LOCAL_SNAPSHOT_TIMEOUT_MS = 3500;
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
    const localCapability = runtimeRouteLocalKindForCapability(capability);
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
    connectors: RuntimeRouteConnectorProjectionInput[];
    snapshot: LocalRouteMetadata['snapshot'];
    nodeCatalog: LocalRouteMetadata['nodeCatalog'];
    runtimeLocalModels: LocalRouteMetadata['runtimeLocalModels'];
    localMetadataDegraded: boolean;
};
const DEFAULT_RUNTIME_ROUTE_OPTIONS_DEPS_SCOPE: Record<string, never> = {};
const runtimeRouteOptionsInflightByScope = new WeakMap<object, Map<string, Promise<LoadRuntimeRouteOptionsData>>>();
function buildLocalRouteMetadataFallback(error: unknown, capability: RuntimeCanonicalCapability, targetId?: string): LocalRouteMetadata {
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
            targetId: String(targetId || '').trim() || undefined,
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
async function loadRuntimeRouteOptionsData(capability: RuntimeCanonicalCapability, targetId: string | undefined, resolvedDeps: LoadRuntimeRouteOptionsDeps): Promise<LoadRuntimeRouteOptionsData> {
    const connectorDescriptorsPromise = resolvedDeps.sdkListConnectors().catch((error) => {
        const normalized = asNimiError(error, {
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'check_runtime_daemon_health',
            source: 'runtime',
        });
        emitRuntimeLog({
            level: 'warn',
            area: 'route-options',
            message: 'action:list-connectors:degraded',
            traceId: normalized.traceId,
            details: {
                targetId: String(targetId || '').trim() || undefined,
                capability,
                reasonCode: normalized.reasonCode,
                actionHint: normalized.actionHint,
                retryable: normalized.retryable,
                traceId: normalized.traceId,
                error: normalized.message,
            },
        });
        return [] as ConnectorDescriptor[];
    });
    let localMetadataDegraded = false;
    const localMetadataPromise = resolvedDeps.loadLocalRouteMetadata(capability)
        .catch((error) => {
        localMetadataDegraded = true;
        return buildLocalRouteMetadataFallback(error, capability, targetId);
    });
    const [connectorDescriptors, localMetadata] = await Promise.all([
        connectorDescriptorsPromise,
        localMetadataPromise,
    ]);
    const connectorResults: Array<RuntimeRouteConnectorProjectionInput | null> = await Promise.all((connectorDescriptors as ConnectorDescriptor[]).map(async (connector) => {
        const descriptors = await resolvedDeps.sdkListConnectorModelDescriptors(connector.id, false).catch((error) => {
            const normalized = asNimiError(error, {
                reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
                actionHint: 'check_runtime_daemon_health',
                source: 'runtime',
            });
            emitRuntimeLog({
                level: 'warn',
                area: 'route-options',
                message: 'action:list-connector-model-descriptors:degraded',
                traceId: normalized.traceId,
                details: {
                    targetId: String(targetId || '').trim() || undefined,
                    capability,
                    connectorId: String(connector.id || '').trim() || undefined,
                    reasonCode: normalized.reasonCode,
                    actionHint: normalized.actionHint,
                    retryable: normalized.retryable,
                    traceId: normalized.traceId,
                    error: normalized.message,
                },
            });
            return [];
        });
        return {
            descriptor: {
                id: connector.id,
                label: connector.label,
                vendor: connector.vendor,
                provider: connector.provider,
            },
            modelDescriptors: descriptors,
        };
    }));
    const connectors = connectorResults.filter((connector): connector is RuntimeRouteConnectorProjectionInput => connector !== null);
    return {
        connectors,
        snapshot: localMetadata.snapshot,
        nodeCatalog: localMetadata.nodeCatalog,
        runtimeLocalModels: localMetadata.runtimeLocalModels,
        localMetadataDegraded,
    };
}
function loadRuntimeRouteOptionsDataSingleFlight(capability: RuntimeCanonicalCapability, targetId: string | undefined, resolvedDeps: LoadRuntimeRouteOptionsDeps, scope: object): Promise<LoadRuntimeRouteOptionsData> {
    const inflight = getRuntimeRouteOptionsInflightMap(scope);
    const existing = inflight.get(capability);
    if (existing) {
        return existing;
    }
    const request = loadRuntimeRouteOptionsData(capability, targetId, resolvedDeps)
        .finally(() => {
        if (inflight.get(capability) === request) {
            inflight.delete(capability);
        }
    });
    inflight.set(capability, request);
    return request;
}
export async function loadRuntimeRouteOptions(input: {
    capability: RuntimeCanonicalCapability;
    targetId?: string;
}, deps?: Partial<LoadRuntimeRouteOptionsDeps>): Promise<RuntimeRouteOptionsSnapshot> {
    const appStore = useAppStore.getState();
    const selectedBinding = input.capability === 'text.embed'
        ? undefined
        : appStore.aiConfig.capabilities.selectedBindings[input.capability] as import('@nimiplatform/sdk/ai').RuntimeRouteBinding | null | undefined;
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
        input.targetId,
        resolvedDeps,
        depsScope,
    );
    return buildRuntimeRouteOptionsProjection({
        capability: input.capability,
        selectedBinding,
        connectors,
        snapshotAssets: snapshot.assets,
        nodeCatalog,
        runtimeLocalModels,
        localMetadataDegraded,
        onLocalStatusMismatch: (mismatch) => {
            emitRuntimeLog({
                level: 'warn',
                area: 'route-options',
                message: 'action:local-route-status-mismatch',
                details: {
                    ...mismatch,
                },
            });
        },
    });
}
