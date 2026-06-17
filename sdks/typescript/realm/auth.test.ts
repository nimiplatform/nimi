import assert from 'node:assert/strict';
import test from 'node:test';

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

test('Realm auth view normalizes token payloads and user records', () => {
  assert.deepEqual(toNimiRealmAuthUserRecord({ id: 'user-1', hasPassword: false }), {
    id: 'user-1',
    hasPassword: false,
  });
  assert.equal(toNimiRealmAuthUserRecord(['user-1']), null);

  assert.deepEqual(normalizeNimiRealmAuthTokens({
    accessToken: 'access',
    expiresIn: 3600,
    refreshToken: 'refresh',
    tokenType: 'Bearer',
    user: { id: 'user-1', hasPassword: false },
  }), {
    accessToken: 'access',
    expiresIn: 3600,
    refreshToken: 'refresh',
    tokenType: 'Bearer',
    user: { id: 'user-1', hasPassword: false },
  });
  assert.deepEqual(normalizeNimiRealmAuthTokens({
    id: 'generated-token-1',
    accessToken: 'access',
    expiresIn: 3600,
    type: 'Bearer',
  }), {
    accessToken: 'access',
    expiresIn: 3600,
    generatedTokenId: 'generated-token-1',
    generatedTokenType: 'Bearer',
    tokenType: 'Bearer',
  });
});

test('Realm OAuth login view fail-closes malformed token payloads', () => {
  const result = normalizeNimiRealmOAuthLoginResult({
    loginState: NIMI_REALM_OAUTH_LOGIN_STATE.OK,
    tokens: {
      accessToken: 'access',
      expiresIn: 3600,
      tokenType: 'Bearer',
      user: { id: 'user-1', hasPassword: true },
    },
  });

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
        return { id: 'token-1', accessToken: 'access', expiresIn: 3600, type: 'Bearer' };
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
  assert.equal((await verifyNimiRealmTwoFactor(realm, 'tmp', '654321')).generatedTokenId, 'token-1');
  assert.equal((await createNimiRealmWalletChallenge(realm, { walletAddress: '0x123' })).nonce, 'nonce');
  await loginNimiRealmWallet(realm, {
    message: 'sign',
    nonce: 'nonce',
    signature: 'sig',
    walletAddress: '0x123',
  });
  await loginNimiRealmOAuth(realm, NIMI_REALM_OAUTH_PROVIDER.GOOGLE, 'access');

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
      accessToken: 'access',
    },
  });
});

test('Realm auth expected anonymous session classifier stays explicit', () => {
  assert.equal(isNimiRealmExpectedAnonymousSessionError({ reasonCode: ReasonCode.AUTH_TOKEN_INVALID }), true);
  assert.equal(isNimiRealmExpectedAnonymousSessionError({ reasonCode: ReasonCode.SESSION_EXPIRED }), true);
  assert.equal(isNimiRealmExpectedAnonymousSessionError(new Error('HTTP_401 unauthorized')), false);
  assert.equal(isNimiRealmExpectedAnonymousSessionError(new Error('contract mismatch')), false);
});
