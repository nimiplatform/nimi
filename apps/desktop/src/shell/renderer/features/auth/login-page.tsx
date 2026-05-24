import { Suspense, lazy } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { continueOauthNextIfPresent } from './oauth-next-continuation';

const WebAuthMenu = lazy(async () => {
  const mod = await import('./web-auth-menu');
  return { default: mod.WebAuthMenu };
});

export function LoginPage() {
  const flags = getShellFeatureFlags();
  const authStatus = useAppStore((state) => state.auth.status);

  // R-OAUTH-011 split UI/API topology. When the apps/web shell is hit at
  // /login?oauth_next=<absolute-API-authorize-URL> by the realm API
  // authorize endpoint, after the user authenticates the web shell MUST
  // navigate the user agent back to the API authorize URL via
  // window.location.assign. The web shell is a UI continuation only — it
  // never parses the OAuth `code`, never receives a refresh token, never
  // exchanges a token. The continuation only fires in `web` shell mode;
  // desktop shells route through the loopback redirect_uri directly and
  // MUST NOT see `oauth_next`.
  if (authStatus === 'authenticated') {
    if (flags.mode === 'web' && typeof window !== 'undefined') {
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

  return (
    <div className="relative min-h-screen">
      <Suspense fallback={null}>
        <WebAuthMenu mode={flags.mode === 'web' ? 'embedded' : 'desktop-browser'} />
      </Suspense>
    </div>
  );
}
