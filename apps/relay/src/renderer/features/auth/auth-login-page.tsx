import { useCallback, useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/shell-auth';
import '@nimiplatform/shell-auth/styles.css';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { getBridge } from '../../bridge/electron-bridge.js';
import { createRelayAuthAdapter } from './relay-auth-adapter.js';
import { createElectronOAuthBridge } from './electron-oauth-bridge.js';
import { useChatStore } from '../../app-shell/providers/chat-store.js';

export function AuthLoginPage() {
  const authState = useAppStore((s) => s.authState);
  const authError = useAppStore((s) => s.authError);
  const bridge = useMemo(() => getBridge(), []);
  const adapter = useMemo(() => createRelayAuthAdapter(), []);
  const oauthBridge = useMemo(() => createElectronOAuthBridge(), []);

  const handleFinalizeSession = useCallback((_user: Record<string, unknown> | null, accessToken: string) => {
    useAppStore.getState().setAuthState('authenticating');
    void bridge.auth.applyToken({ accessToken }).then((result) => {
      if (!result.success) {
        throw new Error(result.error || 'Failed to apply token');
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      useAppStore.getState().setAuthState('failed', message);
      // Surface error via status banner so desktop-browser mode can display it
      useChatStore.getState().setStatusBanner({
        kind: 'error',
        message: `认证初始化失败: ${message}`,
      });
    });
  }, [bridge]);

  const handleStatusBanner = useCallback((banner: { kind: string; message: string } | null) => {
    useChatStore.getState().setStatusBanner(
      banner as { kind: 'warning' | 'error' | 'success' | 'info'; message: string } | null,
    );
  }, []);

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode: 'desktop-browser',
        authStatus: authState,
        authError: authState === 'failed' ? authError : null,
        setAuthSession: handleFinalizeSession,
        setStatusBanner: handleStatusBanner,
      }}
      desktopBrowserAuth={{
        bridge: oauthBridge,
      }}
    />
  );
}
