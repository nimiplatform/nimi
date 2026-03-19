import { useCallback, useMemo } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/shell-auth';
import '@nimiplatform/shell-auth/styles.css';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { getBridge } from '../../bridge/electron-bridge.js';
import { createRelayAuthAdapter } from './relay-auth-adapter.js';
import { createElectronOAuthBridge } from './electron-oauth-bridge.js';
import { useChatStore, type StatusBanner } from '../../app-shell/providers/chat-store.js';
import type { RelayInvokeResponse } from '../../../shared/ipc-contract.js';
import type { JsonObject } from '../../../shared/json.js';

export function AuthLoginPage() {
  const authState = useAppStore((s) => s.authState);
  const authError = useAppStore((s) => s.authError);
  const bridge = useMemo(() => getBridge(), []);
  const adapter = useMemo(() => createRelayAuthAdapter(), []);
  const oauthBridge = useMemo(() => createElectronOAuthBridge(), []);

  const handleFinalizeSession = useCallback((_user: RelayInvokeResponse<'relay:auth:current-user'> | JsonObject | null, accessToken: string) => {
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

  const handleStatusBanner = useCallback((banner: { kind?: unknown; message?: unknown } | null) => {
    const normalized: StatusBanner = banner
      ? {
          kind:
            banner.kind === 'warning'
            || banner.kind === 'error'
            || banner.kind === 'success'
            || banner.kind === 'info'
              ? banner.kind
              : 'info',
          message: String(banner.message || '').trim(),
        }
      : null;
    useChatStore.getState().setStatusBanner(normalized);
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
