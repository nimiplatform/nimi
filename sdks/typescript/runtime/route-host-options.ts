import {
  ConnectorKind,
  ConnectorStatus,
  LocalAssetKind,
  LocalAssetStatus,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client';
import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteTargetRef,
  NimiRuntimeRouteOptionsSnapshot,
} from './route-options';
import {
  normalizeLower,
  normalizeNimiRuntimeHostRouteCapability,
  normalizeText,
} from './route-host-codecs';
import {
  nimiRuntimeConnectorVendorLabel,
  providerToNimiRuntimeConnectorVendor,
} from './connector-inventory';
import {
  buildNimiRuntimeRouteOptionsProjection,
  type NimiRuntimeRouteConnectorDescriptorProjectionInput,
  type NimiRuntimeRouteConnectorModelDescriptorProjectionInput,
  type NimiRuntimeRouteConnectorProjectionInput,
  type NimiRuntimeRouteHostLocalMetadata,
  type NimiRuntimeRouteLocalAssetProjectionInput,
  type NimiRuntimeRouteLocalStatusMismatch,
} from './route-host-projection';

export type {
  NimiRuntimeRouteConnectorDescriptorProjectionInput,
  NimiRuntimeRouteConnectorModelDescriptorProjectionInput,
  NimiRuntimeRouteConnectorProjectionInput,
  NimiRuntimeRouteHostLocalMetadata,
  NimiRuntimeRouteLocalAssetProjectionInput,
  NimiRuntimeRouteLocalStatusMismatch,
  NimiRuntimeRouteNodeCatalogProjectionInput,
  NimiRuntimeRouteOptionsProjectionInput,
} from './route-host-projection';

export interface NimiRuntimeRouteHostOptionsContext {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetId?: string;
}

export interface NimiRuntimeRouteHostConnectorModelDescriptorsContext extends NimiRuntimeRouteHostOptionsContext {
  readonly connectorId: string;
}

export interface NimiRuntimeRouteHostLocalMetadataFallback {
  readonly metadata: NimiRuntimeRouteHostLocalMetadata;
  readonly localMetadataDegraded?: boolean;
}

export interface NimiRuntimeRouteHostOptionsDeps {
  readonly scope?: object;
  readonly listConnectors: () => Promise<readonly NimiRuntimeRouteConnectorDescriptorProjectionInput[]>;
  readonly listConnectorModelDescriptors: (
    connectorId: string,
  ) => Promise<readonly NimiRuntimeRouteConnectorModelDescriptorProjectionInput[]>;
  readonly loadLocalRouteMetadata: (
    context: NimiRuntimeRouteHostOptionsContext,
  ) => Promise<NimiRuntimeRouteHostLocalMetadata>;
  readonly onListConnectorsError?: (
    error: unknown,
    context: NimiRuntimeRouteHostOptionsContext,
  ) => readonly NimiRuntimeRouteConnectorDescriptorProjectionInput[] | Promise<readonly NimiRuntimeRouteConnectorDescriptorProjectionInput[]>;
  readonly onListConnectorModelDescriptorsError?: (
    error: unknown,
    context: NimiRuntimeRouteHostConnectorModelDescriptorsContext,
  ) => readonly NimiRuntimeRouteConnectorModelDescriptorProjectionInput[] | Promise<readonly NimiRuntimeRouteConnectorModelDescriptorProjectionInput[]>;
  readonly onLocalRouteMetadataError?: (
    error: unknown,
    context: NimiRuntimeRouteHostOptionsContext,
  ) => NimiRuntimeRouteHostLocalMetadataFallback | Promise<NimiRuntimeRouteHostLocalMetadataFallback>;
  readonly onLocalStatusMismatch?: (mismatch: NimiRuntimeRouteLocalStatusMismatch) => void;
}

export interface NimiRuntimeRouteOptionsHostRuntime {
  readonly connectors: Pick<RuntimeTypedClient, 'listConnectors' | 'listConnectorModels'>;
  readonly local: Pick<RuntimeTypedClient, 'listLocalAssets'>;
}

export interface NimiRuntimeRouteOptionsHostDepsOptions extends Partial<NimiRuntimeRouteHostOptionsDeps> {
  readonly callOptions?: RuntimeTypedCallOptions;
}

interface HostOptionsData {
  readonly connectors: readonly NimiRuntimeRouteConnectorProjectionInput[];
  readonly localMetadata: NimiRuntimeRouteHostLocalMetadata;
  readonly localMetadataDegraded: boolean;
}

