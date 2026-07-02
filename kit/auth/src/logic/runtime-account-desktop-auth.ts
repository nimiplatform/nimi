import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import type { ShellAuthDesktopBrowserAuth } from '../types/auth-types.js';
import {
  createRuntimeAccountBrowserBroker,
  type CreateRuntimeAccountBrowserBrokerInput,
  type RuntimeAccountBrowserBrokerClient,
} from './runtime-account-browser-broker.js';

export type RuntimeAccountDesktopBrowserAuthCaller = CreateRuntimeAccountBrowserBrokerInput['caller'];

export type RuntimeAccountDesktopBrowserAuthProjection = {
  readonly accountId?: string | null;
  readonly displayName?: string | null;
  readonly realmEnvironmentId?: string | null;
};

export type RuntimeAccountDesktopBrowserAuthUser = {
  readonly id: string;
  readonly displayName?: string;
  readonly realmEnvironmentId?: string;
};

export type RuntimeAccountDesktopBrowserAuthClient = RuntimeAccountBrowserBrokerClient & {
  readonly runtime: RuntimeAccountBrowserBrokerClient['runtime'] & {
    readonly account: RuntimeAccountBrowserBrokerClient['runtime']['account'] & {
      readonly getAccountSessionStatus: (input: {
        readonly caller: RuntimeAccountDesktopBrowserAuthCaller;
      }) => Promise<{
        readonly state: unknown;
        readonly accountProjection?: RuntimeAccountDesktopBrowserAuthProjection | null;
      }>;
      readonly logout: (input: {
        readonly caller: RuntimeAccountDesktopBrowserAuthCaller;
        readonly reason: string;
      }) => Promise<{
        readonly accepted?: boolean;
        readonly reasonCode?: unknown;
        readonly accountReasonCode?: unknown;
      }>;
    };
  };
};

export type RuntimeAccountDesktopBrowserAuthInput<Client extends RuntimeAccountDesktopBrowserAuthClient> = {
  readonly caller: RuntimeAccountDesktopBrowserAuthCaller;
  readonly getClient: () => Client;
  readonly isAuthenticatedState: (state: unknown) => boolean;
  readonly loginEnabled?: boolean;
  readonly disabledMessage?: string;
  readonly logoutReason: string;
  readonly requestedScopes?: readonly string[];
  readonly beforeRequest?: () => Promise<void> | void;
  readonly projectUser?: (projection: RuntimeAccountDesktopBrowserAuthProjection) => RuntimeAccountDesktopBrowserAuthUser | null;
  readonly userDisplayFallback?: string;
};

export type RuntimeAccountDesktopBrowserAuth = {
  readonly loadCurrentUser: () => Promise<RuntimeAccountDesktopBrowserAuthUser | null>;
  readonly logout: () => Promise<void>;
  readonly createRuntimeAccountBroker: () => ShellAuthDesktopBrowserAuth['runtimeAccountBroker'];
  readonly createDesktopBrowserAuthAdapter: (
    onLoginComplete: () => void | Promise<void>,
  ) => AuthPlatformAdapter;
};

const DEFAULT_DISABLED_MESSAGE = 'Runtime account browser login is not enabled for this app identity.';
const DEFAULT_USER_DISPLAY_FALLBACK = 'Runtime account';
const TOKEN_CUSTODY_ERROR = 'This shell uses Runtime account browser login only; app-owned credential login is forbidden.';

export function createRuntimeAccountDesktopBrowserAuth<Client extends RuntimeAccountDesktopBrowserAuthClient>(
  input: RuntimeAccountDesktopBrowserAuthInput<Client>,
): RuntimeAccountDesktopBrowserAuth {
  const loginEnabled = input.loginEnabled !== false;

  function requireRuntimeAccountLogin(): void {
    if (!loginEnabled) {
      throw new Error(input.disabledMessage || DEFAULT_DISABLED_MESSAGE);
    }
  }

  function projectUser(
    projection: RuntimeAccountDesktopBrowserAuthProjection | null | undefined,
  ): RuntimeAccountDesktopBrowserAuthUser | null {
    const custom = projection ? input.projectUser?.(projection) : undefined;
    if (custom !== undefined) {
      return custom;
    }
    const accountId = normalizeText(projection?.accountId);
    if (!accountId) {
      return null;
    }
    const displayName = normalizeText(projection?.displayName) || input.userDisplayFallback || DEFAULT_USER_DISPLAY_FALLBACK;
    const realmEnvironmentId = normalizeText(projection?.realmEnvironmentId);
    return {
      id: accountId,
      ...(displayName ? { displayName } : {}),
      ...(realmEnvironmentId ? { realmEnvironmentId } : {}),
    };
  }

  async function loadCurrentUser(): Promise<RuntimeAccountDesktopBrowserAuthUser | null> {
    if (!loginEnabled) {
      return null;
    }
    const response = await input.getClient().runtime.account.getAccountSessionStatus({
      caller: input.caller,
    });
    if (!input.isAuthenticatedState(response.state)) {
      return null;
    }
    return projectUser(response.accountProjection);
  }

  async function logout(): Promise<void> {
    requireRuntimeAccountLogin();
    const response = await input.getClient().runtime.account.logout({
      caller: input.caller,
      reason: input.logoutReason,
    });
    if (!response.accepted) {
      throw new Error(
        `Runtime account logout rejected: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`,
      );
    }
  }

  function createRuntimeAccountBroker(): ShellAuthDesktopBrowserAuth['runtimeAccountBroker'] {
    return createRuntimeAccountBrowserBroker({
      caller: input.caller,
      beforeRequest: () => {
        requireRuntimeAccountLogin();
        return input.beforeRequest?.();
      },
      getClient: input.getClient,
      requestedScopes: input.requestedScopes,
      projectUser,
    });
  }

  function createDesktopBrowserAuthAdapter(
    onLoginComplete: () => void | Promise<void>,
  ): AuthPlatformAdapter {
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
        throw new Error('Generated Nimi App shell must not own access or refresh token custody.');
      },
      persistSession: async () => {
        throw new Error('Generated Nimi App shell must not persist access or refresh tokens.');
      },
      clearPersistedSession: logout,
      syncAfterLogin: async () => {},
      onLoginComplete: async () => {
        await onLoginComplete();
      },
    };
  }

  return {
    loadCurrentUser,
    logout,
    createRuntimeAccountBroker,
    createDesktopBrowserAuthAdapter,
  };
}

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(TOKEN_CUSTODY_ERROR));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
