// Root component — provider shell + routing
// RL-BOOT-005 — Auth state display

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './infra/query-client.js';
import { bootstrap, syncAuthenticatedRendererState } from './infra/bootstrap.js';
import { MainLayout } from './app-shell/layout/main-layout.js';
import { ChatPage } from './features/chat/chat-page.js';
import { useSettingsStore } from './app-shell/providers/settings-store.js';
import { useAppStore } from './app-shell/providers/app-store.js';
import { getBridge } from './bridge/electron-bridge.js';
import { AuthLoginPage } from './features/auth/auth-login-page.js';

export function App() {
  const { t } = useTranslation();
  const authState = useAppStore((s) => s.authState);
  const [ready, setReady] = useState(false);
  const [authSessionReady, setAuthSessionReady] = useState(false);

  useEffect(() => {
    // Listen for auth state changes from main process
    try {
      const bridge = getBridge();
      const listenerId = bridge.auth.onStatus((payload) => {
        useAppStore.getState().setAuthState(payload.state, payload.error);
      });

      // Query initial auth state
      bridge.auth.getStatus().then((status) => {
        useAppStore.getState().setAuthState(status.state, status.error);
      });

      return () => bridge.auth.removeListener(listenerId);
    } catch {
      // Bridge not available yet — auth state will come via bootstrap
    }
  }, []);

  useEffect(() => {
    bootstrap().then(() => {
      setReady(true);
      // Load product settings after bootstrap
      useSettingsStore.getState().load();
    });
  }, []);

  useEffect(() => {
    if (authState !== 'authenticated') {
      setAuthSessionReady(false);
      return;
    }

    let cancelled = false;
    setAuthSessionReady(false);

    syncAuthenticatedRendererState()
      .catch(() => {
        // Renderer should still render even if post-auth sync partially fails.
      })
      .finally(() => {
        if (!cancelled) {
          setAuthSessionReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authState]);

  if (authState !== 'authenticated') {
    return <AuthLoginPage />;
  }

  if (!ready || !authSessionReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-base text-text-primary">
        <div className="text-center">
          <div className="text-[17px] font-semibold mb-2">{t('app.name')}</div>
          <div className="text-[13px] text-text-secondary">{t('app.connecting')}</div>
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