const CONNECTOR_PAGE_SIZE = 200;
const CONNECTOR_MODEL_PAGE_SIZE = 200;
const LOCAL_ASSET_PAGE_SIZE = 200;
const DEFAULT_HOST_OPTIONS_SCOPE: Record<string, never> = {};
const hostOptionsInflightByScope = new WeakMap<object, Map<string, Promise<HostOptionsData>>>();

async function listHostData(
  context: NimiRuntimeRouteHostOptionsContext,
  deps: NimiRuntimeRouteHostOptionsDeps,
): Promise<HostOptionsData> {
  const connectorDescriptorsPromise = deps.listConnectors().catch(async (error) => {
    if (!deps.onListConnectorsError) throw error;
    return deps.onListConnectorsError(error, context);
  });
  let localMetadataDegraded = false;
  const localMetadataPromise = deps.loadLocalRouteMetadata(context).catch(async (error) => {
    if (!deps.onLocalRouteMetadataError) throw error;
    const fallback = await deps.onLocalRouteMetadataError(error, context);
    localMetadataDegraded = fallback.localMetadataDegraded ?? true;
    return fallback.metadata;
  });
  const [connectorDescriptors, localMetadata] = await Promise.all([connectorDescriptorsPromise, localMetadataPromise]);
  const connectors: Array<NimiRuntimeRouteConnectorProjectionInput | null> = await Promise.all((connectorDescriptors || []).map(async (descriptor) => {
    const connectorId = normalizeText(descriptor.id);
    if (!connectorId) return null;
    const modelDescriptors = await deps.listConnectorModelDescriptors(connectorId).catch(async (error) => {
      if (!deps.onListConnectorModelDescriptorsError) throw error;
      return deps.onListConnectorModelDescriptorsError(error, { ...context, connectorId });
    });
    return { descriptor: { ...descriptor, id: connectorId }, modelDescriptors };
  }));
  return {
    connectors: connectors.filter((connector): connector is NimiRuntimeRouteConnectorProjectionInput => connector !== null),
    localMetadata,
    localMetadataDegraded,
  };
}

