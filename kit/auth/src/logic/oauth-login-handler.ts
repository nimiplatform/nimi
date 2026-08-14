// ---------------------------------------------------------------------------
// Generic OAuth login handler
// ---------------------------------------------------------------------------

import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';
import {
  NIMI_REALM_OAUTH_LOGIN_STATE,
  ReasonCode,
  createNimiError,
  normalizeNimiRealmOAuthLoginResult,
  toNimiRealmAuthUserRecord,
  type NimiRealmOAuthLoginInput,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/kit/core/sdk-contract';
import type { SocialOauthProvider } from './social-oauth.js';
import { resolveProviderLabel, startSocialOauth } from './social-oauth.js';
import { toErrorMessage } from './oauth-helpers.js';

export type OAuthLoginInput = {
  provider: SocialOauthProvider;
  bridge: ShellOAuthCodeBridge;
  oauthLogin: (input: NimiRealmOAuthLoginInput) => Promise<Pick<
    NimiRealmOAuthLoginResult,
    'loginState' | 'blockedReason' | 'tempToken'
  >>;
  completeBrowserSessionLogin: () => Promise<Record<string, unknown> | null>;
  onSuccess: () => void | Promise<void>;
  onError: (message: string) => void;
};

function browserSessionContractError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
    actionHint: 'check_realm_auth_response',
    source: 'sdk',
  });
}

function hasBearerMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.tokens != null
    || 'accessToken' in record
    || 'refreshToken' in record
    || 'authorization' in record;
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
export async function handleSocialLogin(input: OAuthLoginInput): Promise<void> {
  const providerLabel = resolveProviderLabel(input.provider);
  try {
    const oauthResult = await startSocialOauth(input.provider, input.bridge);
    const rawResult = await input.oauthLogin(oauthResult);
    if (hasBearerMaterial(rawResult)) {
      throw browserSessionContractError(
        'Realm social OAuth returned bearer material to the browser-session surface.',
      );
    }
    const result = normalizeNimiRealmOAuthLoginResult(rawResult);

    if (result.loginState === NIMI_REALM_OAUTH_LOGIN_STATE.BLOCKED) {
      input.onError(String(result.blockedReason || 'Account is blocked'));
      return;
    }
    if (
      result.loginState !== NIMI_REALM_OAUTH_LOGIN_STATE.OK
      && result.loginState !== NIMI_REALM_OAUTH_LOGIN_STATE.NEEDS_ONBOARDING
    ) {
      throw browserSessionContractError(
        'Realm social OAuth did not establish a browser session.',
      );
    }

    const currentUserResult = await input.completeBrowserSessionLogin();
    if (hasBearerMaterial(currentUserResult) || !toNimiRealmAuthUserRecord(currentUserResult)) {
      throw browserSessionContractError(
        'Realm did not confirm the browser session with a current user.',
      );
    }
    await input.onSuccess();
  } catch (error) {
    input.onError(toErrorMessage(error, `${providerLabel} login failed`));
  }
}
