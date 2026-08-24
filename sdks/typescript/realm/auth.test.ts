import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AuthTokensDto,
  AuthUserDto,
  OAuthLoginResultDto,
} from '../core-generated/realm-typed-client';

import {
  checkNimiRealmAuthEmail,
  createNimiRealmWalletChallenge,
  isNimiRealmExpectedAnonymousSessionError,
  loginNimiRealmAuthPassword,
  loginNimiRealmOAuth,
  loginNimiRealmWallet,
  NIMI_REALM_OAUTH_LOGIN_STATE,
  NIMI_REALM_OAUTH_PROVIDER,
  normalizeNimiRealmAuthTokens,
  normalizeNimiRealmOAuthLoginResult,
  requestNimiRealmEmailOtp,
  readNimiRealmOAuthLoginTokens,
  toNimiRealmAuthUserRecord,
  verifyNimiRealmEmailOtp,
  verifyNimiRealmTwoFactor,
  type NimiRealmAuthApi,
} from './index';
import { ReasonCode } from '../types';

const AUTH_USER_FIXTURE = {
  createdAt: '2026-06-05T00:00:00.000Z',
  displayName: 'User One',
  handle: 'user-one',
  hasPassword: false,
  id: 'user-1',
  isTwoFactorEnabled: false,
  languages: [],
  oauthProviders: [],
  role: 'USER',
  socialProfiles: [],
  status: 'ACTIVE',
  tags: [],
  tiers: {
    assetTier: 0,
    influenceTier: 0,
    interactionTier: 0,
    vitalityScore: 0,
  },
  updatedAt: '2026-06-05T00:00:00.000Z',
  wallets: [],
} satisfies AuthUserDto;

const AUTH_TOKENS_FIXTURE = {
  accessToken: 'access',
  expiresIn: 3600,
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  user: AUTH_USER_FIXTURE,
} satisfies AuthTokensDto;

