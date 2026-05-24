import type { AuthPlatformAdapter } from '@nimiplatform/kit/auth';
import { getPlatformClient } from '@nimiplatform/sdk';
import { driftTauriOAuthBridge } from '@renderer/bridge';
import {
  ensureDriftBootstrapReady,
  loadDriftRuntimeAccountUser,
  driftRuntimeAccountCaller,
} from '@renderer/infra/bootstrap/drift-bootstrap.js';
import type { AuthUser } from '@renderer/app-shell/app-store.js';

const DRIFT_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Realm Drift desktop-browser mode.';

const DRIFT_TOKEN_PROXY_FORBIDDEN =
  'Realm Drift does not own access/refresh token custody (RD-SHELL-010 / spec K-ACCSVC-008). '
  + 'Runtime is the sole owner — login through the desktop browser broker.';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(DRIFT_EMBEDDED_AUTH_UNSUPPORTED));
}

export async function loadDriftCurrentUser(): Promise<AuthUser | null> {
  await ensureDriftBootstrapReady();
  return loadDriftRuntimeAccountUser(getPlatformClient().runtime);
}

export async function logoutDriftRuntimeAccount(): Promise<void> {
  await ensureDriftBootstrapReady();
  await getPlatformClient().runtime.account.logout({
    caller: driftRuntimeAccountCaller,
    reason: 'realm_drift_logout',
  });
}

/**
 * Adapter for the kit's `<DesktopShellAuthPage>` in Realm Drift desktop-browser
 * mode. Account / session truth is owned by RuntimeAccountService; this
 * adapter intentionally rejects every app-owned token surface (RD-SHELL-010)
 * so a regression that tries to flow a bearer or refresh token through the
 * kit fails fast.
 */
export function createDriftDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser: loadDriftCurrentUser,
    applyToken: async () => {
      throw new Error(DRIFT_TOKEN_PROXY_FORBIDDEN);
    },
    persistSession: async () => {
      throw new Error(DRIFT_TOKEN_PROXY_FORBIDDEN);
    },
    clearPersistedSession: async () => {
      await logoutDriftRuntimeAccount();
    },
    oauthBridge: driftTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}

/**
 * RuntimeAccountService browser broker for Realm Drift desktop login. Pairs
 * with the kit's `performDesktopWebAuth` direct-to-loopback flow:
 *
 * - Runtime BeginLogin returns a fully-formed realm OAuth authorize URL with a
 *   PKCE S256 challenge bound to a runtime-held verifier.
 * - On user consent, the realm authorize endpoint 302-redirects directly to
 *   the Realm Drift desktop loopback redirect_uri with a raw OAuth `code`.
 * - Runtime CompleteLogin exchanges the code with the realm token endpoint
 *   and projects account material into runtime custody.
 *
 * The kit / Realm Drift renderer never observes access tokens or refresh
 * tokens at any stage of this flow (R-OAUTH-008 / spec K-ACCSVC-008).
 */
export function createDriftRuntimeAccountBrowserBroker() {
  return {
    begin: async (input: { callbackUrl: string; baseUrl?: string; timeoutMs: number }) => {
      await ensureDriftBootstrapReady();
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: driftRuntimeAccountCaller,
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
        // RD-SHELL-009 / R-OAUTH / K-ACCSVC-008: realm OAuth authorize URL is
        // constructed by runtime (PKCE S256 challenge bound to runtime-held
        // verifier).
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
      await ensureDriftBootstrapReady();
      // RD-SHELL-010 / R-OAUTH / K-ACCSVC-008: code-only proof envelope;
      // runtime owns the token exchange and refresh-token custody.
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: driftRuntimeAccountCaller,
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

/**
 * RD-SHELL-004 / RD-SHELL-010: Project a one-shot short-lived access token
 * from runtime custody for use cases that require a bearer token (e.g.
 * RD-HCHAT human-chat Socket.IO connection). The token MUST NOT be cached
 * on the app store or in module-level state.
 */
export async function projectDriftRealtimeAccessToken(): Promise<string> {
  await ensureDriftBootstrapReady();
  const response = await getPlatformClient().runtime.account.getAccessToken({
    caller: driftRuntimeAccountCaller,
    requestedScopes: [],
  });
  const token = String(response.accessToken || '').trim();
  if (!token) {
    throw new Error(
      `Runtime account access token unavailable: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`,
    );
  }
  return token;
}
