import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { hasDesktopCallbackRequestInLocation } from '@nimiplatform/nimi-kit/auth';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

const WebAuthMenu = lazy(async () => {
  const mod = await import('./web-auth-menu');
  return { default: mod.WebAuthMenu };
});

export function LoginPage() {
  const flags = getShellFeatureFlags();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const location = useLocation();
  const navigate = useNavigate();
  const hasDesktopCallback = hasDesktopCallbackRequestInLocation({
    search: location.search,
    hash: typeof window !== 'undefined' ? window.location.hash : '',
  });

  if (flags.mode === 'desktop' && authStatus === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  if (flags.mode === 'web' && authStatus === 'authenticated' && !hasDesktopCallback) {
    return <Navigate to="/" replace />;
  }

  const onReturnToRuntime = () => {
    setActiveTab('runtime');
    if ((location.state as { returnToRuntime?: boolean } | null)?.returnToRuntime && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="relative min-h-screen">
      {flags.mode === 'desktop' ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20">
          <button
            type="button"
            data-testid={E2E_IDS.loginBackButton}
            onClick={onReturnToRuntime}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/80 text-[#667085] shadow-sm backdrop-blur transition hover:bg-white hover:text-[#1f2937]"
            aria-label={t('Auth.backToRuntime', { defaultValue: 'Back to AI Runtime' })}
            title={t('Auth.backToRuntime', { defaultValue: 'Back to AI Runtime' })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      ) : null}
      <Suspense fallback={null}>
        <WebAuthMenu mode={flags.mode === 'web' ? 'embedded' : 'desktop-browser'} />
      </Suspense>
    </div>
  );
}
