import {
  checkNimiRealmAuthEmail,
  createNimiRealmWalletChallenge,
  loginNimiRealmAuthPassword,
  loginNimiRealmOAuth,
  loginNimiRealmWallet,
  requestNimiRealmEmailOtp,
  toNimiRealmAuthUserRecord,
  updateNimiRealmPassword,
  verifyNimiRealmEmailOtp,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/sdk/realm';
import type { WebAccountAuthAdapter } from '@nimiplatform/kit/auth';
import { continueOauthNext } from './oauth-continuation.js';
import { beginTikTokAccountLogin } from './web-provider-link.js';
import { createWebBrowserRealm } from './browser-realm.js';

function rejectBearerResponse(result: NimiRealmOAuthLoginResult): NimiRealmOAuthLoginResult {
  if (result.tokens != null) {
    throw new Error('Realm returned bearer material to the browser-session surface.');
  }
  return result;
}

async function loadCurrentUser(): Promise<Record<string, unknown> | null> {
  try {
    return toNimiRealmAuthUserRecord(await createWebBrowserRealm().me());
  } catch {
    return null;
  }
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r047
export async function clearWebBrowserSessionForFreshAccountSelection(): Promise<void> {
  await createWebBrowserRealm('').auth.logout({ path: {}, body: {} });
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
// @nimi-authority: rule.nimi.sdks.realm-consumer.r047
export function createWebAccountAuthAdapter(): WebAccountAuthAdapter {
  return {
    supportsPasswordLogin: true,
    checkEmail: (email) => checkNimiRealmAuthEmail(createWebBrowserRealm(), email),
    passwordLogin: async (identifier, password) => rejectBearerResponse(
      await loginNimiRealmAuthPassword(createWebBrowserRealm(), identifier, password),
    ),
    requestEmailOtp: (email) => requestNimiRealmEmailOtp(createWebBrowserRealm(), email),
    verifyEmailOtp: async (email, code) => rejectBearerResponse(
      await verifyNimiRealmEmailOtp(createWebBrowserRealm(), email, code),
    ),
    verifyTwoFactor: async (tempToken, code) => {
      const response = await createWebBrowserRealm().auth.verify2Fa({ path: {}, body: { tempToken, code } });
      if (response && typeof response === 'object' && ('accessToken' in response || 'refreshToken' in response)) {
        throw new Error('Realm returned bearer material to the browser-session surface.');
      }
    },
    walletChallenge: (input) => createNimiRealmWalletChallenge(createWebBrowserRealm(), input),
    walletLogin: async (input) => rejectBearerResponse(await loginNimiRealmWallet(createWebBrowserRealm(), input)),
    oauthLogin: async (input) => rejectBearerResponse(await loginNimiRealmOAuth(createWebBrowserRealm(), input)),
    beginSocialOAuth: async () => {
      await beginTikTokAccountLogin(window.location.search);
      return null;
    },
    updatePassword: async (newPassword) => {
      await updateNimiRealmPassword(createWebBrowserRealm(), { newPassword });
    },
    loadCurrentUser,
    completeBrowserSessionLogin: async () => {
      const user = await loadCurrentUser();
      if (user) continueOauthNext(window.location.search);
      return user;
    },
  };
}
