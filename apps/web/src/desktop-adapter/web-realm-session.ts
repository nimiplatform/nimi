import {
  Realm,
  createRealmFetchTransport,
  loginNimiRealmAuthPassword,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/sdk/realm';
import type { CoreMetadata } from '@nimiplatform/sdk/types';
import { readFreshOauthLoginState } from '@renderer/features/auth/oauth-next-continuation.js';
import {
  clearDesktopNimiClientSession,
  installRealmProjectionSession,
  isDesktopNimiClientSessionReady,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

export type WebRealmFetch = typeof fetch;

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

export async function loginFreshOauthPasswordWithBrowserSession(input: {
  realmBaseUrl: string;
  identifier: string;
  password: string;
  fetchImpl?: WebRealmFetch;
}): Promise<NimiRealmOAuthLoginResult> {
  const realm = new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.realmBaseUrl,
      fetch: input.fetchImpl,
      credentials: 'include',
    }),
  });
  return loginNimiRealmAuthPassword(realm, input.identifier, input.password);
}
