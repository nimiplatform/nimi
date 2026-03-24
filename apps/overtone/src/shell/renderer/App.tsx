import React, { useEffect } from 'react';
import { AppProviders } from '@renderer/app-shell/providers/app-providers.js';
import { AppRoutes } from '@renderer/app-shell/routes/app-routes.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { OvertoneLogin } from '@renderer/features/auth/overtone-login.js';
import {
  clearOvertonePlatformClient,
  getOvertoneRealmBaseUrl,
  resolveOvertoneCurrentUser,
} from '@renderer/features/auth/overtone-auth-adapter.js';

function AuthGate({ children }: { children: React.ReactNode }) {
  const authStatus = useAppStore((s) => s.authStatus);

  useEffect(() => {
    if (authStatus !== 'bootstrapping') return;

    const envToken = String(import.meta.env.VITE_NIMI_REALM_ACCESS_TOKEN || '').trim();
    let baseUrl = '';

    try {
      baseUrl = getOvertoneRealmBaseUrl();
    } catch {
      baseUrl = '';
    }

    if (!baseUrl || !envToken) {
      useAppStore.getState().clearAuthSession();
      useAppStore.getState().setRealmConnection(Boolean(baseUrl), false);
      return;
    }

    void resolveOvertoneCurrentUser(envToken).then(
      (user) => {
        if (!user) {
          throw new Error('Failed to resolve env-backed Overtone user');
        }
        useAppStore.getState().setAuthSession(
          {
            id: user.id,
            displayName: user.displayName,
          },
          envToken,
          '',
        );
        useAppStore.getState().setRealmConnection(true, true);
      },
      () => {
        clearOvertonePlatformClient();
        useAppStore.getState().clearAuthSession();
        useAppStore.getState().setRealmConnection(true, false);
      },
    );
  }, [authStatus]);

  if (authStatus === 'bootstrapping') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--nimi-app-background)]">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)] border-t-[var(--nimi-action-primary-bg)] rounded-full animate-spin mx-auto" />
          <p className="text-[var(--nimi-text-secondary)] text-sm">Loading...</p>
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
