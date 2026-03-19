import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './app-store.js';
import { runForgeBootstrap } from '@renderer/infra/bootstrap/forge-bootstrap.js';
import { getPlatformClient } from '@runtime/platform-client.js';
import { ForgeLoginPage } from '@renderer/features/auth/forge-login-page.js';

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
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">{t('bootstrap.error', { message: bootstrapError })}</p>
        </div>
      </div>
    );
  }

  if (!bootstrapReady || authStatus === 'bootstrapping') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-neutral-400">{t('bootstrap.loading')}</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <ForgeLoginPage />;
  }

  return <>{children}</>;
}
