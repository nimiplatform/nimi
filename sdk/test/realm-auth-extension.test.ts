import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkRealmAuthEmail,
  createRealmWalletChallenge,
  isExpectedAnonymousRealmSessionError,
  loginRealmAuthPassword,
  loginRealmOAuth,
  loginRealmWallet,
  requestRealmEmailOtp,
  toRealmAuthTokensDto,
  toRealmAuthUserRecord,
  toRealmCheckEmailResponseDto,
  toRealmOAuthLoginResultDto,
  verifyRealmEmailOtp,
  verifyRealmTwoFactor,
} from '../src/realm/index.js';
import { ReasonCode } from '../src/types/index.js';

function createCallApi(services: Record<string, unknown>) {
  return async <T>(task: (realm: { services: Record<string, unknown> }) => Promise<T>) =>
    task({ services });
}

test('Realm auth DTO projections fail closed on malformed payloads', () => {
  assert.deepEqual(toRealmAuthUserRecord({ id: 'user-1' }), { id: 'user-1' });
  assert.equal(toRealmAuthUserRecord(['user-1']), null);
  assert.deepEqual(toRealmCheckEmailResponseDto({ available: true, entryRoute: 'login_with_password' }), {
    available: true,
    entryRoute: 'login_with_password',
  });
  assert.deepEqual(toRealmAuthTokensDto({
    accessToken: 'access',
    expiresIn: 3600,
    tokenType: 'Bearer',
    user: { id: 'user-1' },
  }), {
    accessToken: 'access',
    expiresIn: 3600,
    refreshToken: undefined,
    tokenType: 'Bearer',
    user: { id: 'user-1' },
  });
  assert.deepEqual(toRealmOAuthLoginResultDto({
    loginState: 'ok',
    tokens: {
      accessToken: 'access',
      expiresIn: 3600,
      tokenType: 'Bearer',
    },
  }).tokens?.accessToken, 'access');

  assert.throws(() => toRealmCheckEmailResponseDto({ available: true, entryRoute: 'unknown' }), /Malformed check-email response/);
  assert.throws(() => toRealmAuthTokensDto({ accessToken: 'access' }), /Malformed auth token response/);
  assert.throws(() => toRealmOAuthLoginResultDto({ loginState: 'unknown' }), /Malformed OAuth login response/);
});

test('Realm auth helpers own AuthService method selection', async () => {
  const calls: string[] = [];
  const callApi = createCallApi({
    AuthService: {
      checkEmail: async (input: Record<string, unknown>) => {
        calls.push(`check:${input.email}`);
        return { available: false, entryRoute: 'login_with_otp' };
      },
      passwordLogin: async (input: Record<string, unknown>) => {
        calls.push(`password:${input.identifier}`);
        return { loginState: 'ok', tokens: { accessToken: 'access', expiresIn: 3600, tokenType: 'Bearer' } };
      },
      requestEmailOtp: async (input: Record<string, unknown>) => {
        calls.push(`request-otp:${input.email}`);
        return { success: true, message: 'sent' };
      },
      verifyEmailOtp: async (input: Record<string, unknown>) => {
        calls.push(`verify-otp:${input.email}:${input.code}`);
        return { loginState: 'needs_onboarding', tempToken: 'temp' };
      },
      verifyTwoFactor: async (input: Record<string, unknown>) => {
        calls.push(`verify-2fa:${input.tempToken}:${input.code}`);
        return { accessToken: 'two-factor-access', expiresIn: 3600, tokenType: 'Bearer' };
      },
      walletChallenge: async (input: Record<string, unknown>) => {
        calls.push(`wallet-challenge:${input.walletAddress}:${input.chainId}:${input.walletType}`);
        return { message: 'challenge', nonce: 'nonce' };
      },
      walletLogin: async (input: Record<string, unknown>) => {
        calls.push(`wallet-login:${input.walletAddress}:${input.nonce}:${input.signature}`);
        return { loginState: 'ok', tokens: { accessToken: 'wallet-access', expiresIn: 3600, tokenType: 'Bearer' } };
      },
      oauthLogin: async (input: Record<string, unknown>) => {
        calls.push(`oauth:${input.provider}:${input.accessToken}`);
        return { loginState: 'ok', tokens: { accessToken: 'oauth-access', expiresIn: 3600, tokenType: 'Bearer' } };
      },
    },
  }) as never;

  await checkRealmAuthEmail(callApi, 'user@example.test');
  await loginRealmAuthPassword(callApi, 'user@example.test', 'password', 'login failed');
  await requestRealmEmailOtp(callApi, 'user@example.test', 'otp failed');
  await verifyRealmEmailOtp(callApi, 'user@example.test', '123456', 'verify failed');
  await verifyRealmTwoFactor(callApi, 'temp', '654321', '2fa failed');
  await createRealmWalletChallenge(callApi, { walletAddress: '0x123', chainId: '0x1', walletType: 'metamask' }, 'challenge failed');
  await loginRealmWallet(callApi, {
    walletAddress: '0x123',
    chainId: '0x1',
    nonce: 'nonce',
    message: 'challenge',
    signature: 'signature',
    walletType: 'metamask',
  }, 'wallet failed');
  await loginRealmOAuth(callApi, 'GOOGLE' as never, 'oauth-token', 'oauth failed');

  assert.deepEqual(calls, [
    'check:user@example.test',
    'password:user@example.test',
    'request-otp:user@example.test',
    'verify-otp:user@example.test:123456',
    'verify-2fa:temp:654321',
    'wallet-challenge:0x123:0x1:metamask',
    'wallet-login:0x123:nonce:signature',
    'oauth:GOOGLE:oauth-token',
  ]);
});

test('Realm auth anonymous-session classifier stays explicit', () => {
  assert.equal(isExpectedAnonymousRealmSessionError({ reasonCode: ReasonCode.AUTH_TOKEN_INVALID }), true);
  assert.equal(isExpectedAnonymousRealmSessionError(new Error('HTTP_401 unauthorized')), true);
  assert.equal(isExpectedAnonymousRealmSessionError(new Error('contract mismatch')), false);
});
