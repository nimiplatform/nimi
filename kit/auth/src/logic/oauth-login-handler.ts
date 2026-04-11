// ---------------------------------------------------------------------------
// Generic OAuth login handler
// ---------------------------------------------------------------------------

import type { TauriOAuthBridge } from '@nimiplatform/nimi-kit/core/oauth';
import type { SocialOauthProvider } from './social-oauth.js';
import { resolveProviderLabel, startSocialOauth } from './social-oauth.js';
import { toErrorMessage } from './oauth-helpers.js';

export type OAuthLoginInput = {
  provider: SocialOauthProvider;
  bridge: TauriOAuthBridge;
  oauthLogin: (provider: string, accessToken: string) => Promise<Record<string, unknown>>;
  onSuccess: (result: {
    accessToken: string;
    refreshToken?: string;
    user: Record<string, unknown>;
  }) => void;
  onError: (message: string) => void;
};

export async function handleSocialLogin(input: OAuthLoginInput): Promise<void> {
  const providerLabel = resolveProviderLabel(input.provider);
  try {
    const oauthResult = await startSocialOauth(input.provider, input.bridge);

    const data = await input.oauthLogin(
      oauthResult.provider,
      oauthResult.accessToken,
    );

    const loginState = String(data.loginState || '');
    if (loginState === 'blocked') {
      input.onError(String(data.blockedReason || 'Account is blocked'));
      return;
    }

    const tokens = data.tokens as Record<string, unknown> | undefined;
    if (!tokens?.accessToken) {
      input.onError(`${providerLabel} login failed: missing tokens`);
      return;
    }

    const rawUser = (data.user && typeof data.user === 'object' && !Array.isArray(data.user))
      ? data.user
      : tokens.user;
    const user = (rawUser && typeof rawUser === 'object' && !Array.isArray(rawUser))
      ? rawUser as Record<string, unknown>
      : {};
    const refreshToken = typeof tokens.refreshToken === 'string' && tokens.refreshToken.trim()
      ? tokens.refreshToken.trim()
      : undefined;

    input.onSuccess({
      accessToken: String(tokens.accessToken || ''),
      refreshToken,
      user,
    });
  } catch (error) {
    input.onError(toErrorMessage(error, `${providerLabel} login failed`));
  }
}
