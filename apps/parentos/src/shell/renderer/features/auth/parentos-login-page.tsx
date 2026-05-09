import { useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/nimi-kit/auth';
import '@nimiplatform/nimi-kit/auth/styles.css';
import { useAppStore } from '../../app-shell/app-store.js';
import {
  createParentOSDesktopBrowserAuthAdapter,
  createParentOSRuntimeAccountBrowserBroker,
} from './parentos-auth-adapter.js';
import { parentosTauriOAuthBridge } from '../../bridge/index.js';
import { syncParentOSLocalDataScope } from '../../infra/parentos-bootstrap.js';

export function ParentOSLoginPage() {
  const adapter = useMemo(() => createParentOSDesktopBrowserAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createParentOSRuntimeAccountBrowserBroker(), []);
  const webBaseUrl = useAppStore((s) => s.runtimeDefaults?.webBaseUrl || '');

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: 'unauthenticated',
        // The kit only invokes `setAuthSession` after the runtime broker has
        // returned an account projection; the second argument (legacy access
        // token) is always empty under PO-SHELL-008.
        setAuthSession: (user) => {
          const store = useAppStore.getState();
          if (!user || !user.id) {
            store.clearAuthSession();
            void syncParentOSLocalDataScope(null);
            return;
          }

          const nextUserId = String(user.id);
          const previousUserId = store.auth.user?.id ?? null;
          store.setAuthSession({
            id: nextUserId,
            displayName: String(user.displayName || user.name || ''),
            email: user.email ? String(user.email) : undefined,
            avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
          });
          if (previousUserId !== nextUserId) {
            void syncParentOSLocalDataScope(nextUserId);
          }
        },
      }}
      desktopBrowserAuth={{
        baseUrl: webBaseUrl || undefined,
        bridge: parentosTauriOAuthBridge,
        runtimeAccountBroker,
      }}
      testIds={{
        screen: 'parentos-login-page',
        logoTrigger: 'parentos-login-trigger',
      }}
    />
  );
}
