import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { overtoneTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import { createOvertoneDesktopBrowserAuthAdapter } from './overtone-auth-adapter.js';

export function OvertoneLogin() {
  const adapter = useMemo(() => createOvertoneDesktopBrowserAuthAdapter(), []);

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
            store.setRealmConnection(Boolean(import.meta.env.VITE_NIMI_REALM_BASE_URL || import.meta.env.NIMI_REALM_URL), false);
            return;
          }

          store.setAuthSession(
            {
              id: String(user.id),
              displayName: String(user.displayName || user.name || ''),
            },
            token,
            refreshToken || '',
          );
          store.setRealmConnection(true, true);
        },
      }}
      desktopBrowserAuth={{
        bridge: overtoneTauriOAuthBridge,
      }}
      testIds={{
        screen: 'overtone-login-page',
        logoTrigger: 'overtone-login-trigger',
      }}
    />
  );
}
