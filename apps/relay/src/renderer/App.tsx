// Root component — provider shell + routing

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './infra/query-client.js';
import { bootstrap, type BootstrapResult } from './infra/bootstrap.js';
import { MainLayout } from './app-shell/layout/main-layout.js';
import { ChatPage } from './features/chat/chat-page.js';
import { useSettingsStore } from './app-shell/providers/settings-store.js';

export function App() {
  const { t, ready: i18nReady } = useTranslation();
  const [ready, setReady] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState<BootstrapResult | null>(null);

  useEffect(() => {
    bootstrap().then((result) => {
      setBootstrapResult(result);
      setReady(true);
      // Load product settings after bootstrap
      useSettingsStore.getState().load();
    });
  }, []);

  if (!ready || !i18nReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        <div className="text-center">
          <div className="text-lg font-semibold mb-2">{t('app.name')}</div>
          <div className="text-sm text-gray-400">{t('app.connecting')}</div>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <MainLayout>
        <ChatPage />
      </MainLayout>
    </QueryClientProvider>
  );
}
