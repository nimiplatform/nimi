import type { ShellAuthDesktopBrowserAuthRuntimeBroker } from '../types/auth-types.js';
import { validateRuntimeOAuthAuthorizationUrl } from './desktop-web-auth.js';

type RuntimeAccountCaller = Record<string, unknown>;

type RuntimeAccountProjection = {
  accountId?: string | null;
  displayName?: string | null;
  realmEnvironmentId?: string | null;
};

type RuntimeAccountBeginLoginResponse = {
  accepted?: boolean;
  loginAttemptId?: string | null;
  oauthAuthorizationUrl?: string | null;
  state?: string | null;
  nonce?: string | null;
  accountReasonCode?: string | null;
  reasonCode?: string | null;
};

type RuntimeAccountCompleteLoginResponse = {
  accepted?: boolean;
  accountProjection?: RuntimeAccountProjection | null;
  accountReasonCode?: string | null;
  reasonCode?: string | null;
};

export type RuntimeAccountBrowserBrokerClient = {
  runtime: {
    account: {
      beginLogin: (input: {
        caller: RuntimeAccountCaller;
        redirectUri: string;
        callbackOrigin: string;
        requestedScopes: string[];
        ttlSeconds: number;
      }) => Promise<RuntimeAccountBeginLoginResponse>;
      completeLogin: (input: {
        caller: RuntimeAccountCaller;
        loginAttemptId: string;
        code: string;
        refreshToken: '';
        state: string;
        nonce: string;
        redirectUri: string;
        callbackOrigin: string;
        uxTraceId: string;
        sealedCompletionTicket: string;
      }) => Promise<RuntimeAccountCompleteLoginResponse>;
    };
  };
};

export type CreateRuntimeAccountBrowserBrokerInput = {
  caller: RuntimeAccountCaller;
  getClient: () => RuntimeAccountBrowserBrokerClient;
  beforeRequest?: () => Promise<void> | void;
  requestedScopes?: readonly string[];
  projectUser?: (projection: RuntimeAccountProjection) => Record<string, unknown> | null;
};

function normalizeReason(response: { accountReasonCode?: string | null; reasonCode?: string | null }): string {
  return String(response.accountReasonCode || response.reasonCode || 'unknown');
}

function defaultProjectUser(projection: RuntimeAccountProjection): Record<string, unknown> | null {
  const accountId = String(projection.accountId || '').trim();
  if (!accountId) {
    return null;
  }
  const displayName = String(projection.displayName || '').trim();
  const realmEnvironmentId = String(projection.realmEnvironmentId || '').trim();
  return {
    id: accountId,
    ...(displayName ? { displayName } : {}),
    ...(realmEnvironmentId ? { realmEnvironmentId } : {}),
  };
}

/**
 * Shared RuntimeAccountService desktop-browser login broker.
 *
 * Kit owns the OAuth/runtime-account handshake shape: consume the runtime-built
 * authorize URL verbatim, pass only the loopback OAuth code to Runtime, and
 * keep refresh-token custody out of app renderers. Apps provide only their
 * caller identity and platform client.
 */
export function createRuntimeAccountBrowserBroker(
  input: CreateRuntimeAccountBrowserBrokerInput,
): ShellAuthDesktopBrowserAuthRuntimeBroker {
  const projectUser = input.projectUser || defaultProjectUser;
  const requestedScopes = [...new Set((input.requestedScopes || []).map((scope) => String(scope).trim()).filter(Boolean))];

  return {
    begin: async (request) => {
      await input.beforeRequest?.();
      const response = await input.getClient().runtime.account.beginLogin({
        caller: input.caller,
        redirectUri: request.callbackUrl,
        callbackOrigin: new URL(request.callbackUrl).origin,
        requestedScopes,
        ttlSeconds: Math.max(10, Math.ceil(request.timeoutMs / 1000)),
      });
      if (!response.accepted || !response.loginAttemptId || !response.oauthAuthorizationUrl || !response.state || !response.nonce) {
        throw new Error(`Runtime account login could not start: ${normalizeReason(response)}`);
      }
      return {
        loginAttemptId: response.loginAttemptId,
        authorizationUrl: validateRuntimeOAuthAuthorizationUrl(response.oauthAuthorizationUrl),
        state: response.state,
        nonce: response.nonce,
      };
    },
    complete: async (request) => {
      await input.beforeRequest?.();
      const response = await input.getClient().runtime.account.completeLogin({
        caller: input.caller,
        loginAttemptId: request.loginAttemptId,
        code: request.code,
        refreshToken: '',
        state: request.state,
        nonce: request.nonce,
        redirectUri: request.callbackUrl,
        callbackOrigin: new URL(request.callbackUrl).origin,
        uxTraceId: '',
        sealedCompletionTicket: '',
      });
      if (!response.accepted) {
        throw new Error(`Runtime account login could not complete: ${normalizeReason(response)}`);
      }
      return {
        user: response.accountProjection ? projectUser(response.accountProjection) : null,
      };
    },
  };
}
