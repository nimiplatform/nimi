import assert from 'node:assert/strict';
import test from 'node:test';
import type { RealmModel } from '@nimiplatform/sdk/realm';

import {
  resolveEmailEntryRoute,
  shouldPromptPasswordSetupAfterEmailOtp,
} from '../../../kit/auth/src/logic/auth-email-flow.js';

type AuthTokensDto = RealmModel<'AuthTokensDto'>;
type AuthUser = NonNullable<AuthTokensDto['user']>;

function createAuthUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    createdAt: '2026-03-01T00:00:00Z',
    displayName: 'User 1',
    handle: '@user1',
    hasPassword: false,
    id: 'user-1',
    isAgent: false,
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
    updatedAt: '2026-03-01T00:00:00Z',
    wallets: [],
    ...overrides,
  };
}

test('email entry uses OTP registration for new email', () => {
  assert.equal(
    resolveEmailEntryRoute({ available: true }),
    'register_with_otp',
  );
});

test('email entry uses OTP login for existing email without password', () => {
  assert.equal(
    resolveEmailEntryRoute({ available: false }),
    'login_with_otp',
  );
});

test('email entry uses OTP login for existing email', () => {
  assert.equal(
    resolveEmailEntryRoute({ available: false }),
    'login_with_otp',
  );
});

test('otp flow asks for password setup when account still has no password', () => {
  assert.equal(
    shouldPromptPasswordSetupAfterEmailOtp({
      tokens: {
        accessToken: 'access',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: createAuthUser({
          hasPassword: false,
          status: 'ACTIVE',
        }),
      },
    }),
    true,
  );
});

test('otp flow skips password setup when account already has password', () => {
  assert.equal(
    shouldPromptPasswordSetupAfterEmailOtp({
      tokens: {
        accessToken: 'access',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: createAuthUser({
          hasPassword: true,
          status: 'ACTIVE',
        }),
      },
    }),
    false,
  );
});
