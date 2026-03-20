import type { TauriOAuthBridge } from '@nimiplatform/shell-core/oauth';
import { DESKTOP_CALLBACK_TIMEOUT_MS } from '@nimiplatform/shell-core/oauth';
import {
  createDesktopCallbackRedirectUri,
  createDesktopCallbackState,
  validateDesktopCallbackState,
  buildDesktopWebAuthLaunchUrl,
} from './desktop-callback-helpers.js';

export type DesktopWebAuthResult = {
  accessToken: string;
};

export async function performDesktopWebAuth(
  bridge: TauriOAuthBridge,
  options?: { baseUrl?: string; timeoutMs?: number; onOpened?: () => void },
): Promise<DesktopWebAuthResult> {
  if (!bridge.hasTauriInvoke()) {
    throw new Error('当前环境不支持浏览器授权回调');
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
    throw new Error('无法打开系统浏览器');
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
    throw new Error('网页登录回调 state 校验失败');
  }

  const accessToken = String(callback.code || '').trim();
  if (!accessToken) {
    throw new Error('网页登录回调缺少 access token');
  }

  return { accessToken };
}
