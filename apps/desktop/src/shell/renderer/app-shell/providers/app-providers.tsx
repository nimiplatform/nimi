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
import type { RealmSocialData } from '../../features/social/data/realm-social-data.js';
import { RealmSocialDataProvider } from '../../features/social/data/realm-social-data-context.js';
import type { RuntimeConfigConnectorSdkService } from '../../features/runtime-config/runtime-config-connector-sdk-service.js';
import { RuntimeConfigConnectorSdkProvider } from '../../features/runtime-config/runtime-config-connector-sdk-context.js';
import type { RealmHumanChatData } from '../../features/chat/data/realm-human-chat-data.js';
import { RealmHumanChatDataProvider } from '../../features/chat/data/realm-human-chat-data-context.js';
import type { WorldFollowStore } from '../../features/world/world-follow-store.js';
import { WorldFollowStoreProvider } from '../../features/world/world-follow-store-context.js';
import type { ChatUploadPlaceholderStore } from '../../features/turns/chat-upload-placeholder-store.js';
import { ChatUploadPlaceholderProvider } from '../../features/turns/chat-upload-placeholder-context.js';
import type { LocalModelCenterProgressCache } from '../../features/runtime-config/runtime-config-local-model-center-progress-cache.js';
import { LocalModelCenterProgressProvider } from '../../features/runtime-config/runtime-config-local-model-center-progress-context.js';

export function AppProviders({ attention, chatUploadPlaceholders, children, i18n, localModelCenterProgress, queryClient, realmHumanChatData, realmSocialData, runtimeConnectorSdk, Router, store, worldFollowStore }: PropsWithChildren<{
  readonly attention: AppAttentionSource;
  readonly chatUploadPlaceholders: ChatUploadPlaceholderStore;
  readonly i18n: DesktopI18nResource;
  readonly localModelCenterProgress: LocalModelCenterProgressCache;
  readonly queryClient: QueryClient;
  readonly realmHumanChatData: RealmHumanChatData;
  readonly realmSocialData: RealmSocialData;
  readonly runtimeConnectorSdk: RuntimeConfigConnectorSdkService;
  readonly Router: DesktopRendererRouter;
  readonly store: AppStoreApi;
  readonly worldFollowStore: WorldFollowStore;
}>) {
  return (
    <I18nextProvider i18n={i18n.instance}>
      <DesktopI18nResourceProvider resource={i18n}>
        <AppStoreProvider store={store}>
          <QueryClientProvider client={queryClient}>
            <RealmSocialDataProvider resource={realmSocialData}>
              <RealmHumanChatDataProvider resource={realmHumanChatData}>
                <RuntimeConfigConnectorSdkProvider service={runtimeConnectorSdk}>
                  <ChatUploadPlaceholderProvider store={chatUploadPlaceholders}>
                    <LocalModelCenterProgressProvider cache={localModelCenterProgress}>
                      <WorldFollowStoreProvider store={worldFollowStore}>
                        <TooltipProvider>
                          <AppAttentionProvider source={attention}>
                            <Router>{children}</Router>
                          </AppAttentionProvider>
                        </TooltipProvider>
                      </WorldFollowStoreProvider>
                    </LocalModelCenterProgressProvider>
                  </ChatUploadPlaceholderProvider>
                </RuntimeConfigConnectorSdkProvider>
              </RealmHumanChatDataProvider>
            </RealmSocialDataProvider>
          </QueryClientProvider>
        </AppStoreProvider>
      </DesktopI18nResourceProvider>
    </I18nextProvider>
  );
}
