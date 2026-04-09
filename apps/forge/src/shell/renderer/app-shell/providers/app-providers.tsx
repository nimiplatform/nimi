import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import { queryClient } from '@renderer/infra/query-client.js';
import { i18n } from '@renderer/i18n/index.js';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
