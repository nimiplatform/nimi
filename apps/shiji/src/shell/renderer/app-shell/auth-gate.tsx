import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './app-store.js';
import { runShiJiBootstrap } from './bootstrap.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { ShiJiLoginPage } from '@renderer/features/auth/shiji-login-page.js';
import { useProfiles } from '@renderer/hooks/index.js';

/** Triggers profile load via useEffect as soon as auth user is available. */
function ProfileLoader({ children }: { children: React.ReactNode }) {
  useProfiles();
  return <>{children}</>;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authStatus = useAppStore((s) => s.auth.status);
  const bootstrapReady = useAppStore((s) => s.bootstrapReady);
  const bootstrapError = useAppStore((s) => s.bootstrapError);

  useEffect(() => {
    void runShiJiBootstrap();
  }, []);

  useEffect(() => {
    if (authStatus !== 'unauthenticated') {
      return;
    }
    try {
      getPlatformClient().realm.clearAuth();
    } catch {
      // Platform client may not be ready yet during bootstrap
    }
  }, [authStatus]);

  if (bootstrapError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white">
        <div className="text-center space-y-4 max-w-sm px-6">
          <p className="text-red-500 text-base">{t('bootstrap.error', { message: bootstrapError })}</p>
        </div>
      </div>
    );
  }

  if (!bootstrapReady || authStatus === 'bootstrapping') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-amber-50">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin mx-auto" />
          <p className="text-amber-700 text-base">{t('bootstrap.loading')}</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <ShiJiLoginPage />;
  }

  return <ProfileLoader>{children}</ProfileLoader>;
}
