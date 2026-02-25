import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { useAppStore } from '@renderer/app-shell/providers/app-store';

const LoginPage = lazy(async () => {
  const mod = await import('@renderer/features/auth/login-page');
  return { default: mod.LoginPage };
});

const MainLayout = lazy(async () => {
  const mod = await import('@renderer/app-shell/layouts/main-layout');
  return { default: mod.MainLayout };
});

function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
        {t('Bootstrap.initializingRuntime')}
      </div>
    </div>
  );
}

function BootstrapErrorScreen({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-5">
        <h1 className="text-lg font-semibold text-red-700">{t('Bootstrap.startFailedTitle')}</h1>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
      </div>
    </div>
  );
}

export function AppRoutes() {
  const flags = getShellFeatureFlags();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);
  const authStatus = useAppStore((state) => state.auth.status);

  if (flags.mode !== 'web' && !bootstrapReady && !bootstrapError) {
    return <LoadingScreen />;
  }

  if (bootstrapError) {
    return <BootstrapErrorScreen message={bootstrapError} />;
  }

  return (
    <Routes>
      {authStatus === 'authenticated' ? (
        <>
          <Route path="/" element={(
            <Suspense fallback={<LoadingScreen />}>
              <MainLayout />
            </Suspense>
          )}
          />
          {flags.mode === 'web' ? (
            <Route
              path="/login"
              element={(
                <Suspense fallback={<LoadingScreen />}>
                  <LoginPage />
                </Suspense>
              )}
            />
          ) : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <>
          <Route
            path="/login"
            element={(
              <Suspense fallback={<LoadingScreen />}>
                <LoginPage />
              </Suspense>
            )}
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
    </Routes>
  );
}
