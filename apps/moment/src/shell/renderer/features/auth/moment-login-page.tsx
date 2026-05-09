import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { momentTauriOAuthBridge } from '@renderer/bridge';
import { createMomentDesktopBrowserAuthAdapter } from './moment-auth-adapter.js';
import { createMomentRuntimeAccountBrowserBroker } from '@renderer/infra/bootstrap/moment-runtime-account.js';

export function MomentLoginPage() {
  const adapter = useMemo(() => createMomentDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createMomentRuntimeAccountBrowserBroker(), []);

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        setAuthSession: (user) => {
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
            '',
            '',
          );
        },
      }}
      desktopBrowserAuth={{
        bridge: momentTauriOAuthBridge,
        runtimeAccountBroker,
      }}
      testIds={{
        screen: 'moment-login-page',
        logoTrigger: 'moment-login-trigger',
      }}
    />
  );
}
