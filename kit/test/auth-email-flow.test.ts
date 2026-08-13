import { describe, expect, it } from 'vitest';

import {
  resolveEmailEntryRoute,
} from '@nimiplatform/kit/auth';

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
});
