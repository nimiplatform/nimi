import { describe, expect, it } from 'vitest';

import {
  resolveEmailEntryRoute,
  shouldPromptPasswordSetupAfterEmailOtp,
} from '@nimiplatform/kit/auth';

function createEmailOtpResult(hasPassword: boolean) {
  return {
    tokens: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: 'user-1',
        hasPassword,
      },
    },
  };
}

describe('auth email flow', () => {
  it('uses OTP registration for new email', () => {
    expect(resolveEmailEntryRoute({
      available: true,
      entryRoute: 'register_with_otp',
    } as never)).toBe('register_with_otp');
  });

  it('uses OTP login for existing email without password', () => {
    expect(resolveEmailEntryRoute({
      available: false,
      entryRoute: 'login_with_otp',
    } as never)).toBe('login_with_otp');
  });

  it('uses password login for existing email with password', () => {
    expect(resolveEmailEntryRoute({
      available: false,
      entryRoute: 'login_with_password',
    } as never)).toBe('login_with_password');
  });

  it('asks for password setup when an OTP account still has no password', () => {
    expect(shouldPromptPasswordSetupAfterEmailOtp(createEmailOtpResult(false) as never)).toBe(true);
  });

  it('skips password setup when an OTP account already has a password', () => {
    expect(shouldPromptPasswordSetupAfterEmailOtp(createEmailOtpResult(true) as never)).toBe(false);
  });
});
