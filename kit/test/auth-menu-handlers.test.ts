import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WebAccountAuthAdapter } from '../auth/src/platform/web-account-auth-adapter.js';
import type { AuthMenuSetters } from '../auth/src/logic/auth-menu-handlers.js';
import { AUTH_COPY } from '../auth/src/logic/auth-copy.js';
import {
  handleEmailLogin,
  handleSetPasswordAfterOtp,
} from '../auth/src/logic/auth-menu-handlers.js';
import { handleVerify2Fa, handleVerifyEmailOtp } from '../auth/src/logic/auth-menu-handlers-ext.js';

function event(): FormEvent {
  return { preventDefault: vi.fn() } as unknown as FormEvent;
}

const CURRENT_USER = {
  createdAt: '2026-08-24T00:00:00.000Z',
  displayName: 'User One',
  handle: 'user-one',
  id: 'user-1',
  role: 'USER',
} as const;

function createSetters() {
  const state = {
    loginError: null as string | null,
    view: null as string | null,
    authSessionCalls: 0,
    pendingPasswordSetup: false,
  };
  const setters: AuthMenuSetters = {
    setView: (view) => {
      state.view = view;
    },
    setPending: () => undefined,
    setLoginError: (error) => {
      state.loginError = error;
    },
    setPendingPasswordSetup: (pending) => {
      state.pendingPasswordSetup = pending;
    },
    setOtpCode: () => undefined,
    setOtpResendCountdown: () => undefined,
    setTempToken: () => undefined,
    setTwoFactorCode: () => undefined,
    setTwoFactorReturnView: () => undefined,
    setStatusBanner: () => undefined,
    setAuthSession: () => {
      state.authSessionCalls += 1;
    },
  };
  return { state, setters };
}

function createAdapter(overrides: Partial<WebAccountAuthAdapter> = {}): WebAccountAuthAdapter {
  return {
    checkEmail: async () => ({ available: false, entryRoute: 'login_with_password' }),
    passwordLogin: async () => ({ loginState: 'ok' }),
    requestEmailOtp: async () => ({ success: true }),
    verifyEmailOtp: async () => ({ loginState: 'ok' }),
    verifyTwoFactor: async () => undefined,
    walletChallenge: async () => ({ message: 'challenge', nonce: 'nonce' }),
    walletLogin: async () => ({ loginState: 'ok' }),
    oauthLogin: async () => ({ loginState: 'ok' }),
    updatePassword: async () => undefined,
    loadCurrentUser: async () => CURRENT_USER,
    completeBrowserSessionLogin: async () => CURRENT_USER,
    ...overrides,
  };
}

describe('Web Account Auth handlers', () => {
  it('surfaces a normalized password login failure', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      passwordLogin: async () => {
        throw new Error('boom');
      },
    });
    await handleEmailLogin(event(), 'user@example.com', 'secret123', false, setters, adapter);
    expect(state.loginError).toBe(AUTH_COPY.emailLoginFailed);
  });

  it('finalizes password and two-factor login only from the Realm browser-session projection', async () => {
    const first = createSetters();
    const completeBrowserSessionLogin = vi.fn(async () => CURRENT_USER);
    const adapter = createAdapter({ completeBrowserSessionLogin });
    await handleEmailLogin(event(), 'user@example.com', 'secret123', false, first.setters, adapter);
    expect(first.state.authSessionCalls).toBe(1);
    const second = createSetters();
    await handleVerify2Fa(event(), 'temporary-token', '123456', second.setters, adapter);
    expect(second.state.authSessionCalls).toBe(1);
    expect(completeBrowserSessionLogin).toHaveBeenCalledTimes(2);
  });

  it('routes browser-session onboarding through password setup', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      verifyEmailOtp: async () => ({ loginState: 'needs_onboarding' }),
    });
    await handleVerifyEmailOtp(event(), 'user@example.com', '123456', setters, adapter);
    expect(state.pendingPasswordSetup).toBe(true);
    expect(state.view).toBe('email_set_password');
    await handleSetPasswordAfterOtp(event(), 'secret123', 'secret123', setters, adapter);
    expect(state.pendingPasswordSetup).toBe(false);
    expect(state.authSessionCalls).toBe(1);
  });

  it('rejects bearer material returned to browser-session login', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      passwordLogin: async () => ({
        loginState: 'ok',
        tokens: {
          accessToken: 'forbidden',
          refreshToken: 'forbidden',
          expiresIn: 60,
          tokenType: 'Bearer',
        },
      }),
    });
    await handleEmailLogin(event(), 'user@example.com', 'secret123', false, setters, adapter);
    expect(state.loginError).toBe(AUTH_COPY.emailLoginFailed);
    expect(state.authSessionCalls).toBe(0);
  });
});
