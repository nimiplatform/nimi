import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/kit/auth';
import '@nimiplatform/kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { overtoneTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import {
  createOvertoneDesktopBrowserAuthAdapter,
  createOvertoneRuntimeAccountBrowserBroker,
} from './overtone-auth-adapter.js';

export function OvertoneLogin() {
  const adapter = useMemo(() => createOvertoneDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createOvertoneRuntimeAccountBrowserBroker(), []);

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        // App-owned token custody is forbidden — token / refreshToken
        // arguments coming back from the kit's positional callback are
        // ignored. We project only the user.
        setAuthSession: (user) => {
          const store = useAppStore.getState();
          if (!user || !user.id) {
            store.clearAuthSession();
            store.setRealmConnection(
              Boolean(import.meta.env.VITE_NIMI_REALM_BASE_URL || import.meta.env.NIMI_REALM_URL),
              false,
            );
            return;
          }

          store.setAuthSession({
            id: String(user.id),
            displayName: String(user.displayName || user.name || ''),
          });
          store.setRealmConnection(true, true);
        },
      }}
      desktopBrowserAuth={{
        bridge: overtoneTauriOAuthBridge,
        runtimeAccountBroker,
      }}
      testIds={{
        screen: 'overtone-login-page',
        logoTrigger: 'overtone-login-trigger',
      }}
    />
  );
}
