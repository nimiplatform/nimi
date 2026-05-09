import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { shijiTauriOAuthBridge } from '@renderer/bridge';
import {
  createShiJiDesktopBrowserAuthAdapter,
  createShiJiRuntimeAccountBrowserBroker,
} from './shiji-auth-adapter.js';

export function ShiJiLoginPage() {
  const adapter = useMemo(() => createShiJiDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createShiJiRuntimeAccountBrowserBroker(), []);

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        // SJ-SHELL-009 / SJ-SHELL-011: token / refreshToken arguments are
        // ignored — the renderer auth slice no longer carries them. The kit
        // still calls back with the legacy positional shape; we project only
        // the user.
        setAuthSession: (user) => {
          const store = useAppStore.getState();
          if (!user || !user.id) {
            store.clearAuthSession();
            return;
          }
          store.setAuthSession({
            id: String(user.id),
            displayName: String(user.displayName || user.name || ''),
            email: user.email ? String(user.email) : undefined,
            avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
          });
        },
      }}
      desktopBrowserAuth={{
        bridge: shijiTauriOAuthBridge,
        runtimeAccountBroker,
      }}
      testIds={{
        screen: 'shiji-login-page',
        logoTrigger: 'shiji-login-trigger',
      }}
    />
  );
}