test('Realm auth view normalizes token payloads and user records', () => {
  assert.deepEqual(toNimiRealmAuthUserRecord(AUTH_USER_FIXTURE), AUTH_USER_FIXTURE);
  assert.equal(toNimiRealmAuthUserRecord({ id: 'user-1' }), null);
  assert.equal(toNimiRealmAuthUserRecord(['user-1']), null);

  assert.deepEqual(normalizeNimiRealmAuthTokens(AUTH_TOKENS_FIXTURE), AUTH_TOKENS_FIXTURE);
  assert.throws(
    () => normalizeNimiRealmAuthTokens({
      id: 'legacy-token-1',
      accessToken: 'access',
      expiresIn: 3600,
      type: 'Bearer',
    }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_AUTH_RESPONSE_INVALID',
  );
  assert.throws(
    () => normalizeNimiRealmAuthTokens({
      accessToken: 'access',
      expiresIn: 3600,
      tokenType: 'Bearer',
      user: null,
    }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_AUTH_RESPONSE_INVALID',
  );

  for (const requiredField of [
    'createdAt',
    'displayName',
    'handle',
    'hasPassword',
    'id',
    'isTwoFactorEnabled',
    'languages',
    'oauthProviders',
    'role',
    'socialProfiles',
    'status',
    'tags',
    'tiers',
    'updatedAt',
    'wallets',
  ] as const) {
    const malformedUser: Record<string, unknown> = { ...AUTH_USER_FIXTURE };
    delete malformedUser[requiredField];
    assert.throws(
      () => normalizeNimiRealmAuthTokens({
        ...AUTH_TOKENS_FIXTURE,
        user: malformedUser,
      }),
      (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_AUTH_RESPONSE_INVALID',
    );
  }
  for (const malformedUser of [
    { ...AUTH_USER_FIXTURE, avatarUrl: 42 },
    { ...AUTH_USER_FIXTURE, oauthProviders: ['FUTURE'] },
    { ...AUTH_USER_FIXTURE, socialProfiles: [{}] },
    {
      ...AUTH_USER_FIXTURE,
      socialProfiles: [{ handle: 'user-one', platform: 'site', followers: 'many' }],
    },
    { ...AUTH_USER_FIXTURE, tiers: { assetTier: 1 } },
    { ...AUTH_USER_FIXTURE, wallets: [{ id: 'wallet-1' }] },
    {
      ...AUTH_USER_FIXTURE,
      wallets: [{
        address: '0x123',
        boundOnChains: [],
        chainNamespace: 1,
        createdAt: 'now',
        id: 'wallet-1',
      }],
    },
    { ...AUTH_USER_FIXTURE, status: 'FUTURE_STATUS' },
  ]) {
    assert.throws(
      () => normalizeNimiRealmAuthTokens({ ...AUTH_TOKENS_FIXTURE, user: malformedUser }),
      (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_AUTH_RESPONSE_INVALID',
      JSON.stringify(malformedUser),
    );
  }
});

test('Realm OAuth login view fail-closes malformed token payloads', () => {
  const oauthResult = {
    loginState: NIMI_REALM_OAUTH_LOGIN_STATE.OK,
    tokens: {
      ...AUTH_TOKENS_FIXTURE,
      user: { ...AUTH_USER_FIXTURE, hasPassword: true },
    },
  } satisfies OAuthLoginResultDto;
  const result = normalizeNimiRealmOAuthLoginResult(oauthResult);

  assert.equal(result.tokens?.accessToken, 'access');
  assert.equal(readNimiRealmOAuthLoginTokens(result)?.user?.hasPassword, true);
  assert.equal(readNimiRealmOAuthLoginTokens({}), null);

  assert.throws(
    () => normalizeNimiRealmAuthTokens({ accessToken: 'access' }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_AUTH_RESPONSE_INVALID',
  );
  assert.throws(
    () => normalizeNimiRealmOAuthLoginResult({ loginState: 'unknown' }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_AUTH_RESPONSE_INVALID',
  );
});

test('Realm auth helpers map SDK-friendly calls to generated Realm auth requests', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm: NimiRealmAuthApi = {
    auth: {
      async checkEmail(request) {
        calls.push({ method: 'checkEmail', request });
        return { available: true, entryRoute: 'login_with_password' };
      },
      async passwordLogin(request) {
        calls.push({ method: 'passwordLogin', request });
        return { loginState: NIMI_REALM_OAUTH_LOGIN_STATE.OK };
      },
      async requestEmailOtp(request) {
        calls.push({ method: 'requestEmailOtp', request });
        return { success: true, message: 'sent' };
      },
      async verifyEmailOtp(request) {
        calls.push({ method: 'verifyEmailOtp', request });
        return { loginState: NIMI_REALM_OAUTH_LOGIN_STATE.NEEDS_TWO_FACTOR, tempToken: 'tmp' };
      },
      async verify2Fa(request) {
        calls.push({ method: 'verify2Fa', request });
        return {
          accessToken: 'access',
          expiresIn: 3600,
          tokenType: 'Bearer',
        } satisfies AuthTokensDto;
      },
      async walletChallenge(request) {
        calls.push({ method: 'walletChallenge', request });
        return {
          expiresAt: '2026-06-05T00:00:00.000Z',
          message: 'sign',
          nonce: 'nonce',
          walletAddress: '0x123',
        };
      },
      async walletLogin(request) {
        calls.push({ method: 'walletLogin', request });
        return { loginState: NIMI_REALM_OAUTH_LOGIN_STATE.OK };
      },
      async oauthLogin(request) {
        calls.push({ method: 'oauthLogin', request });
        return { loginState: NIMI_REALM_OAUTH_LOGIN_STATE.OK };
      },
    },
  };

  assert.deepEqual(await checkNimiRealmAuthEmail(realm, 'test@example.com'), {
    available: true,
    entryRoute: 'login_with_password',
  });
  await loginNimiRealmAuthPassword(realm, 'test@example.com', 'pw');
  assert.deepEqual(await requestNimiRealmEmailOtp(realm, 'test@example.com'), {
    success: true,
    message: 'sent',
  });
  assert.equal((await verifyNimiRealmEmailOtp(realm, 'test@example.com', '123456')).tempToken, 'tmp');
  assert.equal((await verifyNimiRealmTwoFactor(realm, 'tmp', '654321')).tokenType, 'Bearer');
  assert.equal((await createNimiRealmWalletChallenge(realm, { walletAddress: '0x123' })).nonce, 'nonce');
  await loginNimiRealmWallet(realm, {
    message: 'sign',
    nonce: 'nonce',
    signature: 'sig',
    walletAddress: '0x123',
  });
  await loginNimiRealmOAuth(realm, {
    provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE,
    idToken: 'id-token',
  });

  assert.deepEqual(calls.map((call) => call.method), [
    'checkEmail',
    'passwordLogin',
    'requestEmailOtp',
    'verifyEmailOtp',
    'verify2Fa',
    'walletChallenge',
    'walletLogin',
    'oauthLogin',
  ]);
  assert.deepEqual(calls[0]?.request, {
    path: {},
    body: { email: 'test@example.com' },
  });
  assert.deepEqual(calls[7]?.request, {
    path: {},
    body: {
      provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE,
      idToken: 'id-token',
    },
  });
});

test('Realm auth expected anonymous session classifier stays explicit', () => {
  assert.equal(isNimiRealmExpectedAnonymousSessionError({ reasonCode: 'AUTH_REQUIRED' }), true);
  assert.equal(isNimiRealmExpectedAnonymousSessionError({ reasonCode: 'AUTH_TOKEN_EXPIRED' }), true);
  assert.equal(isNimiRealmExpectedAnonymousSessionError({ reasonCode: ReasonCode.AUTH_TOKEN_INVALID }), false);
  assert.equal(isNimiRealmExpectedAnonymousSessionError({ reasonCode: ReasonCode.SESSION_EXPIRED }), false);
  assert.equal(isNimiRealmExpectedAnonymousSessionError(new Error('HTTP_401 unauthorized')), false);
  assert.equal(isNimiRealmExpectedAnonymousSessionError(new Error('contract mismatch')), false);
});
