import type { NimiRealmOAuthLoginResult } from '@nimiplatform/sdk/realm';
import {
  loginDesktopRealmPasswordWithBrowserSession,
  type DesktopNimiRealmFetch,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import { readFreshOauthLoginState } from './oauth-next-continuation.js';

export function shouldUseFreshOauthBrowserSessionLogin(search: string): boolean {
  return readFreshOauthLoginState(search) !== null;
}

export async function loginFreshOauthPasswordWithBrowserSession(input: {
  realmBaseUrl: string;
  identifier: string;
  password: string;
  fetchImpl?: DesktopNimiRealmFetch;
}): Promise<NimiRealmOAuthLoginResult> {
  return loginDesktopRealmPasswordWithBrowserSession({
    realmBaseUrl: input.realmBaseUrl,
    identifier: input.identifier,
    password: input.password,
    fetchImpl: input.fetchImpl,
  });
}
