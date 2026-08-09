import {
  getGoogleClientId,
  requestGoogleIdToken,
  resolveSocialOauthConfig,
  startSocialOauth,
} from '@nimiplatform/kit/auth';
import {
  linkNimiRealmOAuth,
  NIMI_REALM_OAUTH_PROVIDER,
  unlinkNimiRealmOAuth,
  type NimiRealmOAuthLoginInput,
  type NimiRealmOAuthProvider,
} from '@nimiplatform/sdk/realm';
import { desktopOAuthBridge } from '@renderer/features/auth/desktop-auth-adapter.js';
import { getDesktopRealm } from '@renderer/infra/sdk/desktop-nimi-client-session';

async function requestGoogleCredential(): Promise<NimiRealmOAuthLoginInput> {
  const clientId = String(getGoogleClientId() || '').trim();
  if (!clientId) throw new Error('Missing Google OAuth client ID');
  return {
    provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE,
    idToken: await requestGoogleIdToken(clientId),
  };
}

async function resolveProviderCredential(provider: NimiRealmOAuthProvider): Promise<NimiRealmOAuthLoginInput> {
  if (provider === NIMI_REALM_OAUTH_PROVIDER.GOOGLE) return requestGoogleCredential();
  if (provider === NIMI_REALM_OAUTH_PROVIDER.TIKTOK) return startSocialOauth('TIKTOK', desktopOAuthBridge);
  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

export const profileOauthPlatform = {
  availability(provider: NimiRealmOAuthProvider) {
    if (provider === NIMI_REALM_OAUTH_PROVIDER.GOOGLE) {
      const enabled = Boolean(String(getGoogleClientId() || '').trim());
      return { enabled, disabledReason: enabled ? '' : 'Missing Google OAuth client ID' };
    }
    const config = resolveSocialOauthConfig('TIKTOK', desktopOAuthBridge);
    return { enabled: config.enabled, disabledReason: config.enabled ? '' : config.disabledReason };
  },
  async linkProvider(provider: NimiRealmOAuthProvider): Promise<void> {
    const credential = await resolveProviderCredential(provider);
    await linkNimiRealmOAuth(getDesktopRealm(), credential);
  },
  async unlinkProvider(provider: NimiRealmOAuthProvider): Promise<void> {
    await unlinkNimiRealmOAuth(getDesktopRealm(), provider);
  },
};
