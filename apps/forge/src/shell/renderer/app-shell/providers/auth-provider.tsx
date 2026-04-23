import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './app-store.js';
import { runForgeBootstrap } from '@renderer/infra/bootstrap/forge-bootstrap.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { ForgeLoginPage } from '@renderer/features/auth/forge-login-page.js';
import { ForgeFullscreenState } from '@renderer/components/page-layout.js';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authStatus = useAppStore((s) => s.auth.status);
  const bootstrapReady = useAppStore((s) => s.bootstrapReady);
  const bootstrapError = useAppStore((s) => s.bootstrapError);

  useEffect(() => {
    void runForgeBootstrap();
  }, []);

  useEffect(() => {
    if (authStatus !== 'unauthenticated') {
      return;
    }
    try {
      getPlatformClient().realm.clearAuth();
    } catch {
      // Platform client may not be ready yet
    }
  }, [authStatus]);

  if (bootstrapError) {
    return (
      <ForgeFullscreenState
        title="Forge bootstrap failed"
        message={t('bootstrap.error', { message: bootstrapError })}
      />
    );
  }

  if (!bootstrapReady || authStatus === 'bootstrapping') {
    return (
      <ForgeFullscreenState
        title="Starting Forge"
        message={t('bootstrap.loading')}
        loading
      />
    );
  }

  if (authStatus === 'unauthenticated') {
    return <ForgeLoginPage />;
  }

  return <>{children}</>;
}
