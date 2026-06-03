import { useEffect, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  buildRuntimeRouteCapabilityProjection,
  checkRuntimeRouteProviderHealth,
  createDefaultRuntimeRouteCapabilitySelectionStore,
  getRuntimeRouteCapabilityProjectionIssueKind,
  isRuntimeRouteCapabilityProjectionReady,
  ModelHealthStatus,
  RuntimeReasonCode,
  updateRuntimeRouteCapabilityBinding,
} from '@nimiplatform/sdk/runtime';
import {
  listRealmGroupChats,
  loadRealmCreatorEligibility,
  loadRealmNotificationUnreadCount,
  loadRealmNotifications,
  requestDataExport,
  toRealmNotificationListProjection,
  uploadRealmResourceFileWithRealm,
} from '@nimiplatform/sdk/realm';
import { loadRealmCurrencyBalances, loadRealmGiftTransaction } from '@nimiplatform/kit/features/commerce/realm';
import { getNimiNotificationServerFilter } from '@nimiplatform/kit/core/notifications';
import { resolveConversationRuntimeRouteSetupStateFromProjection } from '@nimiplatform/kit/features/chat/headless';
import { listRealmChats } from '@nimiplatform/kit/features/chat/realm';
import { useTypedProjection } from '@nimiplatform/kit/ui';
import { loadTesterProductControlProjection } from '../../tester/tester-product-control-projection';
import { inspectTesterRuntimeAgentTurnRunnerProjection } from '../../tester/tester-runtime-agent-turn-runner';
import { inspectTesterRuntimeMediaGenerationRunnerProjection } from '../../tester/tester-runtime-media-generation-runner';
import { loadTesterWorldEvolutionSelectorReadProjection } from '../../tester/tester-world-evolution-selector-read';
import { loadTesterRealmSocialFeedProjection } from '../../tester/tester-realm-social-feed-projection';
import { loadTesterRealmAgentProfileProjection } from '../../tester/tester-realm-agent-profile-projection';
import { loadTesterRealmAuthProjection } from '../../tester/tester-realm-auth-projection';
import { loadTesterRealmLocalAgentIntentsProjection } from '../../tester/tester-realm-local-agent-intents-projection';
import { loadTesterRuntimeRouteHostAccessProjection } from '../../tester/tester-runtime-route-host-access';
import {
  errorMessage,
  resolveTesterLocalRuntimeFacadeProjection,
  resolveTesterPermissionClientProjection,
  resolveTesterRealmDataSyncProjection,
  runtimeConnectorInventory,
  runtimeModelCatalogProjection,
  testerGiftTransactionProjectionService,
  testerRouteCapabilityRuntime,
} from './settings/fixtures';
import { createTesterSettingsRealmKitProjections } from './settings/realm-kit-projections';
import { createTesterSettingsRuntimeProjections } from './settings/runtime-projections';
import type {
  AccountDataProjectionState,
  AccountSettingsProjectionState,
  CatalogProjectionState,
  ConnectorProjectionState,
  GiftTransactionProjectionState,
  GroupChatProjectionState,
  HumanChatProjectionState,
  NotificationListProjectionState,
  NotificationProjectionState,
  ResourceUploadProjectionState,
  RuntimeAgentTurnRunnerProjectionState,
  RuntimeCapabilityProjectionState,
  RuntimeMediaGenerationRunnerProjectionState,
  RuntimeProviderHealthProjectionState,
  RuntimeRouteHostAccessProjectionState,
  WalletProjectionState,
} from './settings/types';
import { SettingsRouteView } from './settings/view';

