import type { TauriOAuthBridge } from '@nimiplatform/kit/core/oauth';
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

export function validateRuntimeOAuthAuthorizationUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error('Runtime account login did not return an OAuth authorization URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Runtime account login returned an invalid OAuth authorization URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Runtime account login returned a non-HTTP OAuth authorization URL');
  }
  if (parsed.hostname === 'auth.nimi.invalid') {
    throw new Error('Runtime account login returned an unavailable OAuth authority');
  }
  if (parsed.hash) {
    throw new Error('Runtime account login returned an OAuth authorization URL with a fragment');
  }
  if (!parsed.pathname.replace(/\/+$/, '').endsWith('/oauth/authorize')) {
    throw new Error('Runtime account login returned a non-authorize OAuth URL');
  }
  if (parsed.searchParams.has('desktop_callback') || parsed.searchParams.has('desktop_state')) {
    throw new Error('Runtime account login returned a retired desktop relay URL');
  }

  return parsed.toString();
}

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
  const launchUrl = validateRuntimeOAuthAuthorizationUrl(runtimeAttempt.authorizationUrl);
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
