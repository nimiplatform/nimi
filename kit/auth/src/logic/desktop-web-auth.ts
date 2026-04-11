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
};

export async function performDesktopWebAuth(
  bridge: TauriOAuthBridge,
  options?: { baseUrl?: string; timeoutMs?: number; onOpened?: () => void },
): Promise<DesktopWebAuthResult> {
  if (!bridge.hasTauriInvoke()) {
    throw new Error(AUTH_COPY.desktopBrowserAuthUnsupported);
  }

  const callbackUrl = createDesktopCallbackRedirectUri();
  const callbackState = createDesktopCallbackState();
  const launchUrl = buildDesktopWebAuthLaunchUrl({
    callbackUrl,
    state: callbackState,
    baseUrl: options?.baseUrl,
  });

  const listenTask = bridge.oauthListenForCode({
    redirectUri: callbackUrl,
    timeoutMs: options?.timeoutMs ?? DESKTOP_CALLBACK_TIMEOUT_MS,
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

  if (!validateDesktopCallbackState({
    expectedState: callbackState,
    actualState: String(callback.state || ''),
    maxAgeMs: options?.timeoutMs ?? DESKTOP_CALLBACK_TIMEOUT_MS,
  })) {
    throw new Error(AUTH_COPY.desktopBrowserStateInvalid);
  }

  const accessToken = String(callback.code || '').trim();
  if (!accessToken) {
    throw new Error(AUTH_COPY.desktopBrowserAccessTokenMissing);
  }

  return { accessToken };
}
