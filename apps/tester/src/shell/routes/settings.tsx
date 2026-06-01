import { useEffect, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  selectFactoryAIProfileForFirstRun,
} from '@nimiplatform/sdk/platform-catalog';
import {
  parseAccountAppLibraryRecord,
  parseNimiAppBridgeProjection,
} from '@nimiplatform/sdk/app';
import {
  buildRuntimeRouteCapabilityProjection,
  aggregateMaterializationDownloadProgress,
  buildRuntimeRequestMetadata,
  buildRuntimeTargetCallOptions,
  bindLocalRuntimeServiceClientProvider,
  checkRuntimeRouteProviderHealth,
  createDefaultRuntimeRouteCapabilitySelectionStore,
  findRuntimeRouteModelProfile,
  getRuntimeRouteCapabilityProjectionIssueKind,
  isRuntimeRouteCapabilityProjectionReady,
  isRuntimeRouteLocalOptionSelectable,
  listRuntimeLocalAssetEntries,
  mapRuntimeErrorToLocalAiReasonCode,
  ModelHealthStatus,
  createEmptyMemoryEmbeddingConfig,
  projectMemoryEmbeddingRouteAvailability,
  projectRuntimeAgentCanonicalMemoryBankStatus,
  projectRuntimeRouteCapabilityCoverage,
  resolveRuntimeRouteReasoningConfig,
  resolveRuntimeTextRouteReasoningSupport,
  runtimeRouteBindingsMatch,
  runtimeRouteLocalOptionToBinding,
  toRuntimeRouteCanonicalCapability,
  updateRuntimeRouteCapabilityBinding,
  type RuntimeRouteCapabilityRuntime,
  type RuntimeRouteProviderHealthProjection,
  type RuntimeResolvedBinding,
  type RuntimeRouteDescribeResult,
  RuntimeReasonCode,
} from '@nimiplatform/sdk/runtime';
import { pickerSelectionToBinding, summarizeBinding } from '@nimiplatform/kit/features/model-config/headless';
import { resolveConversationRuntimeRouteSetupStateFromProjection } from '@nimiplatform/kit/features/chat/headless';
import {
  getRuntimeReasonCodeDefaultMessage,
  createRuntimeConnectorInventoryClient,
  createRuntimeModelCatalogClient,
  CatalogModelSource,
  buildRuntimeAgentSnapshotRecoveryEvents,
  fromProtoStruct,
  isLocalRuntimeEnvironmentDependencyJobActiveState,
  isLocalRuntimeEnvironmentDependencyJobRetryableState,
  isLocalRuntimeEnvironmentDependencyJobTransferringState,
  isLocalRuntimeEnvironmentDependencyRepairRequiredState,
  isLocalRuntimeEnvironmentDependencyStartableState,
  isRuntimeAgentProjectionEvent,
  localRecommendationTierToRunGrade,
  localRuntime,
  matchesRuntimeAgentProjectionScope,
  normalizeLocalRecommendationFeedCacheStateId,
  parseLocalRuntimeEnvironmentDependencyJobProjection,
  parseLocalRuntimeEnvironmentPlanProjection,
  repairableFirstRunMaterializationDependencies,
  retryableInterruptedFirstRunMaterializationJobs,
  parseLocalRuntimeExecutionPlan,
  parseLocalRuntimeNodeDescriptor,
  parseLocalRuntimeServiceDescriptor,
  normalizeLocalRuntimeProfilesDeclaration,
  bridgeLocalRuntimeProfile,
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
  parseRuntimeLocalRecommendationFeedDescriptor,
  parseLocalRecommendationFeedSourceId,
  extractRuntimeReasonCodeFromError,
  CallerKind,
  ModelCatalogProviderSource,
  normalizeRuntimeReasonCode,
  RuntimeHealthCoordinator,
  RuntimeHealthStatus,
  UsageWindow,
  projectRuntimeAuditCallerKindName,
  projectRuntimeHealthStatusName,
  projectRuntimeHealthSummary,
  projectRuntimeUsageWindowName,
  summarizeLocalRecommendationFeedCacheState,
  summarizeRuntimeAgentProjectionEvent,
  summarizeRuntimeAgentTimeline,
  toIsoFromTimestamp,
  toCanonicalLocalRuntimeAssetId,
  toCanonicalLocalRuntimeAssetLookupKey,
  toProtoStruct,
  type RuntimeConnectorProjection,
  type RuntimeAgentConsumeEvent,
  type RuntimeModelCatalogConnectorClient,
  type RuntimeModelCatalogProvider,
} from '@nimiplatform/sdk/runtime';
import { classifyOfflineError, classifyOfflineReasonCode, createOfflineNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import {
  isRealmFeedScope,
  listRealmGroupChats,
  loadRealmCreatorEligibility,
  loadRealmNotificationUnreadCount,
  loadRealmNotifications,
  loadRealmSocialSnapshot,
  loadRealmWorldSemanticBundle,
  projectRealmBaseUrl,
  projectRealmRealtimeUrl,
  REALM_FEED_SCOPES,
  requestDataExport,
  resolveRealmMediaUrl,
  toRealmNotificationListProjection,
  uploadRealmResourceFileWithRealm,
  type Realm,
  type RequestDataExportOutput,
  type RealmCreatorEligibilityDto,
  type RealmGroupChatListResultDto,
  type RealmNotificationListProjection,
  type RealmNotificationUnreadProjection,
} from '@nimiplatform/sdk/realm';
import {
  loadRealmCurrencyBalances,
  loadRealmGiftTransaction,
  type CommerceCurrencyBalances,
  type RealmCommerceGiftService,
  type RealmGiftCatalogResponse,
  type RealmReceivedGiftsResponse,
} from '@nimiplatform/kit/features/commerce/realm';
import { resolveAgentVoicePlaybackCue } from '@nimiplatform/kit/features/avatar/headless';
import {
  resolveRuntimeAgentVoicePlaybackDecision,
  type RuntimeAgentPresentationLipsyncFrameBatchEvent,
  type RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  type RuntimeAgentTimelineEnvelope,
} from '@nimiplatform/kit/features/avatar/runtime';
import {
  createRealmChatResourceAttachmentPayload,
  listRealmChats,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
  type RealmListChatsResultDto,
} from '@nimiplatform/kit/features/chat/realm';
import { Button, ProgressIndicator, StatusBadge, Surface, Toggle } from '@nimiplatform/kit/ui';
import { createTesterExternalAgentProjection } from '../../tester/tester-external-agent-projection';
import { createTesterMemoryEmbeddingRuntimeProjection } from '../../tester/tester-memory-embedding-runtime-projection';
import { createTesterRuntimeAgentPresentationProfileProjection } from '../../tester/tester-runtime-agent-presentation-profile';
import { createTesterRuntimeAgentInspectProjection } from '../../tester/tester-runtime-agent-inspect-projection';
import { createTesterLocalRecommendationCopyProjection } from '../../tester/tester-local-recommendation-copy-projection';
import { createTesterLocalRuntimeAssetKindProjection } from '../../tester/tester-local-runtime-asset-kind-projection';
import { createTesterWorldDisplayProjection } from '../../tester/tester-world-display-projection';
import { createTesterRuntimeConfigProjection } from '../../tester/tester-runtime-config-projection';
type WalletProjectionState =
  | { status: 'idle'; balances: null; error: null }
  | { status: 'loading'; balances: CommerceCurrencyBalances | null; error: null }
  | { status: 'ready'; balances: CommerceCurrencyBalances; error: null }
  | { status: 'error'; balances: null; error: string };
type GiftTransactionProjectionState =
  | { status: 'idle'; gift: null; error: null }
  | { status: 'loading'; gift: { id: string; giftStatus: string } | null; error: null }
  | { status: 'ready'; gift: { id: string; giftStatus: string }; error: null }
  | { status: 'error'; gift: null; error: string };

type NotificationProjectionState =
  | { status: 'idle'; unread: null; error: null }
  | { status: 'loading'; unread: RealmNotificationUnreadProjection | null; error: null }
  | { status: 'ready'; unread: RealmNotificationUnreadProjection; error: null }
  | { status: 'error'; unread: null; error: string };

type NotificationListProjectionState =
  | { status: 'idle'; list: null; error: null }
  | { status: 'loading'; list: RealmNotificationListProjection | null; error: null }
  | { status: 'ready'; list: RealmNotificationListProjection; error: null }
  | { status: 'error'; list: null; error: string };

type ResourceUploadProjectionState =
  | { status: 'idle'; summary: null; error: null }
  | { status: 'loading'; summary: null; error: null }
  | { status: 'ready'; summary: { resourceId: string; status: string }; error: null }
  | { status: 'error'; summary: null; error: string };

type AccountDataProjectionState =
  | { status: 'idle'; exportRequest: null; error: null }
  | { status: 'loading'; exportRequest: RequestDataExportOutput | null; error: null }
  | { status: 'ready'; exportRequest: RequestDataExportOutput; error: null }
  | { status: 'error'; exportRequest: null; error: string };

type AccountSettingsProjectionState =
  | { status: 'idle'; eligibility: null; error: null }
  | { status: 'loading'; eligibility: RealmCreatorEligibilityDto | null; error: null }
  | { status: 'ready'; eligibility: RealmCreatorEligibilityDto; error: null }
  | { status: 'error'; eligibility: null; error: string };

type HumanChatProjectionState =
  | { status: 'idle'; chats: null; error: null }
  | { status: 'loading'; chats: RealmListChatsResultDto | null; error: null }
  | { status: 'ready'; chats: RealmListChatsResultDto; error: null }
  | { status: 'error'; chats: null; error: string };

type GroupChatProjectionState =
  | { status: 'idle'; groups: null; error: null }
  | { status: 'loading'; groups: RealmGroupChatListResultDto | null; error: null }
  | { status: 'ready'; groups: RealmGroupChatListResultDto; error: null }
  | { status: 'error'; groups: null; error: string };

type ConnectorProjectionState =
  | { status: 'idle'; connectors: RuntimeConnectorProjection[]; error: null }
  | { status: 'loading'; connectors: RuntimeConnectorProjection[]; error: null }
  | { status: 'ready'; connectors: RuntimeConnectorProjection[]; error: null }
  | { status: 'error'; connectors: RuntimeConnectorProjection[]; error: string };

type CatalogProjectionState =
  | { status: 'idle'; providers: RuntimeModelCatalogProvider[]; error: null }
  | { status: 'loading'; providers: RuntimeModelCatalogProvider[]; error: null }
  | { status: 'ready'; providers: RuntimeModelCatalogProvider[]; error: null }
  | { status: 'error'; providers: RuntimeModelCatalogProvider[]; error: string };

type RuntimeCapabilityProjectionState =
  | { status: 'loading'; summary: null; error: null }
  | { status: 'ready'; summary: { capability: string; supported: boolean; ready: boolean; issueKind: string; reasonCode: string; setupStatus: string }; error: null }
  | { status: 'error'; summary: null; error: string };

type RuntimeProviderHealthProjectionState =
  | { status: 'loading'; health: null; error: null }
  | { status: 'ready'; health: RuntimeRouteProviderHealthProjection; error: null }
  | { status: 'error'; health: null; error: string };

type LocalRuntimeFacadeProjectionState =
  | { status: 'loading'; assetId: null; error: null }
  | { status: 'ready'; assetId: string; error: null }
  | { status: 'error'; assetId: null; error: string };

type RealmDataSyncProjectionState =
  | { status: 'loading'; summary: null; error: null }
  | { status: 'ready'; summary: string; error: null }
  | { status: 'error'; summary: null; error: string };

async function resolveTesterLocalRuntimeFacadeProjection(): Promise<string> {
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

async function resolveTesterRealmDataSyncProjection(): Promise<string> {
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

const runtimeConnectorInventory = createRuntimeConnectorInventoryClient({
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

const runtimeModelCatalogProjection = createRuntimeModelCatalogClient({
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

const testerRouteCapabilityRuntime: RuntimeRouteCapabilityRuntime = {
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

const runtimeHealthCoordinatorDiagnostics = new RuntimeHealthCoordinator({
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

const testerGiftTransactionProjectionService: RealmCommerceGiftService = {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Realm projection unavailable');
}

export function SettingsRoute() {
  const [localDrafts, setLocalDrafts] = useState(true);
  const [evidenceMode, setEvidenceMode] = useState(false);
  const [walletProjection, setWalletProjection] = useState<WalletProjectionState>({
    status: 'idle',
    balances: null,
    error: null,
  });
  const [giftTransactionProjection, setGiftTransactionProjection] = useState<GiftTransactionProjectionState>({
    status: 'idle',
    gift: null,
    error: null,
  });
  const [notificationProjection, setNotificationProjection] = useState<NotificationProjectionState>({
    status: 'idle',
    unread: null,
    error: null,
  });
  const [notificationListProjection, setNotificationListProjection] = useState<NotificationListProjectionState>({
    status: 'idle',
    list: null,
    error: null,
  });
  const [resourceUploadProjection, setResourceUploadProjection] = useState<ResourceUploadProjectionState>({
    status: 'idle',
    summary: null,
    error: null,
  });
  const [accountDataProjection, setAccountDataProjection] = useState<AccountDataProjectionState>({
    status: 'idle',
    exportRequest: null,
    error: null,
  });
  const [accountSettingsProjection, setAccountSettingsProjection] = useState<AccountSettingsProjectionState>({
    status: 'idle',
    eligibility: null,
    error: null,
  });
  const [humanChatProjection, setHumanChatProjection] = useState<HumanChatProjectionState>({
    status: 'idle',
    chats: null,
    error: null,
  });
  const [groupChatProjection, setGroupChatProjection] = useState<GroupChatProjectionState>({
    status: 'idle',
    groups: null,
    error: null,
  });
  const [connectorProjection, setConnectorProjection] = useState<ConnectorProjectionState>({
    status: 'idle',
    connectors: [],
    error: null,
  });
  const [catalogProjection, setCatalogProjection] = useState<CatalogProjectionState>({
    status: 'idle',
    providers: [],
    error: null,
  });
  const [runtimeCapabilityProjection, setRuntimeCapabilityProjection] = useState<RuntimeCapabilityProjectionState>({
    status: 'loading',
    summary: null,
    error: null,
  });
  const [runtimeProviderHealthProjection, setRuntimeProviderHealthProjection] =
    useState<RuntimeProviderHealthProjectionState>({
      status: 'loading',
      health: null,
      error: null,
    });
  const [localRuntimeFacadeProjection, setLocalRuntimeFacadeProjection] =
    useState<LocalRuntimeFacadeProjectionState>({
      status: 'loading',
      assetId: null,
      error: null,
    });
  const [realmDataSyncProjection, setRealmDataSyncProjection] =
    useState<RealmDataSyncProjectionState>({
      status: 'loading',
      summary: null,
      error: null,
    });
  useEffect(() => {
    let cancelled = false;
    void resolveTesterLocalRuntimeFacadeProjection().then((assetId) => {
      if (!cancelled) {
        setLocalRuntimeFacadeProjection({ status: 'ready', assetId, error: null });
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setLocalRuntimeFacadeProjection({ status: 'error', assetId: null, error: errorMessage(error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void resolveTesterRealmDataSyncProjection().then((summary) => {
      if (!cancelled) {
        setRealmDataSyncProjection({ status: 'ready', summary, error: null });
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setRealmDataSyncProjection({ status: 'error', summary: null, error: errorMessage(error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setResourceUploadProjection({ status: 'loading', summary: null, error: null });
    void uploadRealmResourceFileWithRealm({
      kind: 'image',
      file: new Blob(['tester-settings-resource-upload'], { type: 'image/png' }),
      realm: {
        services: {
          ResourcesService: {
            async createImageDirectUpload() {
              return {
                deliveryAccess: 'SIGNED',
                provider: 'S3_OBJECT',
                resourceId: 'tester-resource-upload',
                resourceType: 'IMAGE',
                status: 'PENDING',
                storageRef: 'tester/settings/resource-upload',
                uploadUrl: 'https://upload.nimi.test/tester-resource-upload',
              };
            },
            async createVideoDirectUpload() {
              throw new Error('tester settings resource upload only exercises image upload');
            },
            async createAudioDirectUpload() {
              throw new Error('tester settings resource upload only exercises image upload');
            },
            async finalizeResource(resourceId: string) {
              return {
                id: resourceId,
                status: 'READY',
                type: 'IMAGE',
                url: 'https://media.nimi.test/resources/tester-resource-upload',
              } as never;
            },
          },
        },
      } as never,
      fetchImpl: async () => new Response(null, { status: 204 }),
    }).then((result) => {
      if (cancelled) {
        return;
      }
      setResourceUploadProjection({
        status: 'ready',
        summary: {
          resourceId: result.resourceId,
          status: String(result.resource.status || 'unknown'),
        },
        error: null,
      });
    }).catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      setResourceUploadProjection({
        status: 'error',
        summary: null,
        error: errorMessage(error),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const recommendationFeedProjection = {
    cacheState: summarizeLocalRecommendationFeedCacheState({
      cacheState: normalizeLocalRecommendationFeedCacheStateId('LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH'),
    }),
    source: parseLocalRecommendationFeedSourceId('LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX') ?? 'unknown',
    grade: localRecommendationTierToRunGrade('LOCAL_RECOMMENDATION_TIER_RUNNABLE'),
  };
  const recommendationFeedParserProjection = parseRuntimeLocalRecommendationFeedDescriptor({
    deviceProfile: { surface: 'tester.settings' },
    activeCapability: 'LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE',
    cacheState: 'LOCAL_RECOMMENDATION_FEED_CACHE_STATE_STALE',
    items: [{
      itemId: 'tester-image',
      source: 'LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX',
      repo: 'tester/image-model',
      title: 'Tester Image',
      preferredEngine: 'media',
      installPayload: {
        modelId: 'tester/image-model',
        kind: 'LOCAL_ASSET_KIND_IMAGE',
        repo: 'tester/image-model',
      },
    }],
  }, (value: unknown) => value as { surface: string });
  const recommendationCopyProjection = createTesterLocalRecommendationCopyProjection();
  const runtimeReasonProjection = {
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    message: getRuntimeReasonCodeDefaultMessage(ReasonCode.AI_PROVIDER_TIMEOUT) ?? 'unknown',
    credentialMissing: getRuntimeReasonCodeDefaultMessage(ReasonCode.AI_CONNECTOR_CREDENTIAL_MISSING) ?? 'unknown',
    numeric: normalizeRuntimeReasonCode(351) || 'unknown',
    extracted: extractRuntimeReasonCodeFromError(new Error('runtime failed: reason=411')) ?? 'unknown',
  };
  const runtimeLocalAgentIdentityProjection = projectRuntimeLocalAgentIdentity({
    ownerUserId: 'tester-owner',
    realmAgentId: 'tester-realm-agent',
  });
  const runtimeAgentRequestContextProjection = buildRuntimeAgentRequestContext({
    runtimeAppId: 'tester',
    subjectUserId: 'tester-owner',
    localAgentRef: runtimeLocalAgentIdentityProjection.localAgentRef,
  });
  const realmMediaUrlProjection = resolveRealmMediaUrl({
    realmBaseUrl: 'https://realm.example/',
    mediaUrl: '/api/resources/images/tester-preview',
  }) ?? 'unavailable';
  const realmEndpointProjection = projectRealmBaseUrl({
    realmBaseUrl: 'http://127.0.0.1',
  });
  const realmRealtimeProjection = projectRealmRealtimeUrl({
    realmBaseUrl: 'http://127.0.0.1:3002/api',
  });
  const realmFeedScopeProjection = {
    count: REALM_FEED_SCOPES.length,
    agentActivityAdmitted: isRealmFeedScope('agent_activity'),
    localAgentActivityAdmitted: isRealmFeedScope('local_agent_activity'),
  };
  const realmChatAttachmentPayloadProjection = createRealmChatResourceAttachmentPayload('tester-resource-preview');
  const realmChatAttachmentProjection = {
    mediaUrl: resolveRealmChatMediaUrl({
      attachment: {
        displayKind: 'CARD',
        preview: {
          targetType: 'RESOURCE',
          targetId: 'tester-resource-preview',
          displayKind: 'IMAGE',
          url: '/resources/images/tester-chat-preview',
        },
      },
    }, 'https://realm.example/'),
    previewText: resolveRealmChatAttachmentPreviewText({
      attachment: {
        displayKind: 'CARD',
        preview: {
          displayKind: 'IMAGE',
        },
      },
    }),
    targetType: realmChatAttachmentPayloadProjection.attachment.targetType,
  };
  const offlineReasonProjection = {
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    owner: classifyOfflineReasonCode(ReasonCode.RUNTIME_UNAVAILABLE) ?? 'unknown',
    errorOwner: classifyOfflineError(createOfflineNimiError({
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'retry_realm_request',
      message: 'Realm unavailable in Tester offline projection',
      source: 'realm',
    })) ?? 'unknown',
  };
  const runtimeDependencyStateProjection = {
    dependencyStartable: isLocalRuntimeEnvironmentDependencyStartableState('needs_confirmation'),
    jobActive: isLocalRuntimeEnvironmentDependencyJobActiveState('downloading'),
    jobRetryable: isLocalRuntimeEnvironmentDependencyJobRetryableState('failed'),
    jobTransferring: isLocalRuntimeEnvironmentDependencyJobTransferringState('verifying'),
    dependencyRepairRequired: isLocalRuntimeEnvironmentDependencyRepairRequiredState('repair_required'),
  };
  const runtimeDependencyPlanProjection = parseLocalRuntimeEnvironmentPlanProjection({
    planId: 'tester-plan',
    packId: 'tester-local-speech',
    productLabel: 'Tester Local Speech',
    hostProfileId: 'tester-host',
    platformTuple: 'darwin-arm64',
    state: 'needs_confirmation',
    dependencies: [{
      dependencyFamily: 'python',
      dependencyId: 'tester-python',
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'managed_download',
      confirmationRequired: true,
      environmentKey: 'tester-local-speech',
      reasonCode: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    }],
  });
  const runtimeDependencyJobProjection = parseLocalRuntimeEnvironmentDependencyJobProjection({
    jobId: 'tester-job',
    environmentKey: 'tester-local-speech',
    dependencyFamily: 'python',
    dependencyId: 'tester-python',
    state: 'downloading',
    sourceKind: 'managed_download',
    retryable: true,
    bytesReceived: '512',
    bytesTotal: '1024',
    percent: 50,
    speedBytesPerSec: '256',
    etaSeconds: '2',
  });
  const firstRunProfileProjection = {
    minimal: selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'minimal')?.alias ?? 'none',
    recommended: selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'recommended')?.alias ?? 'none',
  };
  const runtimeDependencyPlanItem = runtimeDependencyPlanProjection.dependencies[0]!;
  const runtimeFirstRunDependency = {
    ...runtimeDependencyPlanItem,
    dependencyFamily: 'model.asset',
    state: 'needs_confirmation',
  };
  const runtimeFirstRunFailedJob = {
    ...runtimeDependencyJobProjection,
    dependencyFamily: 'model.asset',
    state: 'failed',
    failureDetail: 'unexpected eof while reading body',
  };
  const runtimeFirstRunMaterializationProjection = {
    status: 'failed' as const,
    reason: 'runtime_materialization_job_failed',
    missingDependencyFamilies: [],
    dependencies: [{
      packId: runtimeDependencyPlanProjection.packId,
      dependency: runtimeFirstRunDependency,
      job: runtimeFirstRunFailedJob,
    }],
  };
  const runtimeFirstRunRepairProjection = {
    ...runtimeFirstRunMaterializationProjection,
    status: 'repair_required' as const,
    reason: 'runtime_materialization_repair_required',
    dependencies: [{
      packId: runtimeDependencyPlanProjection.packId,
      dependency: { ...runtimeFirstRunDependency, state: 'repair_required' },
      job: null,
    }],
  };
  const runtimeFirstRunMaterializationProgress = aggregateMaterializationDownloadProgress([{
    packId: runtimeDependencyPlanProjection.packId,
    dependency: runtimeFirstRunDependency,
    job: runtimeDependencyJobProjection,
  }]);
  const runtimeFirstRunMaterializationSummary = {
    retryableJobs: retryableInterruptedFirstRunMaterializationJobs(runtimeFirstRunMaterializationProjection).length,
    repairableDependencies: repairableFirstRunMaterializationDependencies(runtimeFirstRunRepairProjection).length,
    percent: runtimeFirstRunMaterializationProgress?.percent ?? null,
  };
  const localRuntimeAssetIdProjection = { assetId: toCanonicalLocalRuntimeAssetId('local/tester-model'), lookupKey: toCanonicalLocalRuntimeAssetLookupKey('LOCAL/Tester-Model') };
  const localRuntimeAssetKindProjection = createTesterLocalRuntimeAssetKindProjection();
  const runtimeConfigProjection = createTesterRuntimeConfigProjection();
  const runtimeTargetCallOptionsProjection = buildRuntimeTargetCallOptions({
    targetId: 'tester.settings.runtime-route',
    timeoutMs: 5000,
    callerKind: 'third-party-app',
    surfaceId: 'tester.settings',
    connectorId: 'tester-cloud',
    createTraceId: (prefix = 'tester-runtime') => `${prefix}-trace`,
  });
  const runtimeRequestMetadataProjection = buildRuntimeRequestMetadata({
    connectorId: 'tester-cloud',
    createTraceId: (prefix = 'tester-metadata') => `${prefix}-trace`,
  });
  const runtimeLocalAiReasonProjection = mapRuntimeErrorToLocalAiReasonCode({
    reasonCode: 'AI_STREAM_BROKEN',
  }) ?? 'unknown';
  const memoryEmbeddingConfig = {
    ...createEmptyMemoryEmbeddingConfig({
      kind: 'feature',
      ownerId: 'tester',
      surfaceId: 'settings-memory-embedding',
    }),
    sourceKind: 'cloud' as const,
    bindingRef: {
      kind: 'cloud' as const,
      connectorId: 'tester-cloud',
      modelId: 'tester-embedding',
    },
  };
  const memoryEmbeddingRouteProjection = projectMemoryEmbeddingRouteAvailability({
    config: memoryEmbeddingConfig,
    routeOptions: {
      capability: 'text.embed',
      selected: null,
      local: { models: [] },
      connectors: [{
        id: 'tester-cloud',
        label: 'Tester Cloud',
        provider: 'tester',
        models: ['tester-embedding'],
      }],
    },
  });
  const runtimeAgentMemoryProjection = projectRuntimeAgentCanonicalMemoryBankStatus({
    config: memoryEmbeddingConfig,
    bank: {
      bankId: 'tester-agent-bank',
      displayName: 'Tester Agent Memory',
      canonicalAgentScope: true,
      publicApiWritable: false,
      embeddingProfile: {
        provider: 'tester',
        modelId: 'tester-embedding',
        version: 'v1',
        dimension: 768,
        distanceMetric: 1,
        migrationPolicy: 1,
      },
    },
    state: {
      bindingIntentPresent: true,
      bindingSourceKind: 'cloud',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'tester:tester-embedding:v1',
      canonicalBankStatus: 'bound_equivalent',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: false,
        cutoverAllowed: false,
      },
    },
  });
  const memoryEmbeddingRuntimeProjection = createTesterMemoryEmbeddingRuntimeProjection();
  const runtimeAgentInspectProjection = createTesterRuntimeAgentInspectProjection();
  const runtimeAgentPresentationProfileProjection = createTesterRuntimeAgentPresentationProfileProjection();
  const externalAgentProjection = createTesterExternalAgentProjection();
  const runtimeRouteModelProfileProjection = findRuntimeRouteModelProfile({
    capability: 'text.generate',
    selected: null,
    local: { models: [] },
    connectors: [{
      id: 'tester-cloud',
      label: 'Tester Cloud',
      provider: 'tester',
      models: ['tester-text'],
      modelProfiles: [{
        model: 'tester-text',
        maxContextTokens: 32000,
        maxOutputTokens: 2048,
        contextSource: 'provider-api',
      }],
    }],
  }, {
    source: 'cloud',
    connectorId: 'tester-cloud',
    model: 'tester-text',
  });
  const localRouteOptionProjection = (() => {
    const option = {
      localModelId: 'tester-local-embedding',
      model: 'local/tester-embedding',
      modelId: 'local/tester-embedding',
      engine: 'sidecar',
      provider: 'sidecar',
      status: 'active',
      capabilities: ['text.embed'],
    };
    return {
      selectable: isRuntimeRouteLocalOptionSelectable(option),
      binding: runtimeRouteLocalOptionToBinding(option, {
        defaultEndpoint: 'http://127.0.0.1:19000/v1',
      }),
    };
  })();
  const runtimeRouteBindingMatchProjection = runtimeRouteBindingsMatch(localRouteOptionProjection.binding, {
    ...localRouteOptionProjection.binding,
    model: 'local/tester-embedding',
    localModelId: 'tester-local-embedding',
  });
  const runtimeCapabilityCoverageProjection = projectRuntimeRouteCapabilityCoverage({
    capability: 'image',
    localNodes: [],
    localModels: [],
    connectors: [{
      status: 'healthy',
      models: ['tester-image-model'],
      modelCapabilities: {
        'tester-image-model': ['image.generate'],
      },
    }],
  });
  useEffect(() => {
    let cancelled = false;
    const selectionStore = updateRuntimeRouteCapabilityBinding(
      createDefaultRuntimeRouteCapabilitySelectionStore(),
      'audio.synthesize',
      { source: 'cloud', connectorId: 'tester-cloud', provider: 'tester', model: 'tester-tts' },
    );
    void buildRuntimeRouteCapabilityProjection({
      capability: 'audio.synthesize',
      selectionStore,
      routeRuntime: testerRouteCapabilityRuntime,
    }).then((projection) => {
      if (cancelled) {
        return;
      }
      const setupState = resolveConversationRuntimeRouteSetupStateFromProjection({
        mode: 'ai',
        projection,
      });
      setRuntimeCapabilityProjection({
        status: 'ready',
        summary: {
          capability: projection.capability,
          supported: projection.supported,
          ready: isRuntimeRouteCapabilityProjectionReady(projection),
          issueKind: getRuntimeRouteCapabilityProjectionIssueKind(projection) ?? 'none',
          reasonCode: projection.reasonCode ?? 'ok',
          setupStatus: setupState.status,
        },
        error: null,
      });
    }).catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      setRuntimeCapabilityProjection({
        status: 'error',
        summary: null,
        error: errorMessage(error),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void checkRuntimeRouteProviderHealth({
      appId: 'dev.nimi.tester',
      provider: 'tester',
      capability: 'text.generate',
      connectorId: 'tester-cloud',
      localProviderEndpoint: 'http://127.0.0.1:19000/v1',
      localProviderModel: 'tester-health-model',
      checkModelHealth: async (request) => ({
        healthy: true,
        status: ModelHealthStatus.HEALTHY,
        endpoint: request.endpoint,
        modelId: request.modelId,
        detail: 'tester runtime route provider ready',
        actionHint: 'none',
        reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
      }),
      nowIso: () => '2026-05-31T00:00:00.000Z',
    }).then((health) => {
      if (!cancelled) {
        setRuntimeProviderHealthProjection({ status: 'ready', health, error: null });
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setRuntimeProviderHealthProjection({ status: 'error', health: null, error: errorMessage(error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const runtimeRouteReasoningProjection = (() => {
    const resolvedBinding: RuntimeResolvedBinding = {
      capability: 'text.generate',
      source: 'cloud',
      connectorId: 'tester-cloud',
      provider: 'tester',
      model: 'tester-reasoning-model',
      modelId: 'tester-reasoning-model',
      resolvedBindingRef: 'binding:tester-reasoning',
    };
    const metadata: RuntimeRouteDescribeResult = {
      capability: 'text.generate',
      metadataVersion: 'v1',
      resolvedBindingRef: 'binding:tester-reasoning',
      metadataKind: 'text.generate',
      metadata: {
        supportsThinking: true,
        traceModeSupport: 'separate',
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    };
    const support = resolveRuntimeTextRouteReasoningSupport({
      resolvedBinding,
      metadata,
    });
    const config = resolveRuntimeRouteReasoningConfig('on', support);
    return {
      supported: support.supported,
      reason: support.reason ?? 'ok',
      traceMode: config.traceMode ?? 'none',
    };
  })();
  const modelConfigBindingProjection = pickerSelectionToBinding({
    source: 'cloud',
    connectorId: 'tester-cloud',
    model: 'tester-config-model',
    provider: 'tester',
  });
  const modelConfigBindingSummaryProjection = summarizeBinding(modelConfigBindingProjection);
  const runtimeHealthSummaryProjection = projectRuntimeHealthSummary({
    status: RuntimeHealthStatus.READY,
    reason: 'tester runtime ready',
    queueDepth: 0,
    activeWorkflows: 0,
    activeInferenceJobs: 0,
    cpuMilli: '0',
    memoryBytes: '0',
    vramBytes: '0',
    sampledAt: { seconds: '1710000000', nanos: 0 },
  });
  const runtimeHealthWireProjection = {
    statusName: projectRuntimeHealthStatusName(RuntimeHealthStatus.READY) ?? 'unknown',
    sampledAt: toIsoFromTimestamp({ seconds: '1710000000', nanos: 0 }) ?? 'unknown',
  };
  const localRuntimeProfileProjection = (() => {
    const [profile] = normalizeLocalRuntimeProfilesDeclaration([
      {
        id: 'tester-profile',
        title: 'Tester Profile',
        consumeCapabilities: ['chat'],
        entries: [
          { entryId: 'tester-service', kind: 'service', capability: 'chat', serviceId: 'tester-runtime' },
          { entryId: 'tester-asset', kind: 'asset', capability: 'chat', assetId: 'tester/chat-model', assetKind: 'chat' },
        ],
      },
    ]);
    const bridge = profile ? bridgeLocalRuntimeProfile(profile, 'chat') : null;
    return {
      profileCount: profile ? 1 : 0,
      runtimeEntryCount: bridge?.runtimeEntries?.required?.length ?? 0,
      assetCount: bridge?.assets.length ?? 0,
    };
  })();
  const localRuntimeExecutionPlanProjection = parseLocalRuntimeExecutionPlan({
    planId: 'tester-execution-plan',
    targetId: 'tester-runtime',
    capability: 'chat',
    deviceProfile: {
      os: 'darwin',
      arch: 'arm64',
      gpu: { available: true, memoryModel: 'unified' },
      python: { available: true, version: '3.12' },
      npu: { available: false, ready: false },
      diskFreeBytes: 1024,
      ports: [{ port: 7341, available: true }],
    },
    entries: [{
      entryId: 'tester-service',
      kind: 'LOCAL_EXECUTION_ENTRY_KIND_SERVICE',
      capability: 'chat',
      required: true,
      selected: true,
      preferred: true,
    }],
    selectionRationale: [{
      entryId: 'tester-service',
      selected: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      detail: 'tester selected SDK execution decoder path',
    }],
    preflightDecisions: [{
      entryId: 'tester-service',
      target: 'port',
      check: 'port_available',
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      detail: 'tester port available',
    }],
    warnings: [],
  });
  const localRuntimeServiceNodeProjection = {
    service: parseLocalRuntimeServiceDescriptor({
      serviceId: 'tester-service',
      title: 'Tester Service',
      engine: 'speech',
      artifactType: 'attached-endpoint',
      capabilities: ['audio.synthesize'],
      status: 'LOCAL_SERVICE_STATUS_ACTIVE',
      reasonCode: ReasonCode.ACTION_EXECUTED,
      installedAt: '2026-05-31T00:00:00Z',
      updatedAt: '2026-05-31T00:00:00Z',
    }),
    node: parseLocalRuntimeNodeDescriptor({
      nodeId: 'tester-node',
      title: 'Tester Node',
      serviceId: 'tester-service',
      capabilities: ['audio.synthesize'],
      adapter: 'SPEECH_NATIVE_ADAPTER',
      available: true,
      readOnly: true,
    }),
  };
  const appBridgeProjection = parseNimiAppBridgeProjection({
    registryPath: '/tester/.nimi/apps/registry.json',
    packagesPath: '/tester/.nimi/apps/packages.json',
    registryRows: [{
      appId: 'tester.app',
      appKind: 'nimi-app',
      displayName: 'Tester App',
      publisher: 'Tester',
      trustTier: 'nimi-community',
      ordinaryVisibility: 'ordinary-visible',
      releaseDescriptorRef: 'tester.app.descriptor',
      installStoragePolicyRef: 'tester.storage',
      sourceRule: 'tester-fixture',
      admissionStatus: 'admitted',
      installedVersion: '1.0.0',
    }],
    releaseDescriptors: [{
      descriptorId: 'tester.app.descriptor',
      appId: 'tester.app',
      version: '1.0.0',
      descriptorClass: 'external-immutable-artifact',
      sourceKind: 'github-release',
      sourceRef: 'https://example.test/tester/releases/v1',
      artifactLocator: 'https://example.test/tester/releases/v1/app.tar.zst',
      digestAlgorithm: 'sha256',
      sha256: 'b'.repeat(64),
      size: '1024',
      provenanceRef: 'tester.provenance',
      packageKind: 'nimi-app',
      entryRef: 'index.html',
      sandboxRef: 'tester.sandbox',
      permissionsRef: 'tester.permissions',
      storagePolicyRef: 'tester.storage',
      admissionPath: 'tester-sdk-parser-proof',
      mutableSourceAllowed: false,
      installDigestVerificationRequired: 'required',
      sourceRule: 'tester-fixture',
    }],
    installEvidence: [{
      appId: 'tester.app',
      releaseDescriptorRef: 'tester.app.descriptor',
      storagePolicyRef: 'tester.storage',
      installedVersion: '1.0.0',
      sha256: 'b'.repeat(64),
      verificationState: 'digest-verified',
    }],
  });
  const accountAppLibraryProjection = parseAccountAppLibraryRecord({
    schemaVersion: 1,
    accountId: 'tester-account',
    updatedAt: '2026-05-31T00:00:00Z',
    apps: [{
      appId: 'tester.app',
      libraryState: 'enabled',
      installed: true,
      dataPolicy: 'keep_on_uninstall',
    }],
  });
  const runtimeAuditWireProjection = {
    callerKindName: projectRuntimeAuditCallerKindName(CallerKind.THIRD_PARTY_APP) ?? 'unknown',
    usageWindowName: projectRuntimeUsageWindowName(UsageWindow.HOUR) ?? 'unknown',
  };
  const runtimeHealthCoordinatorProjection = runtimeHealthCoordinatorDiagnostics.getSnapshot();
  const runtimeAgentConsumerProjection = (() => {
    const projectionEvent = {
      eventName: 'runtime.agent.hook.pending',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      originatingTurnId: 'tester-turn',
      originatingStreamId: 'tester-stream',
      detail: { intentId: 'tester-hook' },
    } as RuntimeAgentConsumeEvent;
    const timelineEvent = {
      eventName: 'runtime.agent.turn.text_delta',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      timeline: {
        turnId: 'tester-turn',
        streamId: 'tester-stream',
        channel: 'text',
        offsetMs: 24,
        sequence: 2,
        startedAtWall: '2026-05-31T00:00:00.000Z',
        observedAtWall: '2026-05-31T00:00:00.024Z',
        timebaseOwner: 'runtime',
        projectionRuleId: 'K-AGCORE-051',
        clockBasis: 'monotonic_with_wall_anchor',
        providerNeutral: true,
        appLocalAuthority: false,
      },
      detail: { text: 'tester' },
    } as RuntimeAgentConsumeEvent;
    const recoveryEvents = buildRuntimeAgentSnapshotRecoveryEvents({
      turn: {
        turnId: 'tester-turn',
        status: 'completed',
        messageId: 'tester-message',
        text: 'tester done',
        structured: {
          message: {
            message_id: 'tester-message',
            text: 'tester done',
          },
        },
        finishReason: 'stop',
      },
      ownerUserId: 'tester-owner',
      realmAgentId: 'tester-agent',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      requestId: 'tester-request',
      requestMessageId: '',
      currentTurnAccepted: false,
      currentRuntimeTurnId: '',
      currentRuntimeStreamId: '',
      hasStructuredEnvelope: false,
      hasCommittedMessage: false,
    });
    const projectionSummary = summarizeRuntimeAgentProjectionEvent(projectionEvent);
    const timelineSummary = summarizeRuntimeAgentTimeline(timelineEvent);
    const terminal = recoveryEvents[recoveryEvents.length - 1];
    return {
      projectionScoped: isRuntimeAgentProjectionEvent(projectionEvent) && matchesRuntimeAgentProjectionScope({
        event: projectionEvent,
        conversationAnchorId: 'tester-anchor',
        currentTurnAccepted: true,
        currentRuntimeTurnId: 'tester-turn',
      }),
      projectionEventName: projectionSummary.eventName,
      timelineChannel: timelineSummary?.channel ?? 'none',
      recoveryEventCount: recoveryEvents.length,
      terminalEventName: terminal?.eventName ?? 'none',
    };
  })();
  const runtimeStructProjection = (() => {
    const encoded = toProtoStruct({
      surfaceId: 'tester.settings',
      audit: {
        kind: 'diagnostic',
        retryable: false,
      },
      tags: ['runtime', 'settings'],
    });
    const decoded = fromProtoStruct(encoded);
    const audit = decoded.audit && typeof decoded.audit === 'object'
      ? decoded.audit as Record<string, unknown>
      : {};
    return {
      surfaceId: String(decoded.surfaceId || 'unknown'),
      auditKind: String(audit.kind || 'unknown'),
      tagCount: Array.isArray(decoded.tags) ? decoded.tags.length : 0,
    };
  })();
  const avatarVoiceCueProjection = resolveAgentVoicePlaybackCue(
    new Uint8Array([128, 208, 232, 208, 128, 48, 24, 48]),
    0.24,
    new Uint8Array([230, 220, 188, 132, 84, 52, 24, 12]),
  );
  const runtimeAvatarVoiceProjection = (() => {
    const timeline = (
      channel: RuntimeAgentTimelineEnvelope['channel'],
      offsetMs: number,
    ): RuntimeAgentTimelineEnvelope => ({
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      channel,
      offsetMs,
      sequence: channel === 'voice' ? 1 : 2,
      startedAtWall: '2026-05-31T00:00:00.000Z',
      observedAtWall: '2026-05-31T00:00:00.024Z',
      timebaseOwner: 'runtime',
      projectionRuleId: 'K-AGCORE-051',
      clockBasis: 'monotonic_with_wall_anchor',
      providerNeutral: true,
      appLocalAuthority: false,
    });
    const voiceEvent: RuntimeAgentPresentationVoicePlaybackRequestedEvent = {
      eventName: 'runtime.agent.presentation.voice_playback_requested',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      timeline: timeline('voice', 0),
      detail: {
        audioArtifactId: 'tester-audio',
        audioMimeType: 'audio/wav',
        playbackState: 'requested',
      },
    };
    const lipsyncEvent: RuntimeAgentPresentationLipsyncFrameBatchEvent = {
      eventName: 'runtime.agent.presentation.lipsync_frame_batch',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      timeline: timeline('lipsync', 0),
      detail: {
        audioArtifactId: 'tester-audio',
        frames: [
          { frameSequence: 1, offsetMs: 0, durationMs: 80, mouthOpenY: 0.2, audioLevel: 0.24 },
          { frameSequence: 2, offsetMs: 80, durationMs: 90, mouthOpenY: 0.7, audioLevel: 0.66 },
        ],
      },
    };
    const decision = resolveRuntimeAgentVoicePlaybackDecision({
      voiceEvent,
      lipsyncEvent,
      activeTurnId: 'tester-turn',
      activeStreamId: 'tester-stream',
    });
    return decision.kind === 'schedule'
      ? {
        kind: decision.kind,
        cueCount: decision.schedule.cueEnvelope.cues.length,
        source: decision.schedule.cueEnvelope.source,
      }
      : {
        kind: decision.kind,
        cueCount: 0,
        source: decision.kind === 'reject' ? decision.reason : decision.audioArtifactId,
      };
  })();
  const refreshWalletProjection = async () => {
    setWalletProjection((current) => ({
      status: 'loading',
      balances: current.balances,
      error: null,
    }));
    try {
      const balances = await loadRealmCurrencyBalances();
      setWalletProjection({
        status: 'ready',
        balances,
        error: null,
      });
    } catch (error) {
      setWalletProjection({
        status: 'error',
        balances: null,
        error: errorMessage(error),
      });
    }
  };
  const refreshGiftTransactionProjection = async () => {
    setGiftTransactionProjection((current) => ({
      status: 'loading',
      gift: current.gift,
      error: null,
    }));
    try {
      const gift = await loadRealmGiftTransaction(
        'tester-gift-preview',
        testerGiftTransactionProjectionService,
      );
      setGiftTransactionProjection({
        status: 'ready',
        gift: {
          id: gift.id,
          giftStatus: gift.status,
        },
        error: null,
      });
    } catch (error) {
      setGiftTransactionProjection({
        status: 'error',
        gift: null,
        error: errorMessage(error),
      });
    }
  };
  const refreshNotificationProjection = async () => {
    setNotificationProjection((current) => ({
      status: 'loading',
      unread: current.unread,
      error: null,
    }));
    try {
      const unread = await loadRealmNotificationUnreadCount(getPlatformClient().realm);
      setNotificationProjection({
        status: 'ready',
        unread,
        error: null,
      });
    } catch (error) {
      setNotificationProjection({
        status: 'error',
        unread: null,
        error: errorMessage(error),
      });
    }
  };
  const refreshNotificationListProjection = async () => {
    setNotificationListProjection((current) => ({
      status: 'loading',
      list: current.list,
      error: null,
    }));
    try {
      const list = await loadRealmNotifications(getPlatformClient().realm, {
        limit: 5,
        unreadOnly: false,
      });
      setNotificationListProjection({
        status: 'ready',
        list: toRealmNotificationListProjection(list, 'Tester notification', 'Unknown actor'),
        error: null,
      });
    } catch (error) {
      setNotificationListProjection({
        status: 'error',
        list: null,
        error: errorMessage(error),
      });
    }
  };
  const requestAccountDataExportProjection = async () => {
    setAccountDataProjection((current) => ({
      status: 'loading',
      exportRequest: current.exportRequest,
      error: null,
    }));
    try {
      const exportRequest = await requestDataExport(getPlatformClient().realm, {
        format: 'JSON',
        includeMedia: false,
        includeMessages: false,
        locale: 'en-US',
      });
      setAccountDataProjection({
        status: 'ready',
        exportRequest,
        error: null,
      });
    } catch (error) {
      setAccountDataProjection({
        status: 'error',
        exportRequest: null,
        error: errorMessage(error),
      });
    }
  };
  const refreshAccountSettingsProjection = async () => {
    setAccountSettingsProjection((current) => ({
      status: 'loading',
      eligibility: current.eligibility,
      error: null,
    }));
    try {
      const eligibility = await loadRealmCreatorEligibility(getPlatformClient().realm);
      setAccountSettingsProjection({
        status: 'ready',
        eligibility,
        error: null,
      });
    } catch (error) {
      setAccountSettingsProjection({
        status: 'error',
        eligibility: null,
        error: errorMessage(error),
      });
    }
  };
  const refreshHumanChatProjection = async () => {
    setHumanChatProjection((current) => ({
      status: 'loading',
      chats: current.chats,
      error: null,
    }));
    try {
      const chats = await listRealmChats(20);
      setHumanChatProjection({
        status: 'ready',
        chats,
        error: null,
      });
    } catch (error) {
      setHumanChatProjection({
        status: 'error',
        chats: null,
        error: errorMessage(error),
      });
    }
  };
  const refreshGroupChatProjection = async () => {
    setGroupChatProjection((current) => ({
      status: 'loading',
      groups: current.groups,
      error: null,
    }));
    try {
      const groups = await listRealmGroupChats(getPlatformClient().realm, 20);
      setGroupChatProjection({
        status: 'ready',
        groups,
        error: null,
      });
    } catch (error) {
      setGroupChatProjection({
        status: 'error',
        groups: null,
        error: errorMessage(error),
      });
    }
  };
  const refreshConnectorProjection = async () => {
    setConnectorProjection((current) => ({
      status: 'loading',
      connectors: current.connectors,
      error: null,
    }));
    try {
      const connectors = await runtimeConnectorInventory.listConnectors();
      setConnectorProjection({
        status: 'ready',
        connectors,
        error: null,
      });
    } catch (error) {
      setConnectorProjection((current) => ({
        status: 'error',
        connectors: current.connectors,
        error: errorMessage(error),
      }));
    }
  };
  const refreshCatalogProjection = async () => {
    setCatalogProjection((current) => ({
      status: 'loading',
      providers: current.providers,
      error: null,
    }));
    try {
      const providers = await runtimeModelCatalogProjection.listProviders();
      setCatalogProjection({
        status: 'ready',
        providers,
        error: null,
      });
    } catch (error) {
      setCatalogProjection((current) => ({
        status: 'error',
        providers: current.providers,
        error: errorMessage(error),
      }));
    }
  };

  return (
    <Surface className="panel-section" material="glass-thin" tone="panel">
      <div className="panel-heading">
        <h2>Settings</h2>
        <ProgressIndicator value={localDrafts ? 72 : 46} showValue />
      </div>
      <label className="setting-row">
        <span>Local draft data</span>
        <Toggle checked={localDrafts} onChange={setLocalDrafts} />
      </label>
      <label className="setting-row">
        <span>Evidence capture</span>
        <Toggle checked={evidenceMode} onChange={setEvidenceMode} />
      </label>
      <div className="setting-row">
        <span>Realm wallet projection</span>
        <div className="inline-flex items-center gap-2">
          {walletProjection.status === 'ready' ? (
            <>
              <StatusBadge tone="info">Spark {walletProjection.balances.sparkBalance}</StatusBadge>
              <StatusBadge tone="success">Gem {walletProjection.balances.gemBalance}</StatusBadge>
            </>
          ) : (
            <StatusBadge tone={walletProjection.status === 'error' ? 'danger' : 'neutral'}>
              {walletProjection.status === 'error' ? walletProjection.error : 'not loaded'}
            </StatusBadge>
          )}
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={walletProjection.status === 'loading'}
            onClick={() => {
              void refreshWalletProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Realm gift transaction projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={giftTransactionProjection.status === 'error' ? 'danger' : 'info'}>
            {giftTransactionProjection.status === 'ready'
              ? `${giftTransactionProjection.gift.id}: ${giftTransactionProjection.gift.giftStatus}`
              : giftTransactionProjection.status === 'error'
                ? giftTransactionProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={giftTransactionProjection.status === 'loading'}
            onClick={() => {
              void refreshGiftTransactionProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Realm notification projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={notificationProjection.status === 'error' ? 'danger' : 'info'}>
            {notificationProjection.status === 'ready'
              ? `Unread ${notificationProjection.unread.total}`
              : notificationProjection.status === 'error'
                ? notificationProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={notificationProjection.status === 'loading'}
            onClick={() => {
              void refreshNotificationProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Realm notification list projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={notificationListProjection.status === 'error' ? 'danger' : 'info'}>
            {notificationListProjection.status === 'ready'
              ? `${notificationListProjection.list.items.length} item${notificationListProjection.list.items.length === 1 ? '' : 's'}`
              : notificationListProjection.status === 'error'
                ? notificationListProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={notificationListProjection.status === 'loading'}
            onClick={() => {
              void refreshNotificationListProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Realm media URL projection</span>
        <StatusBadge tone="neutral">{realmMediaUrlProjection}</StatusBadge>
      </div>
      <div className="setting-row">
        <span>Realm resource upload projection</span>
        <StatusBadge tone={resourceUploadProjection.status === 'ready' ? 'success' : resourceUploadProjection.status === 'error' ? 'danger' : 'neutral'}>
          {resourceUploadProjection.status === 'ready'
            ? `${resourceUploadProjection.summary.resourceId}: ${resourceUploadProjection.summary.status}`
            : resourceUploadProjection.status === 'error'
              ? resourceUploadProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Realm account-data export projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={accountDataProjection.status === 'error' ? 'danger' : 'info'}>
            {accountDataProjection.status === 'ready'
              ? `${accountDataProjection.exportRequest.status}${accountDataProjection.exportRequest.taskId ? ` ${accountDataProjection.exportRequest.taskId}` : ''}`
              : accountDataProjection.status === 'error'
                ? accountDataProjection.error
                : 'not requested'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={accountDataProjection.status === 'loading'}
            onClick={() => {
              void requestAccountDataExportProjection();
            }}
          >
            Request
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>SDK Realm account settings projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={accountSettingsProjection.status === 'error' ? 'danger' : 'info'}>
            {accountSettingsProjection.status === 'ready'
              ? `${accountSettingsProjection.eligibility.tier}: ${accountSettingsProjection.eligibility.status}`
              : accountSettingsProjection.status === 'error'
                ? accountSettingsProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={accountSettingsProjection.status === 'loading'}
            onClick={() => {
              void refreshAccountSettingsProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Kit Realm human chat projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={humanChatProjection.status === 'error' ? 'danger' : 'info'}>
            {humanChatProjection.status === 'ready'
              ? `${humanChatProjection.chats.items.length} chat${humanChatProjection.chats.items.length === 1 ? '' : 's'}`
              : humanChatProjection.status === 'error'
                ? humanChatProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={humanChatProjection.status === 'loading'}
            onClick={() => {
              void refreshHumanChatProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>SDK Realm group chat projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={groupChatProjection.status === 'error' ? 'danger' : 'info'}>
            {groupChatProjection.status === 'ready'
              ? `${groupChatProjection.groups.items.length} group${groupChatProjection.groups.items.length === 1 ? '' : 's'}`
              : groupChatProjection.status === 'error'
                ? groupChatProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={groupChatProjection.status === 'loading'}
            onClick={() => {
              void refreshGroupChatProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Realm endpoint projection</span>
        <StatusBadge tone="neutral">{realmEndpointProjection}</StatusBadge>
      </div>
      <div className="setting-row">
        <span>Realm realtime projection</span>
        <StatusBadge tone="neutral">{realmRealtimeProjection}</StatusBadge>
      </div>
      <div className="setting-row">
        <span>Realm feed scope projection</span>
        <StatusBadge tone={realmFeedScopeProjection.agentActivityAdmitted && !realmFeedScopeProjection.localAgentActivityAdmitted ? 'success' : 'warning'}>
          {realmFeedScopeProjection.count} scopes / {realmFeedScopeProjection.agentActivityAdmitted ? 'agent activity' : 'missing'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Realm chat attachment projection</span>
        <StatusBadge tone="neutral">
          {realmChatAttachmentProjection.targetType} / {realmChatAttachmentProjection.previewText} / {realmChatAttachmentProjection.mediaUrl}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Kit avatar voice cue projection</span>
        <StatusBadge tone="neutral">
          {avatarVoiceCueProjection.visemeId ?? 'silent'} / {avatarVoiceCueProjection.amplitude.toFixed(2)}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Kit runtime avatar voice projection</span>
        <StatusBadge tone="neutral">
          {runtimeAvatarVoiceProjection.kind} / {runtimeAvatarVoiceProjection.source} / {runtimeAvatarVoiceProjection.cueCount}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime recommendation projection</span>
        <StatusBadge tone="neutral">
          {recommendationFeedProjection.source} / {recommendationFeedProjection.cacheState} / {recommendationFeedProjection.grade} / {recommendationCopyProjection.detailCount} / {recommendationCopyProjection.feedSummary}: {recommendationCopyProjection.summary || recommendationCopyProjection.reason}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime recommendation feed parser</span>
        <StatusBadge tone="neutral">
          {recommendationFeedParserProjection.activeCapability} / {recommendationFeedParserProjection.items.length}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime connector projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={connectorProjection.status === 'error' ? 'danger' : 'info'}>
            {connectorProjection.status === 'ready'
              ? `${connectorProjection.connectors.length} connector${connectorProjection.connectors.length === 1 ? '' : 's'}`
              : connectorProjection.status === 'error'
                ? connectorProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={connectorProjection.status === 'loading'}
            onClick={() => {
              void refreshConnectorProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Runtime model catalog projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={catalogProjection.status === 'error' ? 'danger' : 'info'}>
            {catalogProjection.status === 'ready'
              ? `${catalogProjection.providers[0]?.provider ?? 'none'} / ${catalogProjection.providers[0]?.source ?? 'unknown'}`
              : catalogProjection.status === 'error'
                ? catalogProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={catalogProjection.status === 'loading'}
            onClick={() => {
              void refreshCatalogProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <span>Runtime reason projection</span>
        <StatusBadge tone="neutral">
          {runtimeReasonProjection.reasonCode}: {runtimeReasonProjection.message} / {runtimeReasonProjection.credentialMissing} / {runtimeReasonProjection.numeric} / {runtimeReasonProjection.extracted}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime LocalAgent identity projection</span>
        <StatusBadge tone="neutral">
          {runtimeAgentRequestContextProjection.localAgentRef}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Offline reason projection</span>
        <StatusBadge tone="neutral">
          {offlineReasonProjection.owner}: {offlineReasonProjection.reasonCode} / {offlineReasonProjection.errorOwner}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime dependency state projection</span>
        <StatusBadge tone={runtimeDependencyStateProjection.dependencyStartable ? 'info' : 'neutral'}>
          {runtimeDependencyStateProjection.dependencyStartable ? 'startable' : 'not startable'}
          {' / '}
          {runtimeDependencyStateProjection.jobActive ? 'active job' : 'settled job'}
          {' / '}
          {runtimeDependencyStateProjection.jobRetryable ? 'retryable job' : 'not retryable'}
          {' / '}
          {runtimeDependencyStateProjection.jobTransferring ? 'transferring job' : 'not transferring'}
          {' / '}
          {runtimeDependencyStateProjection.dependencyRepairRequired ? 'repair required' : 'repair clear'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime dependency parser projection</span>
        <StatusBadge tone={runtimeDependencyPlanProjection.dependencies[0]?.confirmationRequired ? 'warning' : 'neutral'}>
          {runtimeDependencyPlanProjection.packId}: {runtimeDependencyPlanProjection.dependencies[0]?.dependencyId ?? 'none'}
          {' / '}
          {runtimeDependencyJobProjection.percent}%
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>First-run materialization projection</span>
        <StatusBadge tone={runtimeFirstRunMaterializationSummary.retryableJobs > 0 ? 'warning' : 'neutral'}>
          {firstRunProfileProjection.minimal}/{firstRunProfileProjection.recommended}
          {' / '}
          retry {runtimeFirstRunMaterializationSummary.retryableJobs}
          {' / '}
          repair {runtimeFirstRunMaterializationSummary.repairableDependencies}
          {' / '}
          {runtimeFirstRunMaterializationSummary.percent ?? 'indeterminate'}%
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Local runtime asset id projection</span>
        <StatusBadge tone={localRuntimeAssetKindProjection.auxiliaryImportable ? 'success' : 'neutral'}>
          {localRuntimeAssetIdProjection.assetId} / {localRuntimeAssetIdProjection.lookupKey}
          {' / '}
          {localRuntimeAssetKindProjection.label}: {localRuntimeAssetKindProjection.runnableAssetKind}/{localRuntimeAssetKindProjection.dependencyAssetKind}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK local runtime facade projection</span>
        <StatusBadge tone={localRuntimeFacadeProjection.status === 'ready' ? 'success' : localRuntimeFacadeProjection.status === 'error' ? 'danger' : 'warning'}>
          {localRuntimeFacadeProjection.status === 'ready'
            ? localRuntimeFacadeProjection.assetId
            : localRuntimeFacadeProjection.status === 'error'
              ? localRuntimeFacadeProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK Realm data sync projection</span>
        <StatusBadge tone={realmDataSyncProjection.status === 'ready' ? 'success' : realmDataSyncProjection.status === 'error' ? 'danger' : 'warning'}>
          {realmDataSyncProjection.status === 'ready'
            ? realmDataSyncProjection.summary
            : realmDataSyncProjection.status === 'error'
              ? realmDataSyncProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime call options projection / Runtime config projection</span>
        <StatusBadge tone={runtimeTargetCallOptionsProjection.metadata.keySource === 'managed' ? 'success' : 'neutral'}>
          {runtimeTargetCallOptionsProjection.metadata.callerId}: {runtimeTargetCallOptionsProjection.metadata.traceId} / {runtimeConfigProjection.jwtIssuer}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime request metadata projection</span>
        <StatusBadge tone="neutral">
          {runtimeRequestMetadataProjection.keySource ?? 'direct'}: {runtimeRequestMetadataProjection.traceId}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime local AI reason projection</span>
        <StatusBadge tone={runtimeLocalAiReasonProjection === 'unknown' ? 'neutral' : 'warning'}>
          {runtimeLocalAiReasonProjection}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Memory embedding route projection</span>
        <StatusBadge tone={memoryEmbeddingRouteProjection.state === 'ready' ? 'success' : 'warning'}>
          {memoryEmbeddingRouteProjection.sourceKind ?? 'none'}: {memoryEmbeddingRouteProjection.reason}
          {' / '}
          {memoryEmbeddingRuntimeProjection.agentId}: {memoryEmbeddingRuntimeProjection.resolutionState}/{memoryEmbeddingRuntimeProjection.bindOutcome}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent memory projection</span>
        <StatusBadge tone={runtimeAgentMemoryProjection.mode === 'standard' ? 'success' : 'warning'}>
          {runtimeAgentMemoryProjection.mode}: {runtimeAgentMemoryProjection.embeddingProfileModelId ?? 'none'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Local route option projection</span>
        <StatusBadge tone={localRouteOptionProjection.selectable ? 'success' : 'warning'}>
          {localRouteOptionProjection.binding.source}: {localRouteOptionProjection.binding.localModelId}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime route binding match projection</span>
        <StatusBadge tone={runtimeRouteBindingMatchProjection ? 'success' : 'warning'}>
          {runtimeRouteBindingMatchProjection ? 'matched' : 'not matched'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime route model profile projection</span>
        <StatusBadge tone={runtimeRouteModelProfileProjection ? 'success' : 'warning'}>
          {runtimeRouteModelProfileProjection
            ? `${runtimeRouteModelProfileProjection.model}: ${runtimeRouteModelProfileProjection.maxOutputTokens ?? 'unknown'}`
            : 'unavailable'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime capability coverage projection</span>
        <StatusBadge tone={runtimeCapabilityCoverageProjection.cloudAvailable ? 'success' : 'warning'}>
          {runtimeCapabilityCoverageProjection.capability}: {runtimeCapabilityCoverageProjection.cloudAvailable ? 'cloud' : 'unavailable'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime route capability projection</span>
        <StatusBadge tone={runtimeCapabilityProjection.status === 'ready' && runtimeCapabilityProjection.summary.supported ? 'success' : runtimeCapabilityProjection.status === 'error' ? 'danger' : 'warning'}>
          {runtimeCapabilityProjection.status === 'ready'
            ? `${runtimeCapabilityProjection.summary.capability}: ${runtimeCapabilityProjection.summary.ready ? 'ready' : runtimeCapabilityProjection.summary.issueKind}/${runtimeCapabilityProjection.summary.setupStatus}/${runtimeCapabilityProjection.summary.reasonCode}`
            : runtimeCapabilityProjection.status === 'error'
              ? runtimeCapabilityProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime route reasoning projection</span>
        <StatusBadge tone={runtimeRouteReasoningProjection.supported ? 'success' : 'warning'}>
          {runtimeRouteReasoningProjection.reason}: {runtimeRouteReasoningProjection.traceMode}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime route provider health projection</span>
        <StatusBadge tone={runtimeProviderHealthProjection.status === 'ready' && runtimeProviderHealthProjection.health.status === 'healthy' ? 'success' : runtimeProviderHealthProjection.status === 'error' ? 'danger' : 'warning'}>
          {runtimeProviderHealthProjection.status === 'ready'
            ? `${runtimeProviderHealthProjection.health.model}: ${runtimeProviderHealthProjection.health.status}`
            : runtimeProviderHealthProjection.status === 'error'
              ? runtimeProviderHealthProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK runtime health summary projection</span>
        <StatusBadge tone={runtimeHealthSummaryProjection.normalizedStatus === 'healthy' ? 'success' : 'warning'}>
          {runtimeHealthSummaryProjection.normalizedStatus}: {runtimeHealthSummaryProjection.health.checkedAt}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK runtime health wire projection</span>
        <StatusBadge tone="neutral">
          {runtimeHealthWireProjection.statusName}: {runtimeHealthWireProjection.sampledAt}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK local runtime profile projection</span>
        <StatusBadge tone="neutral">
          {localRuntimeProfileProjection.profileCount}: {localRuntimeProfileProjection.runtimeEntryCount}/{localRuntimeProfileProjection.assetCount}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK local runtime execution plan projection</span>
        <StatusBadge tone="neutral">
          {localRuntimeExecutionPlanProjection.entries[0]?.kind ?? 'none'}: {localRuntimeExecutionPlanProjection.deviceProfile.arch}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK local runtime service/node projection</span>
        <StatusBadge tone={localRuntimeServiceNodeProjection.node.available ? 'success' : 'warning'}>
          {localRuntimeServiceNodeProjection.service.status}: {localRuntimeServiceNodeProjection.node.adapter}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK Nimi App bridge projection</span>
        <StatusBadge tone="neutral">
          {appBridgeProjection.registryRows[0]?.appId ?? 'none'}: {appBridgeProjection.installEvidence[0]?.verificationState ?? 'none'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK account app-library projection</span>
        <StatusBadge tone="neutral">
          {accountAppLibraryProjection.accountId}: {accountAppLibraryProjection.apps[0]?.libraryState ?? 'none'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK runtime audit wire projection</span>
        <StatusBadge tone="neutral">
          {runtimeAuditWireProjection.callerKindName}: {runtimeAuditWireProjection.usageWindowName}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK runtime health coordinator projection</span>
        <StatusBadge tone={runtimeHealthCoordinatorProjection.stale ? 'warning' : 'success'}>
          {runtimeHealthCoordinatorProjection.started ? 'started' : 'not started'} / {runtimeHealthCoordinatorProjection.stale ? 'stale' : 'fresh'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent consumer projection</span>
        <StatusBadge tone={runtimeAgentConsumerProjection.projectionScoped ? 'success' : 'warning'}>
          {runtimeAgentConsumerProjection.projectionEventName}
          {' / '}
          {runtimeAgentConsumerProjection.timelineChannel}
          {' / '}
          {runtimeAgentConsumerProjection.recoveryEventCount}
          {' / '}
          {runtimeAgentConsumerProjection.terminalEventName}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent inspect projection</span>
        <StatusBadge tone={runtimeAgentInspectProjection.lifecycleStatus === 'active' ? 'success' : 'warning'}>
          {runtimeAgentInspectProjection.presentationBackend}
          {' / '}
          {runtimeAgentInspectProjection.nextHookStatus ?? 'none'}
          {' / '}
          {runtimeAgentInspectProjection.eventSummary ?? 'none'}
          {' / '}
          {runtimeAgentInspectProjection.mutationKinds}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime external agent projection</span>
        <StatusBadge tone={externalAgentProjection.gateway.enabled ? 'success' : 'warning'}>
          {externalAgentProjection.issued.mode ?? 'none'}
          {' / '}
          {externalAgentProjection.token.tokenId}
          {' / '}
          {externalAgentProjection.gateway.actionCount}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent presentation profile projection</span>
        <StatusBadge tone={runtimeAgentPresentationProfileProjection.mutationKind === 'profile' ? 'success' : 'warning'}>
          {runtimeAgentPresentationProfileProjection.localAgentOwner}
          {' / '}
          {runtimeAgentPresentationProfileProjection.backendKind}
          {' / '}
          {runtimeAgentPresentationProfileProjection.defaultVoiceReference}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime struct codec projection</span>
        <StatusBadge tone={runtimeStructProjection.tagCount > 0 ? 'success' : 'warning'}>
          {runtimeStructProjection.surfaceId}: {runtimeStructProjection.auditKind} / {runtimeStructProjection.tagCount}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Model picker binding projection</span>
        <StatusBadge tone={modelConfigBindingProjection ? 'success' : 'warning'}>
          {modelConfigBindingProjection?.source ?? 'none'}: {modelConfigBindingProjection?.model ?? 'missing'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Kit model binding summary projection</span>
        <StatusBadge tone={modelConfigBindingSummaryProjection.detail ? 'success' : 'warning'}>
          {modelConfigBindingSummaryProjection.label}: {modelConfigBindingSummaryProjection.detail ?? 'none'}
        </StatusBadge>
      </div>
    </Surface>
  );
}
