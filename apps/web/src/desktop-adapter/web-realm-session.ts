import {
  Realm,
  createRealmFetchTransport,
  loginNimiRealmAuthPassword,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/sdk/realm';
import type { CoreMetadata } from '@nimiplatform/sdk/types';
import {
  continueOauthNextIfPresent,
  readFreshOauthLoginState,
  readValidatedOauthNext,
} from '@renderer/features/auth/oauth-next-continuation.js';
import {
  clearDesktopNimiClientSession,
  installRealmProjectionSession,
  isDesktopNimiClientSessionReady,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

export type WebRealmFetch = typeof fetch;
const AUTH_RESPONSE_HEADER = 'x-nimi-auth-response';
const BROWSER_SESSION_AUTH_RESPONSE = 'browser-session';

export interface WebAuthUserRecord {
  readonly [key: string]: unknown;
  readonly id?: unknown;
  readonly accountId?: unknown;
  readonly subjectId?: unknown;
  readonly sub?: unknown;
}

export function isWebRealmPlatformClientReady(): boolean {
  return isDesktopNimiClientSessionReady();
}

export function clearWebRealmPlatformClient(): void {
  clearDesktopNimiClientSession();
}

export async function configureWebRealmPlatformClient(input: {
  appId?: string;
  realmBaseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  fetchImpl?: WebRealmFetch | null;
  getCurrentUser?: () => WebAuthUserRecord | null;
  setAuthSession?: (
    user: WebAuthUserRecord | null,
    accessToken: string,
  ) => void | Promise<void>;
  clearAuthSession?: () => void | Promise<void>;
}) {
  clearDesktopNimiClientSession();
  const currentAccessToken = String(input.accessToken || '').trim();
  const realm = new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.realmBaseUrl,
      fetch: input.fetchImpl || undefined,
      headers: (): CoreMetadata => currentAccessToken
        ? { authorization: `Bearer ${currentAccessToken}` }
        : {},
    }),
  });
  return installRealmProjectionSession({
    appId: input.appId || 'nimi.web',
    realm,
  });
}

export function shouldUseFreshOauthBrowserSessionLogin(search: string): boolean {
  return readFreshOauthLoginState(search) !== null;
}

function createFreshOauthBrowserRealm(input: { search: string; fetchImpl?: WebRealmFetch }): Realm {
  const oauthNext = readValidatedOauthNext(input.search);
  if (!readFreshOauthLoginState(input.search) || !oauthNext) {
    throw new Error('Fresh OAuth continuation is invalid');
  }
  return new Realm({
    transport: createRealmFetchTransport({
      baseUrl: new URL(oauthNext).origin,
      fetch: input.fetchImpl,
      credentials: 'include',
      headers: { [AUTH_RESPONSE_HEADER]: BROWSER_SESSION_AUTH_RESPONSE },
    }),
  });
}

export async function callFreshOauthBrowserSession<T>(input: {
  search: string;
  fetchImpl?: WebRealmFetch;
  call: (realm: Realm) => Promise<T>;
}): Promise<T> {
  return input.call(createFreshOauthBrowserRealm(input));
}

export async function loginFreshOauthPasswordWithBrowserSession(input: {
  search: string;
  identifier: string;
  password: string;
  fetchImpl?: WebRealmFetch;
}): Promise<NimiRealmOAuthLoginResult> {
  return callFreshOauthBrowserSession({
    ...input,
    call: (realm) => loginNimiRealmAuthPassword(realm, input.identifier, input.password),
  });
}

export async function verifyFreshOauthTwoFactorWithBrowserSession(input: {
  search: string;
  tempToken: string;
  code: string;
  fetchImpl?: WebRealmFetch;
}): Promise<void> {
  await callFreshOauthBrowserSession({
    ...input,
    call: async (realm) => {
      await realm.auth.verify2Fa({
        path: {},
        body: { tempToken: input.tempToken, code: input.code },
      });
    },
  });
}

export function continueFreshOauthBrowserSession(search: string): boolean {
  if (!shouldUseFreshOauthBrowserSessionLogin(search)) {
    return false;
  }
  return continueOauthNextIfPresent(search);
}
