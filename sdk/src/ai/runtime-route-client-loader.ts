import type { PlatformClient } from '../platform-client.js';
import { ConnectorKind } from '../runtime/index.js';
import {
  parseLocalRuntimeAssetKindId,
  parseLocalRuntimeAssetStatusId,
} from '../runtime/local-asset-kind.js';
import type {
  RuntimeRouteBinding,
  RuntimeCanonicalCapability,
  RuntimeRouteOptionsSnapshot,
} from './runtime-route.js';
import type {
  RuntimeRouteConnectorModelDescriptorProjectionInput,
  RuntimeRouteLocalAssetProjectionInput,
} from './runtime-route-options.js';
import {
  listRuntimeRouteOptionsWithHost,
  type RuntimeRouteHostConnectorDescriptor,
  type RuntimeRouteHostLocalMetadata,
  type RuntimeRouteHostOptionsDeps,
} from './runtime-route-host-facade.js';

const CONNECTOR_PAGE_SIZE = 200;
const CONNECTOR_MODEL_PAGE_SIZE = 200;
const LOCAL_ASSET_PAGE_SIZE = 200;

export type RuntimeRouteOptionsClient = PlatformClient;

/**
 * App-facing input contract for resolving runtime route options through the
 * default {@link PlatformClient} data sources.
 */
export interface ListRuntimeRouteOptionsInput {
  capability: RuntimeCanonicalCapability;
  targetId?: string;
  selectedBinding?: RuntimeRouteBinding | null;
}

export function createRuntimeRouteOptionsPlatformHostDeps(
  client: RuntimeRouteOptionsClient,
  overrides?: Partial<RuntimeRouteHostOptionsDeps>,
): RuntimeRouteHostOptionsDeps {
  return {
    scope: overrides?.scope,
    listConnectors:
      overrides?.listConnectors ?? (() => defaultListConnectors(client)),
    listConnectorModelDescriptors:
      overrides?.listConnectorModelDescriptors ??
      ((connectorId) => defaultListConnectorModelDescriptors(client, connectorId)),
    loadLocalRouteMetadata:
      overrides?.loadLocalRouteMetadata ?? (() => defaultLoadLocalRouteMetadata(client)),
    onListConnectorsError: overrides?.onListConnectorsError,
    onListConnectorModelDescriptorsError: overrides?.onListConnectorModelDescriptorsError,
    onLocalRouteMetadataError: overrides?.onLocalRouteMetadataError,
    onLocalStatusMismatch: overrides?.onLocalStatusMismatch,
  };
}

/**
 * Resolves a runtime route options snapshot using the platform client as the
 * canonical projection data source.
 *
 * The three projection data sources (cloud connectors, connector models, and
 * local route metadata) are wired from {@link PlatformClient} by default, then
 * fed through the single canonical {@link listRuntimeRouteOptionsWithHost}
 * projection. Hosts may supply `overrides` to replace any data source (e.g. a
 * Desktop that reads local assets from its own Tauri bridge) or to attach
 * error/mismatch/scope hooks. No fallback knobs are exposed: when a default data
 * source fails and the host has not provided a matching error hook, the failure
 * propagates and the call fails closed.
 */
export async function listRuntimeRouteOptions(
  client: RuntimeRouteOptionsClient,
  input: ListRuntimeRouteOptionsInput,
  overrides?: Partial<RuntimeRouteHostOptionsDeps>,
): Promise<RuntimeRouteOptionsSnapshot> {
  const deps = createRuntimeRouteOptionsPlatformHostDeps(client, overrides);

  return listRuntimeRouteOptionsWithHost(
    {
      capability: input.capability,
      targetId: input.targetId,
      selectedBinding: input.selectedBinding,
    },
    deps,
  );
}

