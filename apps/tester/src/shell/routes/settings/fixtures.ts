import {
  type NimiAppScopeRef,
  type PermissionScopeRef,
} from '@nimiplatform/sdk/app';
import {
  createNimiClient,
  type CoreStreamRequest,
  type CoreUnaryRequest,
} from '@nimiplatform/sdk';
import { createNimiRuntimeConnectorInventoryClient, createNimiRuntimeModelCatalogClient, listNimiRuntimeLocalAssetEntries, NimiRuntimeHealthCoordinator, normalizeNimiRuntimeRouteCapabilityToken, type NimiRuntimeConnectorClient, type NimiRuntimeModelCatalogConnectorClient, type NimiRuntimeRouteCapabilityRuntime } from '@nimiplatform/sdk/runtime';
import {
  CatalogModelSource,
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
  LocalAssetKind,
  LocalAssetStatus,
  ModelCatalogProviderSource,
  type LocalAssetRecord,
  type ProviderCatalogEntry,
} from '@nimiplatform/sdk/runtime/wire-types';
import {
  loadNimiRealmSocialSnapshot,
  type Realm,
  type WorldCoreDto,
} from '@nimiplatform/sdk/realm';
import type {
  RealmCommerceGiftService,
  RealmGiftCatalogResponse,
  RealmReceivedGiftsResponse,
} from '@nimiplatform/kit/features/commerce/realm';
import { appId } from '../../auth/app-identity.js';
import { createTesterWorldDisplayProjection } from '../../../tester/tester-world-display-projection';
import { createTesterAppLabAIScopeRef } from '../../../tester/tester-ai-config-store';

export async function resolveTesterLocalRuntimeFacadeProjection(): Promise<string> {
  const asset: LocalAssetRecord = {
    localAssetId: 'tester-local-asset',
    assetId: 'tester/local-facade-asset',
    displayName: 'Tester Local Facade Asset',
    sourceFileName: 'model.gguf',
    importInstanceId: 'import-instance:tester-local-asset',
    kind: LocalAssetKind.CHAT,
    engine: 'runtime-engine',
    entry: 'model.gguf',
    files: ['model.gguf'],
    license: 'tester-fixture',
    hashes: { sha256: '0'.repeat(64) },
    status: LocalAssetStatus.INSTALLED,
    installedAt: '2026-05-31T00:00:00Z',
    updatedAt: '2026-05-31T00:00:00Z',
    healthDetail: 'tester fixture installed',
    capabilities: ['text.generate'],
    logicalModelId: 'tester/local-facade-asset',
    family: 'tester',
    artifactRoles: ['model'],
    preferredEngine: 'runtime-engine',
    fallbackEngines: [],
    bundleState: 0,
    warmState: 0,
    localInvokeProfileId: 'tester-local-facade',
    endpoint: 'http://127.0.0.1:19000/v1',
    reasonCode: 0,
  };
  const [entry] = await listNimiRuntimeLocalAssetEntries({
    local: {
      async listLocalAssets() {
        return {
          assets: [asset],
          nextPageToken: '',
        };
      },
    },
  });
  return entry?.assetId ?? 'none';
}

export async function resolveTesterPermissionClientProjection(): Promise<{ scopeOwner: string; grantCount: number; firstState: string; requestState: string; revokeState: string }> {
  const aiScopeRef = createTesterAppLabAIScopeRef();
  const scopeRef: NimiAppScopeRef = {
    kind: 'app',
    ownerId: aiScopeRef.ownerId,
    surfaceId: aiScopeRef.surfaceId,
  };
  const permissionScope: PermissionScopeRef = {
    appId,
    scopeFamily: 'account',
    scopeName: 'account.read',
  };
  const realmTransport = createTesterPermissionRealmTransport();
  const client = createNimiClient({
    appId,
    runtime: { transport: testerNoopCoreTransport },
    realm: { transport: realmTransport },
  });
  const permissions = client.requirePermissions();
  const snapshot = await permissions.status(scopeRef);
  const grants = await permissions.list(scopeRef);
  const requested = await permissions.request(scopeRef, {
    permissionScope,
    reason: 'Tester settings permission projection',
  });
  const revoked = await permissions.revoke(scopeRef, 'tester-settings-grant');
  return {
    scopeOwner: snapshot.scopeRef.ownerId,
    grantCount: grants.length,
    firstState: snapshot.grants[0]?.state ?? 'none',
    requestState: requested.state,
    revokeState: revoked.state,
  };
}

function testerRealmPermissionGrant(input: Record<string, unknown> = {}) {
  return {
    grantId: 'tester-settings-grant',
    subjectAccountId: 'tester-user',
    appId,
    scopeFamily: 'account',
    scopeName: 'account.read',
    state: 'GRANTED',
    reason: 'Tester settings permission projection',
    version: 7,
    requestedAt: '2026-06-10T00:00:00.000Z',
    requestedByAccountId: 'tester-user',
    ...input,
  };
}

