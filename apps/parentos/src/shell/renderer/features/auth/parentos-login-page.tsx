import { useEffect, useMemo } from 'react';
import {
  DesktopShellAuthPage,
  buildDesktopWebAuthLaunchUrl,
  resolveDesktopCallbackRequestFromLocation,
} from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '../../app-shell/app-store.js';
import { createParentOSDesktopBrowserAuthAdapter } from './parentos-auth-adapter.js';
import { parentosTauriOAuthBridge } from '../../bridge/index.js';
import { syncParentOSLocalDataScope } from '../../infra/parentos-bootstrap.js';

export function ParentOSLoginPage() {
  const adapter = useMemo(() => createParentOSDesktopBrowserAuthAdapter(), []);
  const webBaseUrl = useAppStore((s) => s.runtimeDefaults?.webBaseUrl || '');
  const desktopCallbackRequest = useMemo(() => resolveDesktopCallbackRequestFromLocation(), []);
  const desktopCallbackRedirectUrl = useMemo(() => {
    if (!desktopCallbackRequest) {
      return '';
    }
    return buildDesktopWebAuthLaunchUrl({
      callbackUrl: desktopCallbackRequest.callbackUrl,
      state: desktopCallbackRequest.state,
    });
  }, [desktopCallbackRequest]);

  useEffect(() => {
    if (!desktopCallbackRequest || typeof window === 'undefined') {
      return;
    }
    const currentUrl = window.location.href;
    if (!desktopCallbackRedirectUrl || desktopCallbackRedirectUrl === currentUrl) {
      return;
    }
    window.location.replace(desktopCallbackRedirectUrl);
  }, [desktopCallbackRequest, desktopCallbackRedirectUrl]);

  if (desktopCallbackRequest) {
    return null;
  }

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        setAuthSession: (user, token, refreshToken) => {
          const store = useAppStore.getState();
          if (!user || !user.id) {
            store.clearAuthSession();
            void syncParentOSLocalDataScope(null);
            return;
          }

          const nextUserId = String(user.id);
          const previousUserId = store.auth.user?.id ?? null;
          store.setAuthSession(
            {
              id: nextUserId,
              displayName: String(user.displayName || user.name || ''),
              email: user.email ? String(user.email) : undefined,
              avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
            },
            token,
            refreshToken || '',
          );
          if (previousUserId !== nextUserId) {
            void syncParentOSLocalDataScope(nextUserId);
          }
        },
      }}
      desktopBrowserAuth={{
        baseUrl: webBaseUrl || undefined,
        bridge: parentosTauriOAuthBridge,
      }}
      testIds={{
        screen: 'parentos-login-page',
        logoTrigger: 'parentos-login-trigger',
      }}
    />
  );
}
