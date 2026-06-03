import { getPlatformClient } from '@nimiplatform/sdk';
import {
  PermissionClient,
  type GrantStatus,
  type PermissionScopeRef,
  type PermissionTransport,
} from '@nimiplatform/sdk/scope/permission';
import {
  bindLocalRuntimeServiceClientProvider,
  CatalogModelSource,
  createRuntimeConnectorInventoryClient,
  createRuntimeModelCatalogClient,
  listRuntimeLocalAssetEntries,
  localRuntime,
  ModelCatalogProviderSource,
  RuntimeHealthCoordinator,
  toRuntimeRouteCanonicalCapability,
  type RuntimeModelCatalogConnectorClient,
  type RuntimeRouteCapabilityRuntime,
} from '@nimiplatform/sdk/runtime';
import {
  loadRealmSocialSnapshot,
  loadRealmWorldSemanticBundle,
  type Realm,
} from '@nimiplatform/sdk/realm';
import type {
  RealmCommerceGiftService,
  RealmGiftCatalogResponse,
  RealmReceivedGiftsResponse,
} from '@nimiplatform/kit/features/commerce/realm';
import { createTesterWorldDisplayProjection } from '../../../tester/tester-world-display-projection';
import { createTesterAppLabAIScopeRef } from '../../../tester/tester-ai-config-store';

export async function resolveTesterLocalRuntimeFacadeProjection(): Promise<string> {
  const unbind = bindLocalRuntimeServiceClientProvider(() => ({
    async listLocalAssets() {
      return {
        assets: [{
          localAssetId: 'tester-local-asset',
          assetId: 'tester/local-facade-asset',
          kind: 'LOCAL_ASSET_KIND_CHAT',
          engine: 'runtime-engine',
          entry: 'model.gguf',
          files: ['model.gguf'],
          license: 'apache-2.0',
          source: { repo: 'tester/local-facade-asset', revision: 'main' },
          hashes: {},
          status: 'LOCAL_ASSET_STATUS_INSTALLED',
          installedAt: '2026-05-31T00:00:00Z',
          updatedAt: '2026-05-31T00:00:00Z',
        }],
        nextPageToken: '',
      };
    },
  }) as never);
  try {
    const [asset] = await localRuntime.listAssets({ kind: 'chat' });
    const [entry] = await listRuntimeLocalAssetEntries({
      local: {
        async listLocalAssets() {
          return {
            assets: [{
              localAssetId: 'tester-local-asset',
              assetId: 'tester/local-facade-asset',
              kind: 'LOCAL_ASSET_KIND_CHAT',
              engine: 'runtime-engine',
              status: 'LOCAL_ASSET_STATUS_INSTALLED',
            }],
            nextPageToken: '',
          };
        },
      },
    } as never);
    if (entry?.assetId !== asset?.assetId) {
      throw new Error('tester local asset projection did not match local runtime facade asset');
    }
    return asset?.assetId ?? 'none';
  } finally {
    unbind();
  }
}

export async function resolveTesterPermissionClientProjection(): Promise<{ scopeOwner: string; grantCount: number; firstState: string }> {
  const scopeRef = createTesterAppLabAIScopeRef();
  const permissionScope: PermissionScopeRef = {
    appId: 'tester.app',
    scopeFamily: 'account',
    scopeName: 'account.read',
  };
  const grant: GrantStatus = {
    scopeRef,
    grant: {
      grantId: 'tester-settings-grant',
      permissionScope,
      subjectUserId: 'tester-user',
    },
    state: 'granted' as const,
  };
  const transport: PermissionTransport = {
    async list(inputScopeRef) {
      return [{ ...grant, scopeRef: inputScopeRef }];
    },
    async get(inputScopeRef, grantId) {
      return { ...grant, scopeRef: inputScopeRef, grant: { ...grant.grant, grantId } };
    },
    async request(inputScopeRef) {
      return {
        scopeRef: inputScopeRef,
        accepted: true,
        grantId: 'tester-settings-pending-grant',
        state: 'pending',
      };
    },
    async revoke(inputScopeRef, grantId) {
      return {
        ...grant,
        scopeRef: inputScopeRef,
        grant: { ...grant.grant, grantId },
        state: 'revoked',
      };
    },
    subscribe(inputScopeRef, callback) {
      callback({ scopeRef: inputScopeRef, grant: { ...grant, scopeRef: inputScopeRef } });
      return () => {};
    },
    async status(inputScopeRef) {
      return {
        scopeRef: inputScopeRef,
        grants: [{ ...grant, scopeRef: inputScopeRef }],
        generatedAt: '2026-06-01T00:00:00Z',
      };
    },
  };
  const client = new PermissionClient(transport);
  const snapshot = await client.status(scopeRef);
  const grants = await client.list(scopeRef);
  return {
    scopeOwner: snapshot.scopeRef.ownerId,
    grantCount: grants.length,
    firstState: snapshot.grants[0]?.state ?? 'none',
  };
}

export async function resolveTesterRealmDataSyncProjection(): Promise<string> {
  const callRealm = async <T,>(task: (realm: Realm) => Promise<T>): Promise<T> => task({
    services: {
      MeService: {
        listMyFriendsWithDetails: async () => ({ items: [{ id: 'tester-friend' }] }),
        getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
        getMyBlockedUsers: async () => ({ items: [{ id: 'tester-blocked' }] }),
      },
      UserService: {
        getUser: async () => ({ id: 'tester-user' }),
      },
      WorldsService: {
        worldControllerGetWorldview: async () => ({ id: 'tester-worldview', coreSystem: null }),
      },
    },
  } as unknown as Realm);
  const errors: string[] = [];
  const [social, world] = await Promise.all([
    loadRealmSocialSnapshot(callRealm, (action) => {
      errors.push(action);
    }),
    loadRealmWorldSemanticBundle(callRealm, (action) => {
      errors.push(action);
    }, 'tester-world'),
  ]);
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
  return `${social.friends.length}/${social.blocked.length}/${world.worldview?.id ?? 'none'}/${createTesterWorldDisplayProjection(world)}`;
}

export const runtimeConnectorInventory = createRuntimeConnectorInventoryClient({
  runtimeAdmin: () => getPlatformClient().domains.runtimeAdmin,
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
} satisfies RuntimeModelCatalogConnectorClient;

export const runtimeModelCatalogProjection = createRuntimeModelCatalogClient({
  connector: () => testerRuntimeModelCatalogConnector,
  callOptions: {
    timeoutMs: 5000,
    metadata: {
      callerKind: 'third-party-app' as const,
      callerId: 'tester.settings.model-catalog',
      surfaceId: 'tester.settings',
    },
  },
});

export const testerRouteCapabilityRuntime: RuntimeRouteCapabilityRuntime = {
  async resolve({ capability, binding }) {
    return {
      capability: toRuntimeRouteCanonicalCapability(capability),
      resolvedBindingRef: `tester:${capability}:resolved`,
      source: binding?.source || 'cloud',
      connectorId: binding?.connectorId || 'tester-cloud',
      provider: binding?.provider || 'tester',
      model: binding?.model || 'tester-model',
      modelId: binding?.modelId || binding?.model || 'tester-model',
    };
  },
  async checkHealth() {
    return {
      healthy: true,
      status: 'healthy',
      detail: 'tester route ready',
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

export const runtimeHealthCoordinatorDiagnostics = new RuntimeHealthCoordinator({
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
