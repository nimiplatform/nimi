import { useEffect, useMemo } from 'react';
import {
  DesktopShellAuthPage,
  buildDesktopWebAuthLaunchUrl,
  resolveDesktopCallbackRequestFromLocation,
} from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { createShiJiDesktopBrowserAuthAdapter } from './shiji-auth-adapter.js';
import { shijiTauriOAuthBridge } from '@renderer/bridge/oauth.js';

export function ShiJiLoginPage() {
  const adapter = useMemo(() => createShiJiDesktopBrowserAuthAdapter(), []);
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
            return;
          }
          store.setAuthSession(
            {
              id: String(user.id),
              displayName: String(user.displayName || user.name || ''),
              email: user.email ? String(user.email) : undefined,
              avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
            },
            token,
            refreshToken || '',
          );
        },
      }}
      desktopBrowserAuth={{
        bridge: shijiTauriOAuthBridge,
      }}
      testIds={{
        screen: 'shiji-login-page',
        logoTrigger: 'shiji-login-trigger',
      }}
    />
  );
}
