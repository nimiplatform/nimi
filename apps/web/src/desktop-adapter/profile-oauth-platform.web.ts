import type { ShellAuthWindow } from '@nimiplatform/kit/auth/shell';
import {
  getGoogleClientId,
  loadGoogleScript,
  resolveSocialOauthConfig,
  startSocialOauth,
} from '@nimiplatform/kit/auth';
import {
  linkNimiRealmOAuth,
  NIMI_REALM_OAUTH_PROVIDER,
  unlinkNimiRealmOAuth,
  type NimiRealmOAuthProvider,
} from '@nimiplatform/sdk/realm';
import { desktopOAuthBridge } from '@renderer/features/auth/desktop-auth-adapter.js';
import { getDesktopRealm } from '@renderer/infra/sdk/desktop-nimi-client-session';

async function requestGoogleAccessToken(): Promise<string> {
  const clientId = String(getGoogleClientId() || '').trim();
  if (!clientId) throw new Error('Missing Google OAuth client ID');
  await loadGoogleScript();
  const win = window as ShellAuthWindow;
  const initTokenClient = win.google?.accounts?.oauth2?.initTokenClient;
  if (!initTokenClient) throw new Error('Google OAuth is unavailable');
  return new Promise((resolve, reject) => {
    const tokenClient = initTokenClient({
      client_id: clientId,
      scope: 'email profile openid',
      callback: (response: { access_token?: string }) => {
        const value = String(response?.access_token || '').trim();
        if (value) resolve(value);
        else reject(new Error('Google OAuth did not return an access token'));
      },
    });
    tokenClient.requestAccessToken();
  });
}

async function resolveProviderAccessToken(provider: NimiRealmOAuthProvider): Promise<string> {
  if (provider === NIMI_REALM_OAUTH_PROVIDER.GOOGLE) return requestGoogleAccessToken();
  if (provider === NIMI_REALM_OAUTH_PROVIDER.TWITTER) return (await startSocialOauth('TWITTER', desktopOAuthBridge)).accessToken;
  if (provider === NIMI_REALM_OAUTH_PROVIDER.TIKTOK) return (await startSocialOauth('TIKTOK', desktopOAuthBridge)).accessToken;
  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

export const profileOauthPlatform = {
  availability(provider: NimiRealmOAuthProvider) {
    if (provider === NIMI_REALM_OAUTH_PROVIDER.GOOGLE) {
      const enabled = Boolean(String(getGoogleClientId() || '').trim());
      return { enabled, disabledReason: enabled ? '' : 'Missing Google OAuth client ID' };
    }
    const name = provider === NIMI_REALM_OAUTH_PROVIDER.TWITTER ? 'TWITTER' : 'TIKTOK';
    const config = resolveSocialOauthConfig(name, desktopOAuthBridge);
    return { enabled: config.enabled, disabledReason: config.enabled ? '' : config.disabledReason };
  },
  async linkProvider(provider: NimiRealmOAuthProvider): Promise<void> {
    const accessToken = await resolveProviderAccessToken(provider);
    await linkNimiRealmOAuth(getDesktopRealm(), provider, accessToken);
  },
  async unlinkProvider(provider: NimiRealmOAuthProvider): Promise<void> {
    await unlinkNimiRealmOAuth(getDesktopRealm(), provider);
  },
};
