import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { driftTauriOAuthBridge } from '@renderer/bridge';
import {
  createDriftDesktopBrowserAuthAdapter,
  createDriftRuntimeAccountBrowserBroker,
} from './drift-auth-adapter.js';

export function DriftLoginPage() {
  const adapter = useMemo(() => createDriftDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createDriftRuntimeAccountBrowserBroker(), []);

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        // RD-SHELL-008 / RD-SHELL-010: token / refreshToken arguments are
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
        bridge: driftTauriOAuthBridge,
        runtimeAccountBroker,
      }}
      testIds={{
        screen: 'drift-login-page',
        logoTrigger: 'drift-login-trigger',
      }}
    />
  );
}