const testerNoopCoreTransport = {
  async unary<Response = unknown>(_request: CoreUnaryRequest): Promise<Response> {
    throw new Error('Tester permission projection does not call Runtime transport.');
  },
  async *serverStream<Response = unknown>(_request: CoreStreamRequest): AsyncIterable<Response> {
    throw new Error('Tester permission projection does not call Runtime streaming transport.');
  },
};

function createTesterPermissionRealmTransport() {
  return {
    async unary<Response = unknown>(request: CoreUnaryRequest): Promise<Response> {
      switch (request.methodId) {
        case 'listMyAppPermissionGrants':
          return { items: [testerRealmPermissionGrant()] } as Response;
        case 'getMyAppPermissionGrantStatus':
          return {
            generatedAt: '2026-06-10T00:00:01.000Z',
            grants: [testerRealmPermissionGrant()],
          } as Response;
        case 'requestMyAppPermissionGrant':
          return testerRealmPermissionGrant({
            grantId: 'tester-settings-requested-grant',
            state: 'PENDING',
          }) as Response;
        case 'getMyAppPermissionGrant':
          return testerRealmPermissionGrant() as Response;
        case 'revokeMyAppPermissionGrant':
          return testerRealmPermissionGrant({ state: 'REVOKED' }) as Response;
        default:
          throw new Error(`Unexpected Realm permission method in tester projection: ${request.methodId}`);
      }
    },
    async *serverStream<Response = unknown>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('Tester permission projection does not call Realm streaming transport.');
    },
  };
}

export async function resolveTesterRealmDataSyncProjection(): Promise<string> {
  const callRealm = async <T,>(task: (realm: Realm) => Promise<T>): Promise<T> => task({
    generated: {
      listMyFriendsWithDetails: async () => ({ items: [{ id: 'tester-friend' }] }),
      getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
      getMyBlockedUsers: async () => ({ items: [{ id: 'tester-blocked' }] }),
      getUser: async () => ({ id: 'tester-user' }),
    },
    services: {
      WorldsService: {
        worldControllerGetWorldview: async () => ({ id: 'tester-worldview', coreSystem: null }),
      },
    },
  } as unknown as Realm);
  const errors: string[] = [];
  const testerWorldCore: WorldCoreDto = {
    contentHash: 'tester-world-core-hash',
    contentRevision: 1,
    core: {
      identity: {
        id: 'tester-world',
        name: 'Tester World',
      },
      timeline: {
        timeScale: 'slow',
      },
    },
    createdAt: '2026-06-18T00:00:00.000Z',
    creatorId: 'tester-user',
    id: 'tester-world',
    origin: { kind: 'manual' },
    schemaVersion: 'world-core.v1',
    updatedAt: '2026-06-18T00:00:00.000Z',
    visibility: 'private',
  };
  const [social, worldDisplay] = await Promise.all([
    callRealm((realm) => loadNimiRealmSocialSnapshot(realm, (action) => {
      errors.push(action);
    })),
    Promise.resolve(createTesterWorldDisplayProjection(testerWorldCore)),
  ]);
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
  return `${social.friends.length}/${social.blocked.length}/${testerWorldCore.id}/${worldDisplay}`;
}

const testerProviderCatalog: ProviderCatalogEntry[] = [{
  provider: 'tester',
  defaultEndpoint: 'https://runtime.example/v1',
  requiresExplicitEndpoint: false,
  runtimePlane: 'cloud',
  executionModule: 'cloud',
  managedSupported: true,
  inventoryMode: 'static_source',
  inlineSupported: true,
}];

const testerRuntimeConnectorClient = {
  async listProviderCatalog() {
    return { providers: testerProviderCatalog };
  },
  async listConnectors() {
    return {
      connectors: [{
        connectorId: 'tester-cloud',
        kind: ConnectorKind.REMOTE_MANAGED,
        ownerType: ConnectorOwnerType.REALM_USER,
        ownerId: 'tester-user',
        provider: 'tester',
        endpoint: 'https://runtime.example/v1',
        label: 'Tester Cloud',
        status: ConnectorStatus.ACTIVE,
        localCategory: 0,
        hasCredential: true,
        authKind: ConnectorAuthKind.API_KEY,
        providerAuthProfile: '',
      }],
      nextPageToken: '',
    };
  },
  async listConnectorModels() {
    return {
      models: [{
        modelId: 'tester-model',
        modelLabel: 'Tester Model',
        available: true,
        capabilities: ['text.generate'],
        remoteModelCatalogId: 'remote-catalog:tester-cloud:tester-model',
        providerModelId: 'tester-model',
        provider: 'tester',
        connectorSnapshotId: 'connector-snapshot:tester-cloud',
        endpointProfileId: 'endpoint-profile:tester-cloud',
        inventorySnapshotId: 'inventory-snapshot:tester-cloud',
      }],
      nextPageToken: '',
    };
  },
  async createConnector() {
    throw new Error('Tester settings does not mutate Runtime connector truth.');
  },
  async updateConnector() {
    throw new Error('Tester settings does not mutate Runtime connector truth.');
  },
  async deleteConnector() {
    throw new Error('Tester settings does not mutate Runtime connector truth.');
  },
  async testConnector() {
    return { ack: { ok: true, reasonCode: 0, actionHint: '' } };
  },
} satisfies NimiRuntimeConnectorClient;

