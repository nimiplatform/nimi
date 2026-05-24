import type { AuthPlatformAdapter } from '@nimiplatform/kit/auth';
import { getPlatformClient } from '@nimiplatform/sdk';
import { overtoneTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import {
  ensureOvertoneBootstrapReady,
  loadOvertoneRuntimeAccountUser,
  overtoneRuntimeAccountCaller,
} from '@renderer/infra/bootstrap/overtone-bootstrap.js';
import type { AuthUser } from '@renderer/app-shell/providers/app-store.js';

const OVERTONE_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Overtone desktop-browser mode.';

const OVERTONE_TOKEN_PROXY_FORBIDDEN =
  'Overtone does not own access/refresh token custody (spec K-ACCSVC-008). '
  + 'Runtime is the sole owner — login through the desktop browser broker.';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(OVERTONE_EMBEDDED_AUTH_UNSUPPORTED));
}

export async function loadOvertoneCurrentUser(): Promise<AuthUser | null> {
  await ensureOvertoneBootstrapReady();
  return loadOvertoneRuntimeAccountUser(getPlatformClient().runtime);
}

export async function logoutOvertoneRuntimeAccount(): Promise<void> {
  await ensureOvertoneBootstrapReady();
  await getPlatformClient().runtime.account.logout({
    caller: overtoneRuntimeAccountCaller,
    reason: 'overtone_logout',
  });
}

/**
 * Adapter for the kit's `<DesktopShellAuthPage>` in Overtone desktop-browser
 * mode. Account / session truth is owned by RuntimeAccountService; this
 * adapter intentionally rejects every app-owned token surface so a
 * regression that tries to flow a bearer or refresh token through the kit
 * fails fast.
 */
export function createOvertoneDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
  return {
    checkEmail: unsupported,
    passwordLogin: unsupported,
    requestEmailOtp: unsupported,
    verifyEmailOtp: unsupported,
    verifyTwoFactor: unsupported,
    walletChallenge: unsupported,
    walletLogin: unsupported,
    oauthLogin: unsupported,
    updatePassword: unsupported,
    loadCurrentUser: loadOvertoneCurrentUser,
    applyToken: async () => {
      throw new Error(OVERTONE_TOKEN_PROXY_FORBIDDEN);
    },
    persistSession: async () => {
      throw new Error(OVERTONE_TOKEN_PROXY_FORBIDDEN);
    },
    clearPersistedSession: async () => {
      await logoutOvertoneRuntimeAccount();
    },
    oauthBridge: overtoneTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}

/**
 * RuntimeAccountService browser broker for Overtone desktop login. Pairs
 * with the kit's `performDesktopWebAuth` direct-to-loopback flow:
 *
 * - Runtime BeginLogin returns a fully-formed realm OAuth authorize URL with
 *   a PKCE S256 challenge bound to a runtime-held verifier.
 * - On user consent, the realm authorize endpoint 302-redirects directly to
 *   the Overtone desktop loopback redirect_uri with a raw OAuth `code`.
 * - Runtime CompleteLogin exchanges the code with the realm token endpoint
 *   and projects account material into runtime custody.
 *
 * The kit / Overtone renderer never observes access tokens or refresh
 * tokens at any stage of this flow (R-OAUTH-008 / spec K-ACCSVC-008).
 */
export function createOvertoneRuntimeAccountBrowserBroker() {
  return {
    begin: async (input: { callbackUrl: string; baseUrl?: string; timeoutMs: number }) => {
      await ensureOvertoneBootstrapReady();
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: overtoneRuntimeAccountCaller,
        redirectUri: input.callbackUrl,
        callbackOrigin: new URL(input.callbackUrl).origin,
        requestedScopes: [],
        ttlSeconds: Math.max(10, Math.ceil(input.timeoutMs / 1000)),
      });
      if (
        !response.accepted
        || !response.loginAttemptId
        || !response.oauthAuthorizationUrl
        || !response.state
        || !response.nonce
      ) {
        throw new Error(
          `Runtime account login could not start: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`,
        );
      }
      return {
        loginAttemptId: response.loginAttemptId,
        // Realm OAuth authorize URL is constructed by runtime (PKCE S256
        // challenge bound to runtime-held verifier).
        authorizationUrl: response.oauthAuthorizationUrl,
        state: response.state,
        nonce: response.nonce,
      };
    },
    complete: async (input: {
      loginAttemptId: string;
      code: string;
      state: string;
      nonce: string;
      callbackUrl: string;
    }) => {
      await ensureOvertoneBootstrapReady();
      // Code-only proof envelope; runtime owns the token exchange and
      // refresh-token custody.
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: overtoneRuntimeAccountCaller,
        loginAttemptId: input.loginAttemptId,
        code: input.code,
        // R-OAUTH-008 / spec K-ACCSVC-008: refreshToken MUST be empty here.
        // Runtime fail-closes any non-empty value with PROOF_UNSUPPORTED.
        refreshToken: '',
        state: input.state,
        nonce: input.nonce,
        redirectUri: input.callbackUrl,
        callbackOrigin: new URL(input.callbackUrl).origin,
        uxTraceId: '',
        sealedCompletionTicket: '',
      });
      if (!response.accepted) {
        throw new Error(
          `Runtime account login could not complete: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`,
        );
      }
      const accountId = String(response.accountProjection?.accountId || '').trim();
      return {
        user: accountId
          ? {
              id: accountId,
              displayName: String(response.accountProjection?.displayName || '').trim(),
            }
          : null,
      };
    },
  };
}
