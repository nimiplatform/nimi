import type { PropsWithChildren } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import { AppStoreProvider } from './app-store.js';
import type { AppStoreApi } from './app-store-factory.js';
import { AppAttentionProvider } from './app-attention-context';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { DesktopI18nResourceProvider } from '../../i18n/i18n-context.js';
import type { DesktopRendererRouter } from './renderer-router.js';
import type { AppAttentionSource } from './app-attention-source.js';
import type { StreamController } from '../../features/turns/stream-controller.js';
import { StreamControllerProvider } from '../../features/turns/stream-controller-context.js';
import type { ScenarioJobController } from '../../features/turns/scenario-job-controller.js';
import { ScenarioJobControllerProvider } from '../../features/turns/scenario-job-controller-context.js';
import type { RealmSocialData } from '../../features/social/data/realm-social-data.js';
import { RealmSocialDataProvider } from '../../features/social/data/realm-social-data-context.js';
import type { AgentConversationAnchorBindingStore } from './agent-conversation-anchor-binding-storage.js';
import { AgentConversationAnchorBindingProvider } from './agent-conversation-anchor-binding-context.js';
import type { RuntimeConfigConnectorSdkService } from '../../features/runtime-config/runtime-config-connector-sdk-service.js';
import { RuntimeConfigConnectorSdkProvider } from '../../features/runtime-config/runtime-config-connector-sdk-context.js';
import type { AccountProfileLibraryResource } from '../../features/runtime-config/runtime-config-profile-library.js';
import { AccountProfileLibraryProvider } from '../../features/runtime-config/runtime-config-profile-library-context.js';
import type { RealmGroupChatData } from '../../features/chat/data/realm-group-chat-data.js';
import { RealmGroupChatDataProvider } from '../../features/chat/data/realm-group-chat-data-context.js';
import type { RealmHumanChatData } from '../../features/chat/data/realm-human-chat-data.js';
import { RealmHumanChatDataProvider } from '../../features/chat/data/realm-human-chat-data-context.js';
import type { WorldFollowStore } from '../../features/world/world-follow-store.js';
import { WorldFollowStoreProvider } from '../../features/world/world-follow-store-context.js';
import type { AgentVisibleProjectionStore } from '../../features/chat/chat-agent-visible-projection-store.js';
import { AgentVisibleProjectionProvider } from '../../features/chat/chat-agent-visible-projection-context.js';
import type { ChatUploadPlaceholderStore } from '../../features/turns/chat-upload-placeholder-store.js';
import { ChatUploadPlaceholderProvider } from '../../features/turns/chat-upload-placeholder-context.js';
import type { LocalModelCenterProgressCache } from '../../features/runtime-config/runtime-config-local-model-center-progress-cache.js';
import { LocalModelCenterProgressProvider } from '../../features/runtime-config/runtime-config-local-model-center-progress-context.js';

export function AppProviders({ accountProfileLibrary, agentVisibleProjections, anchorBindings, attention, chatUploadPlaceholders, children, i18n, localModelCenterProgress, queryClient, realmGroupChatData, realmHumanChatData, realmSocialData, runtimeConnectorSdk, Router, scenarioJobController, store, streamController, worldFollowStore }: PropsWithChildren<{
  readonly accountProfileLibrary: AccountProfileLibraryResource;
  readonly agentVisibleProjections: AgentVisibleProjectionStore;
  readonly anchorBindings: AgentConversationAnchorBindingStore;
  readonly attention: AppAttentionSource;
  readonly chatUploadPlaceholders: ChatUploadPlaceholderStore;
  readonly i18n: DesktopI18nResource;
  readonly localModelCenterProgress: LocalModelCenterProgressCache;
  readonly queryClient: QueryClient;
  readonly realmGroupChatData: RealmGroupChatData;
  readonly realmHumanChatData: RealmHumanChatData;
  readonly realmSocialData: RealmSocialData;
  readonly runtimeConnectorSdk: RuntimeConfigConnectorSdkService;
  readonly Router: DesktopRendererRouter;
  readonly scenarioJobController: ScenarioJobController;
  readonly store: AppStoreApi;
  readonly streamController: StreamController;
  readonly worldFollowStore: WorldFollowStore;
}>) {
  return (
    <I18nextProvider i18n={i18n.instance}>
      <DesktopI18nResourceProvider resource={i18n}>
        <AppStoreProvider store={store}>
          <QueryClientProvider client={queryClient}>
            <RealmSocialDataProvider resource={realmSocialData}>
              <RealmGroupChatDataProvider resource={realmGroupChatData}>
              <RealmHumanChatDataProvider resource={realmHumanChatData}>
              <RuntimeConfigConnectorSdkProvider service={runtimeConnectorSdk}>
              <AccountProfileLibraryProvider resource={accountProfileLibrary}>
              <AgentConversationAnchorBindingProvider store={anchorBindings}>
              <AgentVisibleProjectionProvider store={agentVisibleProjections}>
              <ChatUploadPlaceholderProvider store={chatUploadPlaceholders}>
              <LocalModelCenterProgressProvider cache={localModelCenterProgress}>
              <ScenarioJobControllerProvider controller={scenarioJobController}>
                <StreamControllerProvider controller={streamController}>
                  <WorldFollowStoreProvider store={worldFollowStore}>
                  <TooltipProvider>
                    <AppAttentionProvider source={attention}>
                      <Router>{children}</Router>
                    </AppAttentionProvider>
                  </TooltipProvider>
                  </WorldFollowStoreProvider>
                </StreamControllerProvider>
              </ScenarioJobControllerProvider>
              </LocalModelCenterProgressProvider>
              </ChatUploadPlaceholderProvider>
              </AgentVisibleProjectionProvider>
              </AgentConversationAnchorBindingProvider>
              </AccountProfileLibraryProvider>
              </RuntimeConfigConnectorSdkProvider>
              </RealmHumanChatDataProvider>
              </RealmGroupChatDataProvider>
            </RealmSocialDataProvider>
          </QueryClientProvider>
        </AppStoreProvider>
      </DesktopI18nResourceProvider>
    </I18nextProvider>
  );
}
