import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import {
  continueOauthNextIfPresent,
  freshOauthLoginGateStorageKey,
  readFreshOauthLoginState,
} from './oauth-next-continuation';

const WebAuthMenu = lazy(async () => {
  const mod = await import('./web-auth-menu');
  return { default: mod.WebAuthMenu };
});

export function LoginPage() {
  const flags = getShellFeatureFlags();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);

  // R-OAUTH-011 split UI/API topology. When the apps/web shell is hit at
  // /login?oauth_next=<absolute-API-authorize-URL> by the realm API
  // authorize endpoint, after the user authenticates the web shell MUST
  // navigate the user agent back to the API authorize URL via
  // window.location.assign. The web shell is a UI continuation only — it
  // never parses the OAuth `code`, never receives a refresh token, never
  // exchanges a token. The continuation only fires in `web` shell mode;
  // desktop shells route through the loopback redirect_uri directly and
  // MUST NOT see `oauth_next`.
  const freshOauthState = flags.mode === 'web' && typeof window !== 'undefined'
    ? readFreshOauthLoginState(window.location.search)
    : null;
  if (freshOauthState && authStatus === 'anonymous') {
    const key = freshOauthLoginGateStorageKey(freshOauthState);
    if (!window.sessionStorage.getItem(key)) {
      window.sessionStorage.setItem(key, 'started');
    }
  }

  if (authStatus === 'authenticated') {
    if (flags.mode === 'web' && typeof window !== 'undefined') {
      if (freshOauthState) {
        const key = freshOauthLoginGateStorageKey(freshOauthState);
        const marker = window.sessionStorage.getItem(key);
        if (!marker) {
          window.sessionStorage.setItem(key, 'cleared');
          clearAuthSession();
          return null;
        }
      }
      const continued = continueOauthNextIfPresent(window.location.search);
      if (continued) {
        // window.location.assign issued — render nothing while the browser
        // navigates away.
        return null;
      }
    }
    // Wave 1 route-admission single-point: LoginPage no longer self-redirects
    // when authStatus flips. AppRoutes owns the post-login `/login -> /`
    // handoff via a single useEffect, so a transient renderer/product-control
    // divergence can't drive `<Navigate>` in this component and trip the
    // history.replaceState throttle.
    return null;
  }

  const authMode = flags.mode === 'web'
    ? 'embedded'
    : 'desktop-browser';
  const accountNotice = authStatus === 'expired' || authStatus === 'reauth-required'
    ? t('Auth.reauthenticationRequired', {
        defaultValue: 'Your Runtime account session can no longer be refreshed. Sign in again to continue.',
      })
    : authStatus === 'login-pending'
      ? t('Auth.loginPending', {
          defaultValue: 'Complete sign-in in your browser. This window will continue automatically.',
        })
      : null;

  return (
    <div className="relative min-h-screen">
      {accountNotice ? (
        <div
          role="status"
          data-testid="desktop-account-state-notice"
          className="absolute inset-x-4 top-10 z-30 mx-auto max-w-xl rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 text-center text-sm leading-6 text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-raised)]"
        >
          {accountNotice}
        </div>
      ) : null}
      <Suspense fallback={null}>
        <WebAuthMenu mode={authMode} />
      </Suspense>
    </div>
  );
}
