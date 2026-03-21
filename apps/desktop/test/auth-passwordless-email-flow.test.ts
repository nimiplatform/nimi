import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEmailEntryRoute,
  shouldPromptPasswordSetupAfterEmailOtp,
} from '../../_libs/shell-auth/src/logic/auth-email-flow.js';

test('email entry uses OTP registration for new email', () => {
  assert.equal(
    resolveEmailEntryRoute({ available: true }),
    'register_with_otp',
  );
});

test('email entry uses OTP login for existing email without password', () => {
  assert.equal(
    resolveEmailEntryRoute({ available: false, hasPassword: false }),
    'login_with_otp',
  );
});

test('email entry uses password login for existing email with password', () => {
  assert.equal(
    resolveEmailEntryRoute({ available: false, hasPassword: true }),
    'login_with_password',
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
        user: {
          id: 'user-1',
          createdAt: '2026-03-01T00:00:00Z',
          handle: '@user1',
          displayName: 'User 1',
          status: 'ACTIVE',
          role: 'USER',
          hasPassword: false,
        },
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
        user: {
          id: 'user-1',
          createdAt: '2026-03-01T00:00:00Z',
          handle: '@user1',
          displayName: 'User 1',
          status: 'ACTIVE',
          role: 'USER',
          hasPassword: true,
        },
      },
    }),
    false,
  );
});
