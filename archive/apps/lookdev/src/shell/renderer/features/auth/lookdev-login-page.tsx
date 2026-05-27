import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/kit/auth';
import '@nimiplatform/kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { lookdevTauriOAuthBridge } from '@renderer/bridge';
import {
  createLookdevDesktopBrowserAuthAdapter,
  createLookdevRuntimeAccountBrowserBroker,
} from './lookdev-auth-adapter.js';

export function LookdevLoginPage() {
  const adapter = useMemo(() => createLookdevDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createLookdevRuntimeAccountBrowserBroker(), []);

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        // LD-SHELL-011 / LD-SHELL-012: token / refreshToken arguments are
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
        bridge: lookdevTauriOAuthBridge,
        runtimeAccountBroker,
      }}
      testIds={{
        screen: 'lookdev-login-page',
        logoTrigger: 'lookdev-login-trigger',
      }}
    />
  );
}
