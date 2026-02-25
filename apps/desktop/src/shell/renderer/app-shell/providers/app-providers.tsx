import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { i18n } from '@renderer/i18n';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <HashRouter>{children}</HashRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
