import type { TauriOAuthBridge } from '@nimiplatform/nimi-kit/core/oauth';
import { DESKTOP_CALLBACK_TIMEOUT_MS } from './oauth-helpers.js';
import { createDesktopCallbackRedirectUri } from './desktop-callback-helpers.js';
import { AUTH_COPY } from './auth-copy.js';

/**
 * Result of `performDesktopWebAuth`.
 *
 * In the direct-to-loopback architecture (Wave A1) the runtime account broker
 * is the only admitted path: realm 302-redirects the user agent directly to
 * the loopback redirect_uri with a raw OAuth `code` and `state`, the runtime
 * exchanges the code with the realm token endpoint, and the desktop receives
 * the projected account material — never the raw access/refresh tokens
 * (R-OAUTH-008 / spec K-ACCSVC-008).
 */
export type DesktopWebAuthResult = {
  user: Record<string, unknown> | null;
};

/**
 * Drive the desktop web authentication handshake end-to-end:
 *
 * 1. Pick a random loopback redirect_uri.
 * 2. Ask the runtime account broker to begin a login attempt; the runtime
 *    returns a fully-formed realm OAuth authorize URL (with PKCE S256
 *    challenge, client_id, redirect_uri, state). The desktop kit MUST use
 *    that URL verbatim — no fallback URL construction is admitted.
 * 3. Spawn the Tauri loopback listener and open the user agent at the
 *    runtime-supplied authorize URL.
 * 4. Realm authorizes the user and 302-redirects the user agent directly to
 *    the loopback redirect_uri with `code` + `state`.
 * 5. Runtime broker.complete exchanges the code with the realm token
 *    endpoint and persists the account material into runtime custody.
 *
 * The kit/desktop never observes access tokens or refresh tokens at any
 * stage of this flow.
 */
export async function performDesktopWebAuth(
  bridge: TauriOAuthBridge,
  options: {
    timeoutMs?: number;
    onOpened?: () => void;
    runtimeAccountBroker: {
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
        code: string;
        state: string;
        nonce: string;
        callbackUrl: string;
      }) => Promise<{
        user: Record<string, unknown> | null;
      }>;
    };
    baseUrl?: string;
  },
): Promise<DesktopWebAuthResult> {
  if (!bridge.hasTauriInvoke()) {
    throw new Error(AUTH_COPY.desktopBrowserAuthUnsupported);
  }

  const callbackUrl = createDesktopCallbackRedirectUri();
  const timeoutMs = options.timeoutMs ?? DESKTOP_CALLBACK_TIMEOUT_MS;
  const runtimeBroker = options.runtimeAccountBroker;

  const runtimeAttempt = await runtimeBroker.begin({
    callbackUrl,
    baseUrl: options.baseUrl,
    timeoutMs,
  });
  const launchUrl = String(runtimeAttempt.authorizationUrl || '').trim();
  if (!launchUrl) {
    throw new Error(AUTH_COPY.desktopBrowserAuthorizationUrlMissing);
  }
  const expectedState = String(runtimeAttempt.state || '').trim();
  if (!expectedState) {
    throw new Error(AUTH_COPY.desktopBrowserStateInvalid);
  }

  const listenTask = bridge.oauthListenForCode({
    redirectUri: callbackUrl,
    timeoutMs,
  });

  const launchResult = await bridge.openExternalUrl(launchUrl);
  if (!launchResult.opened) {
    throw new Error(AUTH_COPY.desktopBrowserOpenFailed);
  }
  options.onOpened?.();

  const callback = await listenTask;
  void bridge.focusMainWindow().catch(() => undefined);

  if (callback.error) {
    throw new Error(`网页授权失败：${callback.error}`);
  }

  const actualState = String(callback.state || '').trim();
  if (actualState !== expectedState) {
    throw new Error(AUTH_COPY.desktopBrowserStateInvalid);
  }

  const code = String(callback.code || '').trim();
  if (!code) {
    throw new Error(AUTH_COPY.desktopBrowserCodeMissing);
  }

  const completion = await runtimeBroker.complete({
    loginAttemptId: runtimeAttempt.loginAttemptId,
    code,
    state: expectedState,
    nonce: runtimeAttempt.nonce,
    callbackUrl,
  });

  return { user: completion.user };
}
