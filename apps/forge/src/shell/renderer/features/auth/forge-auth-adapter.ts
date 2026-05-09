import type { AuthPlatformAdapter } from '@nimiplatform/nimi-kit/auth';
import { getPlatformClient } from '@nimiplatform/sdk';
import { forgeTauriOAuthBridge } from '@renderer/bridge';
import {
  ensureForgeBootstrapReady,
  forgeRuntimeAccountCaller,
  loadForgeRuntimeAccountUser,
} from '@renderer/infra/bootstrap/forge-bootstrap.js';
import type { AuthUser } from '@renderer/app-shell/providers/app-store.js';

const FORGE_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Forge desktop-browser mode.';

const FORGE_TOKEN_PROXY_FORBIDDEN =
  'Forge does not own access/refresh token custody (FG-SHELL-012 / spec K-ACCSVC-008). '
  + 'Runtime is the sole owner — login through the desktop browser broker.';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(FORGE_EMBEDDED_AUTH_UNSUPPORTED));
}

export async function loadForgeCurrentUser(): Promise<AuthUser | null> {
  await ensureForgeBootstrapReady();
  return loadForgeRuntimeAccountUser(getPlatformClient().runtime);
}

export async function logoutForgeRuntimeAccount(): Promise<void> {
  await ensureForgeBootstrapReady();
  await getPlatformClient().runtime.account.logout({
    caller: forgeRuntimeAccountCaller,
    reason: 'forge_logout',
  });
}

/**
 * Adapter for the kit's `<DesktopShellAuthPage>` in Forge desktop-browser mode.
 * Account / session truth is owned by RuntimeAccountService; this adapter
 * intentionally rejects every app-owned token surface (FG-SHELL-012) so a
 * regression that tries to flow a bearer or refresh token through the kit
 * fails fast.
 */
export function createForgeDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
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
    loadCurrentUser: loadForgeCurrentUser,
    applyToken: async () => {
      throw new Error(FORGE_TOKEN_PROXY_FORBIDDEN);
    },
    persistSession: async () => {
      throw new Error(FORGE_TOKEN_PROXY_FORBIDDEN);
    },
    clearPersistedSession: async () => {
      await logoutForgeRuntimeAccount();
    },
    oauthBridge: forgeTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}

/**
 * RuntimeAccountService browser broker for Forge desktop login. Pairs with
 * the kit's `performDesktopWebAuth` direct-to-loopback flow:
 *
 * - Runtime BeginLogin returns a fully-formed realm OAuth authorize URL with a
 *   PKCE S256 challenge bound to a runtime-held verifier.
 * - On user consent, the realm authorize endpoint 302-redirects directly to
 *   the Forge desktop loopback redirect_uri with a raw OAuth `code`.
 * - Runtime CompleteLogin exchanges the code with the realm token endpoint
 *   and projects account material into runtime custody.
 *
 * The kit / Forge renderer never observes access tokens or refresh tokens at
 * any stage of this flow (R-OAUTH-008 / spec K-ACCSVC-008).
 */
export function createForgeRuntimeAccountBrowserBroker() {
  return {
    begin: async (input: { callbackUrl: string; baseUrl?: string; timeoutMs: number }) => {
      await ensureForgeBootstrapReady();
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: forgeRuntimeAccountCaller,
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
        // FG-SHELL-011 / R-OAUTH / K-ACCSVC-008: realm OAuth authorize URL is
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
      await ensureForgeBootstrapReady();
      // FG-SHELL-012 / R-OAUTH / K-ACCSVC-008: code-only proof envelope;
      // runtime owns the token exchange and refresh-token custody.
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: forgeRuntimeAccountCaller,
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
