import React, { useEffect } from 'react';
import { AppProviders } from '@renderer/app-shell/providers/app-providers.js';
import { AppRoutes } from '@renderer/app-shell/routes/app-routes.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { OvertoneLogin } from '@renderer/features/auth/overtone-login.js';
import { initRealmInstance, clearRealmInstance } from '@renderer/bridge/realm-sdk.js';

function AuthGate({ children }: { children: React.ReactNode }) {
  const authStatus = useAppStore((s) => s.authStatus);

  useEffect(() => {
    // Bootstrap: check if env provides a valid token
    if (authStatus !== 'bootstrapping') return;

    const baseUrl = String(import.meta.env.VITE_NIMI_REALM_BASE_URL || '').trim();
    const envToken = String(import.meta.env.VITE_NIMI_REALM_ACCESS_TOKEN || '').trim();

    if (!baseUrl || !envToken) {
      // No env credentials — require OAuth login
      useAppStore.getState().clearAuthSession();
      return;
    }

    // Try to validate the env token
    const realm = initRealmInstance(baseUrl, envToken);
    void realm.ready({ timeoutMs: 5_000 }).then(
      () => {
        useAppStore.getState().setAuthSession(
          { id: 'env', displayName: 'Environment User' },
          envToken,
          '',
        );
        useAppStore.getState().setRealmConnection(true, true);
      },
      () => {
        // Token invalid or realm unreachable — require OAuth
        clearRealmInstance();
        useAppStore.getState().clearAuthSession();
      },
    );
  }, [authStatus]);

  if (authStatus === 'bootstrapping') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-neutral-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <OvertoneLogin />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AppProviders>
      <AuthGate>
        <AppRoutes />
      </AuthGate>
    </AppProviders>
  );
}
