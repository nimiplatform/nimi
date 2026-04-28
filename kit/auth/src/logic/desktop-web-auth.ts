import type { TauriOAuthBridge } from '@nimiplatform/nimi-kit/core/oauth';
import { DESKTOP_CALLBACK_TIMEOUT_MS } from './oauth-helpers.js';
import {
  createDesktopCallbackRedirectUri,
  createDesktopCallbackState,
  validateDesktopCallbackState,
  buildDesktopWebAuthLaunchUrl,
} from './desktop-callback-helpers.js';
import { AUTH_COPY } from './auth-copy.js';

export type DesktopWebAuthResult = {
  accessToken: string;
  refreshToken?: string;
  runtimeAccountCompleted?: boolean;
  user?: Record<string, unknown> | null;
};

export async function performDesktopWebAuth(
  bridge: TauriOAuthBridge,
  options?: {
    baseUrl?: string;
    timeoutMs?: number;
    onOpened?: () => void;
    runtimeAccountBroker?: {
      begin: (input: {
        callbackUrl: string;
        baseUrl?: string;
        timeoutMs: number;
      }) => Promise<{
        loginAttemptId: string;
        authorizationUrl: string;
        state: string;
        nonce: string;
      }>;
      complete: (input: {
        loginAttemptId: string;
        accessToken: string;
        refreshToken: string;
        state: string;
        nonce: string;
        callbackUrl: string;
      }) => Promise<{
        user: Record<string, unknown> | null;
      }>;
    };
  },
): Promise<DesktopWebAuthResult> {
  if (!bridge.hasTauriInvoke()) {
    throw new Error(AUTH_COPY.desktopBrowserAuthUnsupported);
  }

  const callbackUrl = createDesktopCallbackRedirectUri();
  const timeoutMs = options?.timeoutMs ?? DESKTOP_CALLBACK_TIMEOUT_MS;
  const runtimeBroker = options?.runtimeAccountBroker;
  const runtimeAttempt = runtimeBroker
    ? await runtimeBroker.begin({ callbackUrl, baseUrl: options?.baseUrl, timeoutMs })
    : null;
  const callbackState = runtimeAttempt?.state || createDesktopCallbackState();
  const launchUrl = runtimeAttempt?.authorizationUrl || buildDesktopWebAuthLaunchUrl({
    callbackUrl,
    state: callbackState,
    baseUrl: options?.baseUrl,
  });

  const listenTask = bridge.oauthListenForCode({
    redirectUri: callbackUrl,
    timeoutMs,
  });

  const launchResult = await bridge.openExternalUrl(launchUrl);
  if (!launchResult.opened) {
    throw new Error(AUTH_COPY.desktopBrowserOpenFailed);
  }
  options?.onOpened?.();

  const callback = await listenTask;
  void bridge.focusMainWindow().catch(() => undefined);

  if (callback.error) {
    throw new Error(`网页授权失败：${callback.error}`);
  }

  const actualState = String(callback.state || '').trim();
  const stateAccepted = runtimeAttempt
    ? actualState === callbackState
    : validateDesktopCallbackState({
        expectedState: callbackState,
        actualState,
        maxAgeMs: timeoutMs,
      });
  if (!stateAccepted) {
    throw new Error(AUTH_COPY.desktopBrowserStateInvalid);
  }

  const accessToken = String(callback.code || '').trim();
  if (!accessToken) {
    throw new Error(AUTH_COPY.desktopBrowserAccessTokenMissing);
  }
  const refreshToken = String(callback.refreshToken || '').trim();
  if (runtimeBroker && runtimeAttempt) {
    if (!refreshToken) {
      throw new Error(AUTH_COPY.desktopBrowserRefreshTokenMissing);
    }
    const complete = await runtimeBroker.complete({
      loginAttemptId: runtimeAttempt.loginAttemptId,
      accessToken,
      refreshToken,
      state: callbackState,
      nonce: runtimeAttempt.nonce,
      callbackUrl,
    });
    return {
      accessToken: '',
      runtimeAccountCompleted: true,
      user: complete.user,
    };
  }

  return { accessToken, refreshToken };
}
