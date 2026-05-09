import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { AppProviders } from '@renderer/app-shell/app-providers.js';
import { AppRoutes } from '@renderer/app-shell/app-routes.js';
import { runDriftBootstrap } from '@renderer/infra/bootstrap/drift-bootstrap.js';
import { DriftLoginPage } from '@renderer/features/auth/drift-login-page.js';

function DriftAuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authStatus = useAppStore((s) => s.auth.status);
  const bootstrapReady = useAppStore((s) => s.bootstrapReady);
  const bootstrapError = useAppStore((s) => s.bootstrapError);

  useEffect(() => {
    void runDriftBootstrap();
  }, []);

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
    return <DriftLoginPage />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <AppProviders>
      <DriftAuthGate>
        <AppRoutes />
      </DriftAuthGate>
    </AppProviders>
  );
}
