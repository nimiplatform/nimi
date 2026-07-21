import type { PropsWithChildren } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import { AppStoreProvider } from './app-store.js';
import type { AppStoreApi } from './app-store-factory.js';
import { AppAttentionProvider } from './app-attention-context';
import type { DesktopI18nResource } from '@renderer/i18n';
import type { DesktopRendererRouter } from './renderer-router.js';
import type { AppAttentionSource } from './app-attention-source.js';

export function AppProviders({ attention, children, i18n, queryClient, Router, store }: PropsWithChildren<{
  readonly attention: AppAttentionSource;
  readonly i18n: DesktopI18nResource;
  readonly queryClient: QueryClient;
  readonly Router: DesktopRendererRouter;
  readonly store: AppStoreApi;
}>) {
  return (
    <I18nextProvider i18n={i18n.instance}>
      <AppStoreProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AppAttentionProvider source={attention}>
              <Router>{children}</Router>
            </AppAttentionProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </AppStoreProvider>
    </I18nextProvider>
  );
}
