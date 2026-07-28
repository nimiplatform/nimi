import { createIdleAppAttentionState } from '../app-shell/providers/app-attention-state.js';
import type { AppAttentionSource } from '../app-shell/providers/app-attention-source.js';
import { createAppStore } from '../app-shell/providers/app-store-factory.js';
import { createDesktopQueryClient } from '../infra/query-client/query-client.js';
import { createDesktopI18n, resolveSupportedLocale } from '../i18n/desktop-i18n.js';
import type { DesktopCanonicalRendererBindings } from './contract.js';
import { createDesktopRendererLifecyclePort } from './lifecycle-port.js';
import { createDesktopRouteProvider } from './route-provider.js';
import { createStreamController } from '../features/turns/stream-controller.js';
import { createScenarioJobController } from '../features/turns/scenario-job-controller.js';
import { createRealmSocialData } from '../features/social/data/realm-social-data.js';
import { createAgentConversationAnchorBindingStore } from '../app-shell/providers/agent-conversation-anchor-binding-storage.js';
import { createRuntimeConfigConnectorSdkService } from '../features/runtime-config/runtime-config-connector-sdk-service.js';
import { createAccountProfileLibraryResource } from '../features/runtime-config/runtime-config-profile-library.js';
import { createRealmGroupChatData } from '../features/chat/data/realm-group-chat-data.js';
import { createRealmHumanChatData } from '../features/chat/data/realm-human-chat-data.js';
import { createWorldFollowStore } from '../features/world/world-follow-store.js';
import { createAgentVisibleProjectionStore } from '../features/chat/chat-agent-visible-projection-store.js';
import { createChatUploadPlaceholderStore } from '../features/turns/chat-upload-placeholder-store.js';
import { createLocalModelCenterProgressCache } from '../features/runtime-config/runtime-config-local-model-center-progress-cache.js';

export function createDesktopRendererResources(
  bindings: DesktopCanonicalRendererBindings,
) {
  const initial = bindings.app.projection.initialState();
  const store = createAppStore({
    initialAIConfig: initial.aiConfig,
    commitAIConfig: bindings.app.commands.commitAIConfig,
    initialChatThinkingPreference: initial.chatThinkingPreference,
    persistChatThinkingPreference: bindings.app.commands.persistChatThinkingPreference,
    setActiveScopeForMode: bindings.app.commands.setActiveScopeForMode,
  });
  store.setState({
    bootstrapError: initial.bootstrapError,
    bootstrapReady: initial.bootstrapReady,
  });
  const queryClient = createDesktopQueryClient();
  const i18n = createDesktopI18n({
    initialLocale: resolveSupportedLocale(bindings.localization.language),
    development: initial.development,
    now: bindings.clock.now,
    syncDocument: bindings.app.commands.applyLocale,
  });
  let attentionSnapshot = bindings.app.projection.attention() ?? createIdleAppAttentionState();
  const attention: AppAttentionSource = Object.freeze({
    getSnapshot: () => attentionSnapshot,
    subscribe(listener: () => void) {
      return bindings.app.events.subscribeAttention(() => {
        attentionSnapshot = bindings.app.projection.attention() ?? createIdleAppAttentionState();
        listener();
      });
    },
  });
  const Router = createDesktopRouteProvider(bindings.route);
  const streamController = createStreamController(bindings.clock);
  const scenarioJobController = createScenarioJobController(bindings.clock);
  const anchorBindings = createAgentConversationAnchorBindingStore(bindings.clock.now);
  const agentVisibleProjections = createAgentVisibleProjectionStore();
  const chatUploadPlaceholders = createChatUploadPlaceholderStore(bindings.clock.now);
  const localModelCenterProgress = createLocalModelCenterProgressCache(
    bindings.app.commands.localModelProgress,
  );
  const runtimeConnectorSdk = createRuntimeConfigConnectorSdkService(bindings.sdk.connectorAdmin);
  const accountProfileLibrary = createAccountProfileLibraryResource(
    bindings.app.commands.profileLibrary,
  );
  const realmHumanChatData = createRealmHumanChatData(bindings.sdk);
  const worldFollowStore = createWorldFollowStore(bindings.app.commands.worldFollow);
  const realmGroupChatData = createRealmGroupChatData({ sdk: bindings.sdk });
  const realmSocialData = createRealmSocialData({
    callApi: bindings.sdk.socialData.callApi,
    emitDataError: bindings.sdk.socialData.emitDataError,
    now: bindings.clock.now,
    offline: bindings.sdk.socialData.offline,
  });
  const lifecycle = createDesktopRendererLifecyclePort(
    store,
    queryClient,
    (key, options) => String(i18n.instance.t(key, options)),
    anchorBindings,
  );
  const disconnectLifecycle = bindings.app.events.connectLifecycle(lifecycle);
  let disposed = false;

  return Object.freeze({
    accountProfileLibrary,
    agentVisibleProjections,
    anchorBindings,
    attention,
    chatUploadPlaceholders,
    i18n,
    localModelCenterProgress,
    queryClient,
    realmGroupChatData,
    realmHumanChatData,
    realmSocialData,
    runtimeConnectorSdk,
    Router,
    scenarioJobController,
    store,
    streamController,
    worldFollowStore,
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnectLifecycle();
      anchorBindings.dispose();
      agentVisibleProjections.dispose();
      chatUploadPlaceholders.dispose();
      localModelCenterProgress.clear();
      accountProfileLibrary.clear();
      runtimeConnectorSdk.clearCaches();
      scenarioJobController.dispose();
      streamController.dispose();
      queryClient.clear();
      realmSocialData.dispose();
      worldFollowStore.dispose();
      bindings.sdk.offline.dispose();
    },
  });
}
