import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/kit/auth';
import '@nimiplatform/kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { forgeTauriOAuthBridge } from '@renderer/bridge';
import {
  createForgeDesktopBrowserAuthAdapter,
  createForgeRuntimeAccountBrowserBroker,
} from './forge-auth-adapter.js';

export function ForgeLoginPage() {
  const adapter = useMemo(() => createForgeDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createForgeRuntimeAccountBrowserBroker(), []);

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        // FG-SHELL-009 / FG-SHELL-012: token / refreshToken arguments are
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
        bridge: forgeTauriOAuthBridge,
        runtimeAccountBroker,
      }}
      testIds={{
        screen: 'forge-login-page',
        logoTrigger: 'forge-login-trigger',
      }}
    />
  );
}
