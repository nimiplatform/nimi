// ---------------------------------------------------------------------------
// Generic OAuth login handler for Forge / Overtone
// ---------------------------------------------------------------------------

import type { TauriOAuthBridge } from './oauth-types.js';
import type { SocialOauthProvider } from './social-oauth.js';
import { startSocialOauth, toOauthProvider } from './social-oauth.js';
import { toErrorMessage } from './oauth-helpers.js';

export type OAuthLoginInput = {
  provider: SocialOauthProvider;
  bridge: TauriOAuthBridge;
  realmRequest: (
    method: string,
    path: string,
    body: unknown,
  ) => Promise<Record<string, unknown>>;
  onSuccess: (result: {
    accessToken: string;
    refreshToken: string;
    user: Record<string, unknown>;
  }) => void;
  onError: (message: string) => void;
};

export async function handleSocialLogin(input: OAuthLoginInput): Promise<void> {
  const providerLabel = input.provider === 'TWITTER' ? 'Twitter' : 'TikTok';
  try {
    const oauthResult = await startSocialOauth(input.provider, input.bridge);

    const data = await input.realmRequest('POST', '/api/auth/oauth/login', {
      provider: toOauthProvider(oauthResult.provider),
      accessToken: oauthResult.accessToken,
    });

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

    const user = (tokens.user && typeof tokens.user === 'object' && !Array.isArray(tokens.user))
      ? tokens.user as Record<string, unknown>
      : {};

    input.onSuccess({
      accessToken: String(tokens.accessToken || ''),
      refreshToken: String(tokens.refreshToken || ''),
      user,
    });
  } catch (error) {
    input.onError(toErrorMessage(error, `${providerLabel} login failed`));
  }
}
