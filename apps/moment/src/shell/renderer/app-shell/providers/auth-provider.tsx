import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore } from './app-store.js';
import { runMomentBootstrap } from '@renderer/infra/bootstrap/moment-bootstrap.js';
import { MomentLoginPage } from '@renderer/features/auth/moment-login-page.js';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);

  useEffect(() => {
    void runMomentBootstrap();
  }, []);

  useEffect(() => {
    if (authStatus !== 'unauthenticated') {
      return;
    }
    try {
      getPlatformClient().realm.clearAuth();
    } catch {
      // Platform client may not be ready yet.
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
    return <MomentLoginPage />;
  }

  return <>{children}</>;
}