// Page through `runtimeAdmin.listConnectors` and keep only REMOTE_MANAGED
// cloud connectors. The typed `kind` may serialize as the numeric enum or the
// proto member name depending on transport; both map to the cloud connector
// kind. The raw runtime `Connector` message carries no `vendor` field; vendor
// is optional route-projection enrichment, so it is omitted here.
function isRemoteManagedConnectorKind(kind: unknown): boolean {
  return kind === ConnectorKind.REMOTE_MANAGED
    || kind === 'REMOTE_MANAGED'
    || kind === 'CONNECTOR_KIND_REMOTE_MANAGED';
}

async function defaultListConnectors(
  client: PlatformClient,
): Promise<RuntimeRouteHostConnectorDescriptor[]> {
  const descriptors: RuntimeRouteHostConnectorDescriptor[] = [];
  let pageToken = '';
  do {
    const response = await client.domains.runtimeAdmin.listConnectors({
      pageSize: CONNECTOR_PAGE_SIZE,
      pageToken,
    });
    for (const connector of response.connectors) {
      if (!isRemoteManagedConnectorKind(connector.kind)) {
        continue;
      }
      descriptors.push({
        id: connector.connectorId,
        label: connector.label,
        provider: connector.provider,
      });
    }
    pageToken = String(response.nextPageToken || '').trim();
  } while (pageToken);
  return descriptors;
}

// Page through `runtimeAdmin.listConnectorModels`, keep only `available`
// models, and project each to `{ modelId, capabilities }`.
async function defaultListConnectorModelDescriptors(
  client: PlatformClient,
  connectorId: string,
): Promise<RuntimeRouteConnectorModelDescriptorProjectionInput[]> {
  const descriptors: RuntimeRouteConnectorModelDescriptorProjectionInput[] = [];
  let pageToken = '';
  do {
    const response = await client.domains.runtimeAdmin.listConnectorModels({
      connectorId,
      forceRefresh: false,
      pageSize: CONNECTOR_MODEL_PAGE_SIZE,
      pageToken,
    });
    for (const model of response.models) {
      if (!model.available) {
        continue;
      }
      descriptors.push({
        modelId: model.modelId,
        capabilities: [...model.capabilities],
      });
    }
    pageToken = String(response.nextPageToken || '').trim();
  } while (pageToken);
  return descriptors;
}

// Default local-route metadata source: the canonical SDK runtime local-asset
// surface `client.runtime.local.listLocalAssets` (RuntimeLocalServiceClient,
// sdk/src/runtime/types-client-interfaces.ts:707-708). The raw `LocalAssetRecord`
// (sdk/src/runtime/generated/runtime/v1/local_runtime_types.ts:61) carries `kind`
// and `status` as numeric proto enums (LocalAssetKind / LocalAssetStatus), but
// the route projection matches on string tokens
// (sdk/src/ai/runtime-route-options.ts:278 `status !== 'removed'`, and
// `runtimeRouteLocalKindSupportsCapability(item.kind, …)`). This is the
// enum->token normalization layer that pure-SDK hosts (e.g. the Tester) lacked
// and previously had to fake; the Desktop never hits it because its Tauri local
// bridge already emits token-shaped records and is injected via `overrides`.
// snapshotAssets / nodeCatalog are status/provider-hint enrichment only and do
// not gate which models appear, so they default to empty.
async function defaultLoadLocalRouteMetadata(
  client: PlatformClient,
): Promise<RuntimeRouteHostLocalMetadata> {
  const runtimeLocalModels: RuntimeRouteLocalAssetProjectionInput[] = [];
  let pageToken = '';
  do {
    const response = await client.runtime.local.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: LOCAL_ASSET_PAGE_SIZE,
      pageToken,
    });
    for (const asset of response.assets) {
      runtimeLocalModels.push({
        localAssetId: asset.localAssetId,
        assetId: asset.assetId,
        kind: parseLocalRuntimeAssetKindId(asset.kind),
        engine: asset.engine,
        endpoint: asset.endpoint,
        status: parseLocalRuntimeAssetStatusId(asset.status),
        capabilities: [...asset.capabilities],
      });
    }
    pageToken = String(response.nextPageToken || '').trim();
  } while (pageToken);
  return {
    snapshotAssets: [],
    nodeCatalog: [],
    runtimeLocalModels,
  };
}
