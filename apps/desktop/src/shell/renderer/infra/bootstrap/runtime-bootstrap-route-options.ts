import {
  getPlatformClient } from '@nimiplatform/sdk';
import { asNimiError,
  createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { localRuntime,
  type LocalRuntimeAssetRecord,
  type LocalRuntimeSnapshot } from '@runtime/local-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
  createRuntimeRouteOptionsPlatformHostDeps,
  listRuntimeRouteOptionsWithHost,
  runtimeRouteLocalKindForCapability,
  type RuntimeCanonicalCapability,
  type RuntimeRouteHostLocalMetadata,
  type RuntimeRouteHostOptionsDeps,
  type RuntimeRouteOptionsClient,
  type RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';

const LOCAL_SNAPSHOT_TIMEOUT_MS = 3500;

async function fetchLocalRouteSnapshot(): Promise<LocalRuntimeSnapshot> {
    const assets = await localRuntime.listAssets();
    return {
        assets,
        health: [],
        generatedAt: new Date().toISOString(),
    };
}

async function pollLocalSnapshotWithTimeout(): Promise<LocalRuntimeSnapshot> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            fetchLocalRouteSnapshot().catch((error) => {
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
    platformClient?: RuntimeRouteOptionsClient;
    loadLocalRouteMetadata?: typeof loadLocalRouteMetadata;
} & Partial<RuntimeRouteHostOptionsDeps>;
const DEFAULT_RUNTIME_ROUTE_OPTIONS_DEPS_SCOPE: Record<string, never> = {};
function toRuntimeRouteHostLocalMetadata(metadata: LocalRouteMetadata): RuntimeRouteHostLocalMetadata {
    return {
        snapshotAssets: metadata.snapshot.assets,
        nodeCatalog: metadata.nodeCatalog,
        runtimeLocalModels: metadata.runtimeLocalModels,
    };
}
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
export async function loadRuntimeRouteOptions(input: {
    capability: RuntimeCanonicalCapability;
    targetId?: string;
}, deps?: Partial<LoadRuntimeRouteOptionsDeps>): Promise<RuntimeRouteOptionsSnapshot> {
    const appStore = useAppStore.getState();
    const selectedBinding = input.capability === 'text.embed'
        ? undefined
        : appStore.aiConfig.capabilities.selectedBindings[input.capability] as import('@nimiplatform/sdk/runtime').RuntimeRouteBinding | null | undefined;
    const localRouteMetadataLoader = deps?.loadLocalRouteMetadata ?? loadLocalRouteMetadata;
    const platformClient = deps?.platformClient ?? getPlatformClient();
    return listRuntimeRouteOptionsWithHost({
        capability: input.capability,
        targetId: input.targetId,
        selectedBinding,
    }, createRuntimeRouteOptionsPlatformHostDeps(platformClient, {
        scope: deps || DEFAULT_RUNTIME_ROUTE_OPTIONS_DEPS_SCOPE,
        listConnectors: deps?.listConnectors,
        listConnectorModelDescriptors: deps?.listConnectorModelDescriptors,
        loadLocalRouteMetadata: async (context) => toRuntimeRouteHostLocalMetadata(await localRouteMetadataLoader(context.capability)),
        onListConnectorsError: (error, context) => {
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
                    targetId: context.targetId,
                    capability: context.capability,
                    reasonCode: normalized.reasonCode,
                    actionHint: normalized.actionHint,
                    retryable: normalized.retryable,
                    traceId: normalized.traceId,
                    error: normalized.message,
                },
            });
            return [];
        },
        onListConnectorModelDescriptorsError: (error, context) => {
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
                    targetId: context.targetId,
                    capability: context.capability,
                    connectorId: context.connectorId,
                    reasonCode: normalized.reasonCode,
                    actionHint: normalized.actionHint,
                    retryable: normalized.retryable,
                    traceId: normalized.traceId,
                    error: normalized.message,
                },
            });
            return [];
        },
        onLocalRouteMetadataError: (error, context) => ({
            metadata: toRuntimeRouteHostLocalMetadata(buildLocalRouteMetadataFallback(error, context.capability, context.targetId)),
            localMetadataDegraded: true,
        }),
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
    }));
}
