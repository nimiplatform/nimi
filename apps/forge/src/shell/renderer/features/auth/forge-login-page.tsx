import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { forgeTauriOAuthBridge } from '@renderer/bridge';
import { createForgeDesktopBrowserAuthAdapter } from './forge-auth-adapter.js';

function createUnavailableRuntimeAccountBroker() {
  return {
    begin: async (): Promise<never> => {
      throw new Error('Forge desktop browser login requires RuntimeAccountService broker wiring.');
    },
    complete: async (): Promise<never> => {
      throw new Error('Forge desktop browser login requires RuntimeAccountService broker wiring.');
    },
  };
}

export function ForgeLoginPage() {
  const adapter = useMemo(() => createForgeDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createUnavailableRuntimeAccountBroker(), []);

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
