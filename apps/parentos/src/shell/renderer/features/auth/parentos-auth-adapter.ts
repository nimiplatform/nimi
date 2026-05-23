import type { AuthPlatformAdapter } from '@nimiplatform/nimi-kit/auth';
import { getPlatformClient } from '@nimiplatform/sdk';
import { parentosTauriOAuthBridge } from '../../bridge/index.js';
import {
  ensureParentOSRuntimeClientReady,
  loadParentOSRuntimeAccountUser,
  parentosRuntimeAccountCaller,
  type ParentOSAuthUser,
} from '../../infra/parentos-bootstrap.js';

const PARENTOS_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in ParentOS desktop-browser mode.';

const PARENTOS_TOKEN_PROXY_FORBIDDEN =
  'ParentOS does not own access/refresh token custody (PO-SHELL-008 / spec K-ACCSVC-008). '
  + 'Runtime is the sole owner — login through the desktop browser broker.';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(PARENTOS_EMBEDDED_AUTH_UNSUPPORTED));
}

export async function loadCurrentUser(): Promise<ParentOSAuthUser | null> {
  await ensureParentOSRuntimeClientReady();
  return loadParentOSRuntimeAccountUser(getPlatformClient().runtime);
}

export async function logoutParentOSRuntimeAccount(): Promise<void> {
  await ensureParentOSRuntimeClientReady();
  await getPlatformClient().runtime.account.logout({
    caller: parentosRuntimeAccountCaller,
    reason: 'parentos_logout',
  });
}

/**
 * Adapter for the kit's `<DesktopShellAuthPage>` in ParentOS desktop-browser
 * mode. Account/session truth is owned by RuntimeAccountService; this adapter
 * intentionally rejects every app-owned token surface so a regression that
 * tries to flow a bearer or refresh token through the kit fails fast.
 */
export function createParentOSDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser,
    applyToken: async () => {
      throw new Error(PARENTOS_TOKEN_PROXY_FORBIDDEN);
    },
    persistSession: async () => {
      throw new Error(PARENTOS_TOKEN_PROXY_FORBIDDEN);
    },
    clearPersistedSession: async () => {
      await logoutParentOSRuntimeAccount();
    },
    oauthBridge: parentosTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}

/**
 * RuntimeAccountService browser broker for ParentOS desktop login. Pairs with
 * the kit's `performDesktopWebAuth` direct-to-loopback flow (Wave A1/A2):
 * runtime BeginLogin returns a fully-formed realm OAuth authorize URL with
 * PKCE S256 challenge bound to runtime-held verifier; on user consent the
 * realm 302-redirects directly to the desktop loopback redirect_uri with a
 * raw OAuth `code`; runtime CompleteLogin exchanges the code with the realm
 * token endpoint and projects account material into runtime custody.
 *
 * The kit/desktop never observes access tokens or refresh tokens at any
 * stage of this flow (R-OAUTH-008 / K-ACCSVC-008).
 */
export function createParentOSRuntimeAccountBrowserBroker() {
  return {
    begin: async (input: { callbackUrl: string; baseUrl?: string; timeoutMs: number }) => {
      await ensureParentOSRuntimeClientReady();
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: parentosRuntimeAccountCaller,
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
        // R-OAUTH / K-ACCSVC-008: use the realm OAuth authorize URL constructed
        // by runtime (PKCE S256 challenge bound to runtime-held verifier).
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
      await ensureParentOSRuntimeClientReady();
      // R-OAUTH / K-ACCSVC-008: code-only proof envelope; runtime owns the
      // token exchange and refresh-token custody.
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: parentosRuntimeAccountCaller,
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
