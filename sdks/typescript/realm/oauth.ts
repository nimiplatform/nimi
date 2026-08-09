import type { OAuthLoginResultDto, OAuthProvider as NimiRealmOAuthProviderValue } from '../core-generated/realm-typed-client';

export const NIMI_REALM_OAUTH_PROVIDER = Object.freeze({
  GOOGLE: 'GOOGLE',
  WECHAT: 'WECHAT',
  TIKTOK: 'TIKTOK',
} as const satisfies Record<string, NimiRealmOAuthProviderValue>);

export type NimiRealmOAuthProvider =
  (typeof NIMI_REALM_OAUTH_PROVIDER)[keyof typeof NIMI_REALM_OAUTH_PROVIDER];

export const NIMI_REALM_OAUTH_LOGIN_STATE = Object.freeze({
  OK: 'ok',
  NEEDS_ONBOARDING: 'needs_onboarding',
  NEEDS_TWO_FACTOR: 'needs_2fa',
  BLOCKED: 'blocked',
} as const satisfies Record<string, OAuthLoginResultDto['loginState']>);

export type NimiRealmOAuthLoginState =
  (typeof NIMI_REALM_OAUTH_LOGIN_STATE)[keyof typeof NIMI_REALM_OAUTH_LOGIN_STATE];
