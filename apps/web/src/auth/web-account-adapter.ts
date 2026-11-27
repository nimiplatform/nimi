import {
  checkNimiRealmAuthEmail,
  loginNimiRealmAuthPassword,
  loginNimiRealmOAuth,
  requestNimiRealmEmailOtp,
  isNimiRealmExpectedAnonymousSessionError,
  toNimiRealmAuthUserRecord,
  updateNimiRealmPassword,
  verifyNimiRealmEmailOtp,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/sdk/realm';
import { ReasonCode, createNimiError } from '@nimiplatform/sdk/types';
import type { WebAccountAuthAdapter } from '@nimiplatform/kit/auth';
import { continueOauthNext } from './oauth-continuation.js';
import { beginTikTokAccountLogin, getWebGoogleClientId } from './web-provider-link.js';
import { BROWSER_SESSION_RESPONSE, runWebBrowserSessionLogin, createWebBrowserRealm, readWebBrowserAccount } from './browser-realm.js';

function rejectBearerResponse(result: NimiRealmOAuthLoginResult): NimiRealmOAuthLoginResult {
  if (result.tokens != null) {
    throw createNimiError({
      message: 'Realm returned bearer material to the browser-session surface.',
      reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
      actionHint: 'check_realm_auth_response',
      source: 'sdk',
    });
  }
  return result;
}

export async function loadWebCurrentAccount(
  load: () => Promise<unknown> = readWebBrowserAccount,
): Promise<Record<string, unknown> | null> {
  try {
    const user = toNimiRealmAuthUserRecord(await load());
    if (!user) {
      throw createNimiError({
        message: 'Realm current-account response is malformed.',
        reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
        actionHint: 'check_realm_auth_response',
        source: 'sdk',
      });
    }
    return user;
  } catch (error) {
    if (isNimiRealmExpectedAnonymousSessionError(error)) {
      return null;
    }
    throw error;
  }
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r047
export async function clearWebBrowserSessionForFreshAccountSelection(): Promise<void> {
  await createWebBrowserRealm('').auth.logout({ path: {}, body: {} });
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
// @nimi-authority: rule.nimi.sdks.realm-consumer.r047
export function createWebAccountAuthAdapter(
  onAuthenticationError?: (error: unknown) => void,
  beforeAuthentication?: () => void | Promise<void>,
): WebAccountAuthAdapter {
  const observe = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      await beforeAuthentication?.();
      return await work();
    } catch (error) {
      onAuthenticationError?.(error);
      throw error;
    }
  };
  return {
    supportsPasswordLogin: true,
    googleClientId: getWebGoogleClientId(),
    checkEmail: (email) => checkNimiRealmAuthEmail(createWebBrowserRealm(), email),
    passwordLogin: async (identifier, password) => observe(() => runWebBrowserSessionLogin(async realm => rejectBearerResponse(
      await loginNimiRealmAuthPassword(realm, identifier, password, BROWSER_SESSION_RESPONSE),
    ))),
    requestEmailOtp: (email) => observe(() => requestNimiRealmEmailOtp(createWebBrowserRealm(), email)),
    verifyEmailOtp: async (email, code) => observe(() => runWebBrowserSessionLogin(async realm => rejectBearerResponse(
      await verifyNimiRealmEmailOtp(realm, email, code, BROWSER_SESSION_RESPONSE),
    ))),
    verifyTwoFactor: async (tempToken, code) => observe(() => runWebBrowserSessionLogin(async realm => {
      const response = await realm.auth.verify2Fa({ path: {}, body: { tempToken, code } }, BROWSER_SESSION_RESPONSE);
      if (response && typeof response === 'object' && ('accessToken' in response || 'refreshToken' in response)) {
        throw new Error('Realm returned bearer material to the browser-session surface.');
      }
    })),
    oauthLogin: async (input) => observe(() => runWebBrowserSessionLogin(async realm => rejectBearerResponse(
      await loginNimiRealmOAuth(realm, input, BROWSER_SESSION_RESPONSE),
    ))),
    beginSocialOAuth: () => observe(async () => {
      await beginTikTokAccountLogin(window.location.search);
      return null;
    }),
    updatePassword: async (newPassword) => {
      await updateNimiRealmPassword(createWebBrowserRealm(), { newPassword });
    },
    loadCurrentUser: loadWebCurrentAccount,
    completeBrowserSessionLogin: async () => {
      const user = await loadWebCurrentAccount();
      if (user) continueOauthNext(window.location.search);
      return user;
    },
  };
}
