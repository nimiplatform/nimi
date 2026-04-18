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

  const navigateToTab = (tab: string) => {
    setActiveTab(tab as Parameters<typeof setActiveTab>[0]);
    if ((location.state as { returnToChat?: boolean } | null)?.returnToChat && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/', { replace: true });
  };
  const handleBackToChat = () => {
    setActiveTab('chat');
    if ((location.state as { returnToChat?: boolean } | null)?.returnToChat && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/', { replace: true });
  };

  const navButtonClass = 'pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/80 text-[#667085] shadow-sm transition hover:bg-white hover:text-[#1f2937]';

  return (
    <div className="relative min-h-screen">
      {flags.mode === 'desktop' ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-2">
          {/* Chat icon */}
          <button
            type="button"
            data-testid={E2E_IDS.loginBackButton}
            onClick={handleBackToChat}
            className={navButtonClass}
            aria-label={t('Auth.backToChat', { defaultValue: 'Back to chat' })}
            title={t('Auth.backToChat', { defaultValue: 'Back to chat' })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          {/* Runtime icon */}
          <button
            type="button"
            onClick={() => navigateToTab('runtime')}
            className={navButtonClass}
            aria-label={t('Navigation.runtime', { defaultValue: 'Runtime' })}
            title={t('Navigation.runtime', { defaultValue: 'Runtime' })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
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
