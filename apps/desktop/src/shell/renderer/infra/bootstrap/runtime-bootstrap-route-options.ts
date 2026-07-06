import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';
import {
  asNimiError,
  createNimiError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import { createNimiRuntimeRouteOptionsHostDeps, listNimiRuntimeRouteOptionsWithHost, nimiRuntimeRouteLocalKindForCapability, type NimiRuntimeCanonicalCapability, type NimiRuntimeRouteHostLocalMetadata, type NimiRuntimeRouteHostOptionsDeps, type NimiRuntimeRouteLocalAssetProjectionInput, type NimiRuntimeRouteOptionsHostRuntime, type NimiRuntimeRouteOptionsSnapshot, type NimiRuntimeRouteTargetRef } from '@nimiplatform/sdk/runtime';
import { LocalAssetKind, LocalAssetStatus, type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

const LOCAL_SNAPSHOT_TIMEOUT_MS = 3500;
const LOCAL_ASSET_PAGE_SIZE = 200;

type RuntimeLocalAssetRecord = Awaited<ReturnType<NimiRuntimeRouteOptionsHostRuntime['local']['listLocalAssets']>>['assets'][number];

type LocalRouteSnapshot = {
  readonly assets: readonly NimiRuntimeRouteLocalAssetProjectionInput[];
  readonly health: readonly never[];
  readonly generatedAt: string;
};

type LocalRouteMetadata = {
  readonly snapshot: LocalRouteSnapshot;
  readonly nodeCatalog: readonly never[];
  readonly runtimeLocalModels: readonly NimiRuntimeRouteLocalAssetProjectionInput[];
};

type LocalRouteMetadataDeps = {
  readonly pollLocalSnapshotWithTimeout: typeof pollLocalSnapshotWithTimeout;
  readonly listRuntimeLocalAssets: (
    capability: NimiRuntimeCanonicalCapability,
  ) => Promise<readonly NimiRuntimeRouteLocalAssetProjectionInput[]>;
};

type LoadRuntimeRouteOptionsDeps = {
  readonly runtime?: NimiRuntimeRouteOptionsHostRuntime;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly loadLocalRouteMetadata?: typeof loadLocalRouteMetadata;
} & Partial<NimiRuntimeRouteHostOptionsDeps>;

const DEFAULT_RUNTIME_ROUTE_OPTIONS_DEPS_SCOPE: Record<string, never> = {};

function toRuntimeLocalAssetProjection(asset: RuntimeLocalAssetRecord): NimiRuntimeRouteLocalAssetProjectionInput {
  return {
    localAssetId: asset.localAssetId,
    assetId: asset.assetId,
    kind: asset.kind,
    engine: asset.engine,
    endpoint: asset.endpoint,
    status: asset.status,
    capabilities: asset.capabilities,
    updatedAt: asset.updatedAt,
  };
}

function localAssetKindFilterForCapability(capability: NimiRuntimeCanonicalCapability): LocalAssetKind {
  switch (nimiRuntimeRouteLocalKindForCapability(capability)) {
    case 'chat':
      return LocalAssetKind.CHAT;
    case 'embedding':
      return LocalAssetKind.EMBEDDING;
    case 'image':
      return LocalAssetKind.IMAGE;
    case 'video':
      return LocalAssetKind.VIDEO;
    case 'tts':
      return LocalAssetKind.TTS;
    case 'stt':
      return LocalAssetKind.STT;
    default:
      return LocalAssetKind.UNSPECIFIED;
  }
}

async function listRuntimeLocalAssets(
  capability: NimiRuntimeCanonicalCapability,
  runtime: NimiRuntimeRouteOptionsHostRuntime = getDesktopRuntime(),
  callOptions?: RuntimeTypedCallOptions,
): Promise<readonly NimiRuntimeRouteLocalAssetProjectionInput[]> {
  const assets: NimiRuntimeRouteLocalAssetProjectionInput[] = [];
  let pageToken = '';
  do {
    const response = await runtime.local.listLocalAssets({
      statusFilter: LocalAssetStatus.UNSPECIFIED,
      kindFilter: localAssetKindFilterForCapability(capability),
      engineFilter: '',
      pageSize: LOCAL_ASSET_PAGE_SIZE,
      pageToken,
    }, callOptions);
    for (const asset of response.assets || []) {
      assets.push(toRuntimeLocalAssetProjection(asset));
    }
    pageToken = String(response.nextPageToken || '').trim();
  } while (pageToken);
  return assets;
}

async function fetchLocalRouteSnapshot(
  capability: NimiRuntimeCanonicalCapability,
  deps?: Pick<LocalRouteMetadataDeps, 'listRuntimeLocalAssets'>,
): Promise<LocalRouteSnapshot> {
  const assets = await (deps?.listRuntimeLocalAssets || listRuntimeLocalAssets)(capability);
  return {
    assets,
    health: [],
    generatedAt: new Date().toISOString(),
  };
}

async function pollLocalSnapshotWithTimeout(
  capability: NimiRuntimeCanonicalCapability,
  deps?: Pick<LocalRouteMetadataDeps, 'listRuntimeLocalAssets'>,
): Promise<LocalRouteSnapshot> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fetchLocalRouteSnapshot(capability, deps).catch((error) => {
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
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function rethrowLocalRouteMetadataError(input: {
  readonly error: unknown;
  readonly action: 'list-runtime-local-models';
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

export async function loadLocalRouteMetadata(
  capability: NimiRuntimeCanonicalCapability,
  deps?: Partial<LocalRouteMetadataDeps>,
): Promise<LocalRouteMetadata> {
  const resolvedDeps: LocalRouteMetadataDeps = {
    pollLocalSnapshotWithTimeout,
    listRuntimeLocalAssets,
    ...deps,
  };
  const snapshotPromise = resolvedDeps.pollLocalSnapshotWithTimeout(capability, {
    listRuntimeLocalAssets: resolvedDeps.listRuntimeLocalAssets,
  }).catch((error) => {
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
    } satisfies LocalRouteSnapshot;
  });
  const runtimeLocalModelsPromise = resolvedDeps.listRuntimeLocalAssets(capability).catch((error: unknown) => rethrowLocalRouteMetadataError({
    error,
    action: 'list-runtime-local-models',
  }));
  const [snapshot, runtimeLocalModels] = await Promise.all([
    snapshotPromise,
    runtimeLocalModelsPromise,
  ]);
  return {
    snapshot,
    nodeCatalog: [],
    runtimeLocalModels,
  };
}

function toRuntimeRouteHostLocalMetadata(metadata: LocalRouteMetadata): NimiRuntimeRouteHostLocalMetadata {
  return {
    snapshotAssets: metadata.snapshot.assets,
    nodeCatalog: metadata.nodeCatalog,
    runtimeLocalModels: metadata.runtimeLocalModels,
  };
}

function buildLocalRouteMetadataFallback(
  error: unknown,
  capability: NimiRuntimeCanonicalCapability,
  targetId?: string,
): LocalRouteMetadata {
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
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetId?: string;
  readonly selectedTargetRef?: NimiRuntimeRouteTargetRef | null;
}, deps?: Partial<LoadRuntimeRouteOptionsDeps>): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const localRouteMetadataLoader = deps?.loadLocalRouteMetadata ?? loadLocalRouteMetadata;
  const runtime = deps?.runtime ?? getDesktopRuntime();
  return listNimiRuntimeRouteOptionsWithHost({
    capability: input.capability,
    targetId: input.targetId,
    selectedTargetRef: input.selectedTargetRef,
  }, createNimiRuntimeRouteOptionsHostDeps(runtime, {
    scope: deps?.scope || deps || DEFAULT_RUNTIME_ROUTE_OPTIONS_DEPS_SCOPE,
    callOptions: deps?.callOptions,
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