export const runtimeConnectorInventory = createNimiRuntimeConnectorInventoryClient({
  connectors: testerRuntimeConnectorClient,
  callOptions: {
    timeoutMs: 5000,
    metadata: {
      callerKind: 'third-party-app' as const,
      callerId: 'tester.settings.connector-inventory',
      surfaceId: 'tester.settings',
    },
  },
});

const testerRuntimeModelCatalogProviderEntry = {
  provider: 'tester-provider',
  version: 1,
  catalogVersion: '2026-05-31',
  source: ModelCatalogProviderSource.CUSTOM,
  inventoryMode: 'static_source',
  modelCount: 1,
  voiceCount: 0,
  defaultTextModel: 'tester-model',
  capabilities: ['text.generate'],
  hasOverlay: true,
  customModelCount: 1,
  overriddenModelCount: 0,
  overlayUpdatedAt: '2026-05-31T00:00:00Z',
  yaml: 'provider: tester-provider',
  effectiveYaml: 'provider: tester-provider',
  defaultEndpoint: 'https://runtime.example/v1',
  requiresExplicitEndpoint: false,
  runtimePlane: 'tester',
  executionModule: 'tester',
  managedSupported: false,
};

const testerRuntimeModelCatalogConnector = {
  async listModelCatalogProviders() {
    return {
      providers: [testerRuntimeModelCatalogProviderEntry],
    };
  },
  async listCatalogProviderModels() {
    return { provider: testerRuntimeModelCatalogProviderEntry, models: [], nextPageToken: '', warnings: [] };
  },
  async getCatalogModelDetail() {
    return {
      provider: testerRuntimeModelCatalogProviderEntry,
      model: {
        provider: 'tester-provider',
        modelId: 'tester-model',
        modelType: 'text',
        updatedAt: '2026-05-31',
        capabilities: ['text.generate'],
        pricing: { unit: 'request', input: 'unknown', output: 'unknown', currency: 'USD', asOf: '2026-05-31', notes: 'tester' },
        voiceSetId: '',
        voiceDiscoveryMode: '',
        voiceRefKinds: [],
        videoGeneration: undefined,
        sourceRef: { url: 'https://runtime.example/catalog', retrievedAt: '2026-05-31', note: 'tester' },
        source: CatalogModelSource.CUSTOM,
        userScoped: true,
        sourceNote: 'tester settings projection',
        warnings: [],
        voices: [],
        voiceWorkflowModels: [],
        modelWorkflowBinding: undefined,
      },
      warnings: [],
    };
  },
  async upsertModelCatalogProvider() {
    throw new Error('Tester settings does not mutate Runtime catalog truth.');
  },
  async deleteModelCatalogProvider() {
    throw new Error('Tester settings does not mutate Runtime catalog truth.');
  },
  async upsertCatalogModelOverlay() {
    throw new Error('Tester settings does not mutate Runtime catalog truth.');
  },
  async deleteCatalogModelOverlay() {
    throw new Error('Tester settings does not mutate Runtime catalog truth.');
  },
} satisfies NimiRuntimeModelCatalogConnectorClient;

export const runtimeModelCatalogProjection = createNimiRuntimeModelCatalogClient({
  connectors: testerRuntimeModelCatalogConnector,
  callOptions: {
    timeoutMs: 5000,
    metadata: {
      callerKind: 'third-party-app' as const,
      callerId: 'tester.settings.model-catalog',
      surfaceId: 'tester.settings',
    },
  },
});

