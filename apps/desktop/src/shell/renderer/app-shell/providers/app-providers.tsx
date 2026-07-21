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

export function AppProviders({ attention, children, i18n, queryClient, Router, store, streamController }: PropsWithChildren<{
  readonly attention: AppAttentionSource;
  readonly i18n: DesktopI18nResource;
  readonly queryClient: QueryClient;
  readonly Router: DesktopRendererRouter;
  readonly store: AppStoreApi;
  readonly streamController: StreamController;
}>) {
  return (
    <I18nextProvider i18n={i18n.instance}>
      <DesktopI18nResourceProvider resource={i18n}>
        <AppStoreProvider store={store}>
          <QueryClientProvider client={queryClient}>
            <StreamControllerProvider controller={streamController}>
              <TooltipProvider>
                <AppAttentionProvider source={attention}>
                  <Router>{children}</Router>
                </AppAttentionProvider>
              </TooltipProvider>
            </StreamControllerProvider>
          </QueryClientProvider>
        </AppStoreProvider>
      </DesktopI18nResourceProvider>
    </I18nextProvider>
  );
}
