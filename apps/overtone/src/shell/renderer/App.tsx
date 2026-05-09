import React, { useEffect } from 'react';
import { AppProviders } from '@renderer/app-shell/providers/app-providers.js';
import { AppRoutes } from '@renderer/app-shell/routes/app-routes.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { OvertoneLogin } from '@renderer/features/auth/overtone-login.js';
import { runOvertoneBootstrap } from '@renderer/infra/bootstrap/overtone-bootstrap.js';

function AuthGate({ children }: { children: React.ReactNode }) {
  const authStatus = useAppStore((s) => s.authStatus);

  useEffect(() => {
    if (authStatus !== 'bootstrapping') return;
    void runOvertoneBootstrap();
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
