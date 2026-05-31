import { useEffect, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createEmptyMemoryEmbeddingConfig,
  isRuntimeRouteLocalOptionSelectable,
  projectRuntimeRouteCapabilityCoverage,
  projectMemoryEmbeddingRouteAvailability,
  resolveRuntimeRouteReasoningConfig,
  resolveRuntimeTextRouteReasoningSupport,
  runtimeRouteLocalOptionToBinding,
  type RuntimeResolvedBinding,
  type RuntimeRouteDescribeResult,
} from '@nimiplatform/sdk/ai';
import { pickerSelectionToBinding } from '@nimiplatform/kit/features/model-config';
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
  matchesRuntimeAgentProjectionScope,
  normalizeLocalRecommendationFeedCacheStateId,
  parseLocalRuntimeEnvironmentDependencyJobProjection,
  parseLocalRuntimeEnvironmentPlanProjection,
  projectRuntimeLocalAgentIdentity,
  parseRuntimeLocalRecommendationFeedDescriptor,
  parseLocalRecommendationFeedSourceId,
  extractRuntimeReasonCodeFromError,
  ModelCatalogProviderSource,
  normalizeRuntimeReasonCode,
  RuntimeHealthCoordinator,
  summarizeLocalRecommendationFeedCacheState,
  summarizeRuntimeAgentProjectionEvent,
  summarizeRuntimeAgentTimeline,
  toProtoStruct,
  type RuntimeConnectorProjection,
  type RuntimeAgentConsumeEvent,
  type RuntimeModelCatalogConnectorClient,
  type RuntimeModelCatalogProvider,
} from '@nimiplatform/sdk/runtime';
import { classifyOfflineError, classifyOfflineReasonCode, ReasonCode } from '@nimiplatform/sdk/types';
import {
  loadRealmNotificationUnreadCount,
  loadRealmNotifications,
  projectRealmBaseUrl,
  projectRealmRealtimeUrl,
  requestDataExport,
  resolveRealmMediaUrl,
  uploadRealmResourceFile,
  type RequestDataExportOutput,
  type RealmNotificationListResultDto,
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
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
} from '@nimiplatform/kit/features/chat/realm';
import { Button, ProgressIndicator, StatusBadge, Surface, Toggle } from '@nimiplatform/kit/ui';

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
  | { status: 'loading'; list: RealmNotificationListResultDto | null; error: null }
  | { status: 'ready'; list: RealmNotificationListResultDto; error: null }
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
  listGiftCatalog: async () => testerGiftCatalogProjection,
  sendGift: async () => {},
  listReceivedGifts: async () => testerEmptyGiftFeedProjection,
  listSentGifts: async () => testerSentGiftFeedProjection,
  acceptGift: async () => {},
  rejectGift: async () => {},
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
  useEffect(() => {
    let cancelled = false;
    setResourceUploadProjection({ status: 'loading', summary: null, error: null });
    void uploadRealmResourceFile({
      kind: 'image',
      file: new Blob(['tester-settings-resource-upload'], { type: 'image/png' }),
      client: {
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
        async finalizeResource(resourceId) {
          return {
            id: resourceId,
            status: 'READY',
            type: 'IMAGE',
            url: 'https://media.nimi.test/resources/tester-resource-upload',
          } as never;
        },
      },
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
    errorOwner: classifyOfflineError({
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'retry_realm_request',
      retryable: true,
    }) ?? 'unknown',
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
  const memoryEmbeddingRouteProjection = projectMemoryEmbeddingRouteAvailability({
    config: {
      ...createEmptyMemoryEmbeddingConfig({
        kind: 'feature',
        ownerId: 'tester',
        surfaceId: 'settings-memory-embedding',
      }),
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'cloud',
        connectorId: 'tester-cloud',
        modelId: 'tester-embedding',
      },
    },
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
        list,
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
        <span>Realm endpoint projection</span>
        <StatusBadge tone="neutral">{realmEndpointProjection}</StatusBadge>
      </div>
      <div className="setting-row">
        <span>Realm realtime projection</span>
        <StatusBadge tone="neutral">{realmRealtimeProjection}</StatusBadge>
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
          {recommendationFeedProjection.source} / {recommendationFeedProjection.cacheState} / {recommendationFeedProjection.grade}
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
          {runtimeLocalAgentIdentityProjection.localAgentRef}
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
        <span>Memory embedding route projection</span>
        <StatusBadge tone={memoryEmbeddingRouteProjection.state === 'ready' ? 'success' : 'warning'}>
          {memoryEmbeddingRouteProjection.sourceKind ?? 'none'}: {memoryEmbeddingRouteProjection.reason}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Local route option projection</span>
        <StatusBadge tone={localRouteOptionProjection.selectable ? 'success' : 'warning'}>
          {localRouteOptionProjection.binding.source}: {localRouteOptionProjection.binding.localModelId}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime capability coverage projection</span>
        <StatusBadge tone={runtimeCapabilityCoverageProjection.cloudAvailable ? 'success' : 'warning'}>
          {runtimeCapabilityCoverageProjection.capability}: {runtimeCapabilityCoverageProjection.cloudAvailable ? 'cloud' : 'unavailable'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime route reasoning projection</span>
        <StatusBadge tone={runtimeRouteReasoningProjection.supported ? 'success' : 'warning'}>
          {runtimeRouteReasoningProjection.reason}: {runtimeRouteReasoningProjection.traceMode}
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
    </Surface>
  );
}
