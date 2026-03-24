import { Suspense, lazy } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';

const WebAuthMenu = lazy(async () => {
  const mod = await import('./web-auth-menu');
  return { default: mod.WebAuthMenu };
});

export function LoginPage() {
  const flags = getShellFeatureFlags();
  const authStatus = useAppStore((state) => state.auth.status);
  const location = useLocation();
  const hasDesktopCallback = new URLSearchParams(location.search).has('desktop_callback');

  if (flags.mode === 'desktop' && authStatus === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  if (flags.mode === 'web' && authStatus === 'authenticated' && !hasDesktopCallback) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={null}>
      <WebAuthMenu mode={flags.mode === 'web' ? 'embedded' : 'desktop-browser'} />
    </Suspense>
  );
}