export function SettingsRoute() {
  const [localDrafts, setLocalDrafts] = useState(true);
  const [evidenceMode, setEvidenceMode] = useState(false);
  const [walletProjection, setWalletProjection] = useState<WalletProjectionState>({ status: 'idle', balances: null, error: null });
  const [giftTransactionProjection, setGiftTransactionProjection] = useState<GiftTransactionProjectionState>({ status: 'idle', gift: null, error: null });
  const [notificationProjection, setNotificationProjection] = useState<NotificationProjectionState>({ status: 'idle', unread: null, error: null });
  const [notificationListProjection, setNotificationListProjection] = useState<NotificationListProjectionState>({ status: 'idle', list: null, error: null });
  const [resourceUploadProjection, setResourceUploadProjection] = useState<ResourceUploadProjectionState>({ status: 'idle', summary: null, error: null });
  const [accountDataProjection, setAccountDataProjection] = useState<AccountDataProjectionState>({ status: 'idle', exportRequest: null, error: null });
  const [accountSettingsProjection, setAccountSettingsProjection] = useState<AccountSettingsProjectionState>({ status: 'idle', eligibility: null, error: null });
  const [humanChatProjection, setHumanChatProjection] = useState<HumanChatProjectionState>({ status: 'idle', chats: null, error: null });
  const [groupChatProjection, setGroupChatProjection] = useState<GroupChatProjectionState>({ status: 'idle', groups: null, error: null });
  const [connectorProjection, setConnectorProjection] = useState<ConnectorProjectionState>({ status: 'idle', connectors: [], error: null });
  const [catalogProjection, setCatalogProjection] = useState<CatalogProjectionState>({ status: 'idle', providers: [], error: null });
  const [runtimeCapabilityProjection, setRuntimeCapabilityProjection] = useState<RuntimeCapabilityProjectionState>({ status: 'loading', summary: null, error: null });
  const [runtimeProviderHealthProjection, setRuntimeProviderHealthProjection] = useState<RuntimeProviderHealthProjectionState>({ status: 'loading', health: null, error: null });
  const [runtimeRouteHostAccessProjection, setRuntimeRouteHostAccessProjection] = useState<RuntimeRouteHostAccessProjectionState>({ status: 'loading', projection: null, error: null });
  const [runtimeAgentTurnRunnerProjection, setRuntimeAgentTurnRunnerProjection] = useState<RuntimeAgentTurnRunnerProjectionState>({ status: 'loading', projection: null, error: null });
  const [runtimeMediaGenerationRunnerProjection, setRuntimeMediaGenerationRunnerProjection] = useState<RuntimeMediaGenerationRunnerProjectionState>({ status: 'loading', projection: null, error: null });

  const localRuntimeFacadeProjection = useTypedProjection(resolveTesterLocalRuntimeFacadeProjection, {
    failClosedMessage: 'SDK local runtime facade projection unavailable',
  });
  const permissionClientProjection = useTypedProjection(resolveTesterPermissionClientProjection, {
    failClosedMessage: 'SDK permission client projection unavailable',
  });
  const realmDataSyncProjection = useTypedProjection(resolveTesterRealmDataSyncProjection, {
    failClosedMessage: 'SDK Realm data sync projection unavailable',
  });
  const worldEvolutionSelectorReadProjection = useTypedProjection(loadTesterWorldEvolutionSelectorReadProjection, {
    failClosedMessage: 'SDK World Evolution selector-read projection unavailable',
  });
  const realmSocialFeedProjection = useTypedProjection(loadTesterRealmSocialFeedProjection, {
    failClosedMessage: 'SDK Realm social/feed projection unavailable',
  });
  const realmAgentProfileProjection = useTypedProjection(loadTesterRealmAgentProfileProjection, {
    failClosedMessage: 'SDK Realm agent profile projection unavailable',
  });
  const realmAuthProjection = useTypedProjection(loadTesterRealmAuthProjection, {
    failClosedMessage: 'SDK Realm auth projection unavailable',
  });
  const realmLocalAgentIntentsProjection = useTypedProjection(loadTesterRealmLocalAgentIntentsProjection, {
    failClosedMessage: 'SDK Realm local-agent intents projection unavailable',
  });
  const productControlProjection = useTypedProjection(loadTesterProductControlProjection, {
    failClosedMessage: 'SDK Runtime product-control projection unavailable',
  });

  useEffect(() => {
    let cancelled = false;
    setRuntimeAgentTurnRunnerProjection({ status: 'loading', projection: null, error: null });
    void inspectTesterRuntimeAgentTurnRunnerProjection().then((projection) => {
      if (!cancelled) setRuntimeAgentTurnRunnerProjection({ status: 'ready', projection, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setRuntimeAgentTurnRunnerProjection({ status: 'error', projection: null, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRuntimeMediaGenerationRunnerProjection({ status: 'loading', projection: null, error: null });
    void inspectTesterRuntimeMediaGenerationRunnerProjection().then((projection) => {
      if (!cancelled) setRuntimeMediaGenerationRunnerProjection({ status: 'ready', projection, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setRuntimeMediaGenerationRunnerProjection({ status: 'error', projection: null, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
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
      if (cancelled) return;
      setResourceUploadProjection({
        status: 'ready',
        summary: { resourceId: result.resourceId, status: String(result.resource.status || 'unknown') },
        error: null,
      });
    }).catch((error: unknown) => {
      if (!cancelled) setResourceUploadProjection({ status: 'error', summary: null, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
  }, []);

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
      if (cancelled) return;
      const setupState = resolveConversationRuntimeRouteSetupStateFromProjection({ mode: 'ai', projection });
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
      if (!cancelled) setRuntimeCapabilityProjection({ status: 'error', summary: null, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
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
      if (!cancelled) setRuntimeProviderHealthProjection({ status: 'ready', health, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setRuntimeProviderHealthProjection({ status: 'error', health: null, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTesterRuntimeRouteHostAccessProjection().then((projection) => {
      if (!cancelled) setRuntimeRouteHostAccessProjection({ status: 'ready', projection, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setRuntimeRouteHostAccessProjection({ status: 'error', projection: null, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
  }, []);

  const runtime = createTesterSettingsRuntimeProjections();
  const realmKit = createTesterSettingsRealmKitProjections();

  const refreshWalletProjection = async () => {
    setWalletProjection((current) => ({ status: 'loading', balances: current.balances, error: null }));
    try {
      const balances = await loadRealmCurrencyBalances();
      setWalletProjection({ status: 'ready', balances, error: null });
    } catch (error) {
      setWalletProjection({ status: 'error', balances: null, error: errorMessage(error) });
    }
  };

  const refreshGiftTransactionProjection = async () => {
    setGiftTransactionProjection((current) => ({ status: 'loading', gift: current.gift, error: null }));
    try {
      const gift = await loadRealmGiftTransaction('tester-gift-preview', testerGiftTransactionProjectionService);
      setGiftTransactionProjection({ status: 'ready', gift: { id: gift.id, giftStatus: gift.status }, error: null });
    } catch (error) {
      setGiftTransactionProjection({ status: 'error', gift: null, error: errorMessage(error) });
    }
  };

  const refreshNotificationProjection = async () => {
    setNotificationProjection((current) => ({ status: 'loading', unread: current.unread, error: null }));
    try {
      const unread = await loadRealmNotificationUnreadCount(getPlatformClient().realm);
      setNotificationProjection({ status: 'ready', unread, error: null });
    } catch (error) {
      setNotificationProjection({ status: 'error', unread: null, error: errorMessage(error) });
    }
  };

  const refreshNotificationListProjection = async () => {
    setNotificationListProjection((current) => ({ status: 'loading', list: current.list, error: null }));
    try {
      const list = await loadRealmNotifications(getPlatformClient().realm, {
        limit: 5,
        unreadOnly: false,
        type: getNimiNotificationServerFilter('system') ?? undefined,
      });
      setNotificationListProjection({
        status: 'ready',
        list: toRealmNotificationListProjection(list, 'Tester notification', 'Unknown actor'),
        error: null,
      });
    } catch (error) {
      setNotificationListProjection({ status: 'error', list: null, error: errorMessage(error) });
    }
  };

  const requestAccountDataExportProjection = async () => {
    setAccountDataProjection((current) => ({ status: 'loading', exportRequest: current.exportRequest, error: null }));
    try {
      const exportRequest = await requestDataExport(getPlatformClient().realm, {
        format: 'JSON',
        includeMedia: false,
        includeMessages: false,
        locale: 'en-US',
      });
      setAccountDataProjection({ status: 'ready', exportRequest, error: null });
    } catch (error) {
      setAccountDataProjection({ status: 'error', exportRequest: null, error: errorMessage(error) });
    }
  };

  const refreshAccountSettingsProjection = async () => {
    setAccountSettingsProjection((current) => ({ status: 'loading', eligibility: current.eligibility, error: null }));
    try {
      const eligibility = await loadRealmCreatorEligibility(getPlatformClient().realm);
      setAccountSettingsProjection({ status: 'ready', eligibility, error: null });
    } catch (error) {
      setAccountSettingsProjection({ status: 'error', eligibility: null, error: errorMessage(error) });
    }
  };

  const refreshHumanChatProjection = async () => {
    setHumanChatProjection((current) => ({ status: 'loading', chats: current.chats, error: null }));
    try {
      const chats = await listRealmChats(20);
      setHumanChatProjection({ status: 'ready', chats, error: null });
    } catch (error) {
      setHumanChatProjection({ status: 'error', chats: null, error: errorMessage(error) });
    }
  };

  const refreshGroupChatProjection = async () => {
    setGroupChatProjection((current) => ({ status: 'loading', groups: current.groups, error: null }));
    try {
      const groups = await listRealmGroupChats(getPlatformClient().realm, 20);
      setGroupChatProjection({ status: 'ready', groups, error: null });
    } catch (error) {
      setGroupChatProjection({ status: 'error', groups: null, error: errorMessage(error) });
    }
  };

  const refreshConnectorProjection = async () => {
    setConnectorProjection((current) => ({ status: 'loading', connectors: current.connectors, error: null }));
    try {
      const connectors = await runtimeConnectorInventory.listConnectors();
      setConnectorProjection({ status: 'ready', connectors, error: null });
    } catch (error) {
      setConnectorProjection((current) => ({ status: 'error', connectors: current.connectors, error: errorMessage(error) }));
    }
  };

  const refreshCatalogProjection = async () => {
    setCatalogProjection((current) => ({ status: 'loading', providers: current.providers, error: null }));
    try {
      const providers = await runtimeModelCatalogProjection.listProviders();
      setCatalogProjection({ status: 'ready', providers, error: null });
    } catch (error) {
      setCatalogProjection((current) => ({ status: 'error', providers: current.providers, error: errorMessage(error) }));
    }
  };

  return (
    <SettingsRouteView
      localDrafts={localDrafts}
      setLocalDrafts={setLocalDrafts}
      evidenceMode={evidenceMode}
      setEvidenceMode={setEvidenceMode}
      walletProjection={walletProjection}
      refreshWalletProjection={refreshWalletProjection}
      giftTransactionProjection={giftTransactionProjection}
      refreshGiftTransactionProjection={refreshGiftTransactionProjection}
      notificationProjection={notificationProjection}
      refreshNotificationProjection={refreshNotificationProjection}
      notificationListProjection={notificationListProjection}
      refreshNotificationListProjection={refreshNotificationListProjection}
      resourceUploadProjection={resourceUploadProjection}
      accountDataProjection={accountDataProjection}
      requestAccountDataExportProjection={requestAccountDataExportProjection}
      accountSettingsProjection={accountSettingsProjection}
      refreshAccountSettingsProjection={refreshAccountSettingsProjection}
      humanChatProjection={humanChatProjection}
      refreshHumanChatProjection={refreshHumanChatProjection}
      groupChatProjection={groupChatProjection}
      refreshGroupChatProjection={refreshGroupChatProjection}
      connectorProjection={connectorProjection}
      refreshConnectorProjection={refreshConnectorProjection}
      catalogProjection={catalogProjection}
      refreshCatalogProjection={refreshCatalogProjection}
      runtimeCapabilityProjection={runtimeCapabilityProjection}
      runtimeProviderHealthProjection={runtimeProviderHealthProjection}
      runtimeRouteHostAccessProjection={runtimeRouteHostAccessProjection}
      runtimeAgentTurnRunnerProjection={runtimeAgentTurnRunnerProjection}
      runtimeMediaGenerationRunnerProjection={runtimeMediaGenerationRunnerProjection}
      localRuntimeFacadeProjection={localRuntimeFacadeProjection}
      permissionClientProjection={permissionClientProjection}
      realmDataSyncProjection={realmDataSyncProjection}
      worldEvolutionSelectorReadProjection={worldEvolutionSelectorReadProjection}
      realmSocialFeedProjection={realmSocialFeedProjection}
      realmAgentProfileProjection={realmAgentProfileProjection}
      realmAuthProjection={realmAuthProjection}
      realmLocalAgentIntentsProjection={realmLocalAgentIntentsProjection}
      productControlProjection={productControlProjection}
      realmKit={realmKit}
      runtime={runtime}
    />
  );
}