async function listHostDataSingleFlight(
  context: NimiRuntimeRouteHostOptionsContext,
  deps: NimiRuntimeRouteHostOptionsDeps,
): Promise<HostOptionsData> {
  const scope = deps.scope || DEFAULT_HOST_OPTIONS_SCOPE;
  const inflight = hostOptionsInflightByScope.get(scope) || new Map<string, Promise<HostOptionsData>>();
  if (!hostOptionsInflightByScope.has(scope)) hostOptionsInflightByScope.set(scope, inflight);
  const key = `${context.capability}:${context.targetId || ''}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = listHostData(context, deps).finally(() => {
    if (inflight.get(key) === request) inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

export async function listNimiRuntimeRouteOptionsWithHost(input: {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetId?: string;
  readonly selectedTargetRef?: NimiRuntimeRouteTargetRef | null;
}, deps: NimiRuntimeRouteHostOptionsDeps): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const capability = normalizeNimiRuntimeHostRouteCapability(input.capability);
  if (!capability) throw new Error('NIMI_RUNTIME_ROUTE_CAPABILITY_REQUIRED');
  const context = {
    capability,
    targetId: normalizeText(input.targetId) || undefined,
  };
  const data = await listHostDataSingleFlight(context, deps);
  return buildNimiRuntimeRouteOptionsProjection({
    capability,
    selectedTargetRef: input.selectedTargetRef,
    connectors: data.connectors,
    snapshotAssets: data.localMetadata.snapshotAssets,
    nodeCatalog: data.localMetadata.nodeCatalog,
    runtimeLocalModels: data.localMetadata.runtimeLocalModels,
    localMetadataDegraded: data.localMetadataDegraded,
    onLocalStatusMismatch: deps.onLocalStatusMismatch,
  });
}

function isRemoteManagedConnectorKind(kind: unknown): boolean {
  return kind === ConnectorKind.REMOTE_MANAGED
    || normalizeText(kind) === String(ConnectorKind.REMOTE_MANAGED)
    || normalizeLower(kind) === 'remote_managed'
    || normalizeLower(kind) === 'connector_kind_remote_managed';
}

async function defaultListConnectors(
  runtime: NimiRuntimeRouteOptionsHostRuntime,
  callOptions?: RuntimeTypedCallOptions,
): Promise<readonly NimiRuntimeRouteConnectorDescriptorProjectionInput[]> {
  const descriptors: NimiRuntimeRouteConnectorDescriptorProjectionInput[] = [];
  let pageToken = '';
  do {
    const response = await runtime.connectors.listConnectors({
      pageSize: CONNECTOR_PAGE_SIZE,
      pageToken,
      kindFilter: ConnectorKind.REMOTE_MANAGED,
      statusFilter: ConnectorStatus.ACTIVE,
      providerFilter: '',
    }, callOptions);
    for (const connector of response.connectors || []) {
      if (!isRemoteManagedConnectorKind(connector.kind)) continue;
      descriptors.push({
        id: connector.connectorId,
        label: connector.label,
        vendor: nimiRuntimeConnectorVendorLabel(providerToNimiRuntimeConnectorVendor(connector.provider)),
        provider: connector.provider,
      });
    }
    pageToken = normalizeText(response.nextPageToken);
  } while (pageToken);
  return descriptors;
}

async function defaultListConnectorModelDescriptors(
  runtime: NimiRuntimeRouteOptionsHostRuntime,
  connectorId: string,
  callOptions?: RuntimeTypedCallOptions,
): Promise<readonly NimiRuntimeRouteConnectorModelDescriptorProjectionInput[]> {
  const descriptors: NimiRuntimeRouteConnectorModelDescriptorProjectionInput[] = [];
  let pageToken = '';
  do {
    const response = await runtime.connectors.listConnectorModels({
      connectorId,
      forceRefresh: false,
      pageSize: CONNECTOR_MODEL_PAGE_SIZE,
      pageToken,
    }, callOptions);
    for (const model of response.models || []) {
      if (!model.available) continue;
      descriptors.push({
        modelId: model.modelId,
        modelLabel: model.modelLabel,
        available: model.available,
        capabilities: model.capabilities,
        remoteModelCatalogId: model.remoteModelCatalogId,
        providerModelId: model.providerModelId,
        provider: model.provider,
        connectorSnapshotId: model.connectorSnapshotId,
        endpointProfileId: model.endpointProfileId,
        inventorySnapshotId: model.inventorySnapshotId,
      });
    }
    pageToken = normalizeText(response.nextPageToken);
  } while (pageToken);
  return descriptors;
}

async function defaultLoadLocalRouteMetadata(
  runtime: NimiRuntimeRouteOptionsHostRuntime,
  callOptions?: RuntimeTypedCallOptions,
): Promise<NimiRuntimeRouteHostLocalMetadata> {
  const runtimeLocalModels: NimiRuntimeRouteLocalAssetProjectionInput[] = [];
  let pageToken = '';
  do {
    const response = await runtime.local.listLocalAssets({
      statusFilter: LocalAssetStatus.UNSPECIFIED,
      kindFilter: LocalAssetKind.UNSPECIFIED,
      engineFilter: '',
      pageSize: LOCAL_ASSET_PAGE_SIZE,
      pageToken,
    }, callOptions);
    for (const asset of response.assets || []) {
      runtimeLocalModels.push({
        localAssetId: asset.localAssetId,
        assetId: asset.assetId,
        logicalModelId: asset.logicalModelId,
        kind: asset.kind,
        engine: asset.engine,
        endpoint: asset.endpoint,
        status: asset.status,
        capabilities: asset.capabilities,
        artifactRoles: asset.artifactRoles,
        displayName: asset.displayName,
        sourceFileName: asset.sourceFileName,
        updatedAt: asset.updatedAt,
        durableTargetRef: asset.durableTargetRef,
        durableTargetStatus: asset.durableTargetStatus,
        durableTargetReasonCode: asset.durableTargetReasonCode,
      });
    }
    pageToken = normalizeText(response.nextPageToken);
  } while (pageToken);
  return {
    snapshotAssets: [],
    nodeCatalog: [],
    runtimeLocalModels,
  };
}

export function createNimiRuntimeRouteOptionsHostDeps(
  runtime: NimiRuntimeRouteOptionsHostRuntime,
  options: NimiRuntimeRouteOptionsHostDepsOptions = {},
): NimiRuntimeRouteHostOptionsDeps {
  return {
    scope: options.scope,
    listConnectors: options.listConnectors ?? (() => defaultListConnectors(runtime, options.callOptions)),
    listConnectorModelDescriptors: options.listConnectorModelDescriptors
      ?? ((connectorId) => defaultListConnectorModelDescriptors(runtime, connectorId, options.callOptions)),
    loadLocalRouteMetadata: options.loadLocalRouteMetadata ?? (() => defaultLoadLocalRouteMetadata(runtime, options.callOptions)),
    onListConnectorsError: options.onListConnectorsError,
    onListConnectorModelDescriptorsError: options.onListConnectorModelDescriptorsError,
    onLocalRouteMetadataError: options.onLocalRouteMetadataError,
    onLocalStatusMismatch: options.onLocalStatusMismatch,
  };
}