export const testerRouteCapabilityRuntime: NimiRuntimeRouteCapabilityRuntime = {
  async resolve({ capability, targetRef }) {
    const canonicalCapability = normalizeNimiRuntimeRouteCapabilityToken(capability);
    if (!canonicalCapability) {
      throw new Error(`Tester settings route capability is unsupported: ${String(capability)}`);
    }
    if (!targetRef) {
      throw new Error('Tester settings route capability requires a targetRef.');
    }
    return {
      capability: canonicalCapability,
      resolvedBindingRef: `tester:${capability}:resolved`,
      routeMetadataRef: `tester:${capability}:metadata`,
      source: targetRef.kind,
      targetRef,
      ...(targetRef.kind === 'cloud-connector'
        ? {
            connectorId: targetRef.connectorId,
            remoteModelCatalogId: targetRef.remoteModelCatalogId,
            providerModelId: targetRef.providerModelId,
            provider: targetRef.provider || 'tester',
            model: targetRef.providerModelId,
            modelId: targetRef.providerModelId,
          }
        : {
            localAssetId: targetRef.profileBindingId || targetRef.readinessRef,
            model: targetRef.profileBindingId || targetRef.readinessRef,
            modelId: targetRef.profileBindingId || targetRef.readinessRef,
          }),
    };
  },
  async checkHealth() {
    return {
      healthy: true,
      status: 'healthy',
      provider: 'tester',
      detail: 'tester route ready',
      actionHint: 'none',
    };
  },
  async describe({ capability, resolvedBindingRef }) {
    if (capability !== 'audio.synthesize') {
      throw new Error('Tester settings only describes audio.synthesize route projection.');
    }
    return {
      capability: 'audio.synthesize',
      metadataVersion: 'v1',
      resolvedBindingRef,
      metadataKind: 'audio.synthesize',
      metadata: {
        supportedAudioFormats: ['audio/wav'],
        defaultAudioFormat: 'audio/wav',
        supportedTimingModes: ['none'],
        supportsLanguage: false,
        supportsEmotion: false,
      },
    };
  },
};

export const runtimeHealthCoordinatorDiagnostics = new NimiRuntimeHealthCoordinator({
  fetchRuntimeHealth: async () => {
    throw new Error('Tester settings diagnostics do not own Runtime health truth.');
  },
  fetchProviderHealth: async () => ({ providers: [] }),
  subscribeRuntimeHealth: async () => ({
    async *[Symbol.asyncIterator]() {},
  }),
  subscribeProviderHealth: async () => ({
    async *[Symbol.asyncIterator]() {},
  }),
  subscribeRuntimeConnected: () => () => undefined,
  subscribeRuntimeDisconnected: () => () => undefined,
  setInterval: () => 0,
  clearInterval: () => undefined,
});

const testerGiftCatalogProjection: RealmGiftCatalogResponse = [];
const testerEmptyGiftFeedProjection = {
  items: [],
  nextCursor: '',
} as RealmReceivedGiftsResponse;
const testerSentGiftFeedProjection = {
  items: [{
    id: 'tester-gift-preview',
    sparkCost: 20,
    gemToReceiver: 4,
    status: 'ACCEPTED',
    sender: { id: 'tester-sender', displayName: 'Tester Sender' },
    receiver: { id: 'tester-receiver', displayName: 'Tester Receiver' },
  }],
  nextCursor: '',
} as unknown as RealmReceivedGiftsResponse;

export const testerGiftTransactionProjectionService: RealmCommerceGiftService = {
  getBalances: async () => ({ sparkBalance: '0', gemBalance: '0' }),
  listSparkTransactionHistory: async () => ({ items: [], nextCursor: '' }),
  listGemTransactionHistory: async () => ({ items: [], nextCursor: '' }),
  getSubscriptionStatus: async () => ({
    id: 'tester-subscription',
    status: 'ACTIVE',
    tier: 'FREE',
    tierConfig: {
      features: [],
      priceUsd: 0,
      tier: 'FREE',
    },
    cancelAtPeriodEnd: false,
  }),
  listSparkPackages: async () => [],
  createSparkCheckout: async () => ({
    sessionId: 'tester-checkout',
    url: 'https://tester.invalid/checkout',
  }),
  getWithdrawalEligibility: async () => ({
    balance: '0',
    canWithdraw: false,
    connectStatus: 'NOT_CREATED',
    reason: 'tester_projection_only',
    minAmount: '0',
  }),
  listWithdrawalHistory: async () => ({ items: [], nextCursor: '' }),
  createWithdrawal: async () => ({
    id: 'tester-withdrawal',
    gemAmount: '0',
    feeAmount: '0',
    netAmount: '0',
    usdAmount: 0,
    status: 'PENDING',
    createdAt: '2026-05-31T00:00:00Z',
  }),
  listGiftCatalog: async () => testerGiftCatalogProjection,
  sendGift: async () => {},
  listReceivedGifts: async () => testerEmptyGiftFeedProjection,
  listSentGifts: async () => testerSentGiftFeedProjection,
  acceptGift: async () => {},
  rejectGift: async () => {},
  createGiftReview: async () => {},
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Realm projection unavailable');
}
