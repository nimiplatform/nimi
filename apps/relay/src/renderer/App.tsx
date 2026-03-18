// Root component — provider shell + routing
// RL-BOOT-005 — Auth state display

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './infra/query-client.js';
import { bootstrap, type BootstrapResult } from './infra/bootstrap.js';
import { MainLayout } from './app-shell/layout/main-layout.js';
import { ChatPage } from './features/chat/chat-page.js';
import { useSettingsStore } from './app-shell/providers/settings-store.js';
import { useAppStore, type AuthState } from './app-shell/providers/app-store.js';
import { getBridge } from './bridge/electron-bridge.js';
import { AuthLoginPage } from './features/auth/auth-login-page.js';

export function App() {
  const { t, ready: i18nReady } = useTranslation();
  const authState = useAppStore((s) => s.authState);
  const [ready, setReady] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState<BootstrapResult | null>(null);

  useEffect(() => {
    // Listen for auth state changes from main process
    try {
      const bridge = getBridge();
      const listenerId = bridge.auth.onStatus((data: unknown) => {
        const payload = data as { state: AuthState; error: string | null };
        useAppStore.getState().setAuthState(payload.state, payload.error);
      });

      // Query initial auth state
      bridge.auth.getStatus().then((status) => {
        useAppStore.getState().setAuthState(status.state as AuthState, status.error);
      });

      return () => bridge.auth.removeListener(listenerId);
    } catch {
      // Bridge not available yet — auth state will come via bootstrap
    }
  }, []);

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

  if (authState !== 'authenticated') {
    return <AuthLoginPage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <MainLayout>
        <ChatPage />
      </MainLayout>
    </QueryClientProvider>
  );
}
