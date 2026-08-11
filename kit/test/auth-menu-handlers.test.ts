import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AuthPlatformAdapter } from '../auth/src/platform/auth-platform-adapter.js';
import type { AuthMenuSetters } from '../auth/src/logic/auth-menu-handlers.js';
import { AUTH_COPY } from '../auth/src/logic/auth-copy.js';
import {
  handleEmailLogin,
  handleSetPasswordAfterOtp,
} from '../auth/src/logic/auth-menu-handlers.js';
import { handleVerify2Fa, handleVerifyEmailOtp } from '../auth/src/logic/auth-menu-handlers-ext.js';

function createEvent(): FormEvent {
  return {
    preventDefault: vi.fn(),
  } as unknown as FormEvent;
}

function createSetters() {
  const state: {
    loginError: string | null;
    view: string | null;
    authSessionCalls: number;
    pendingTokensCleared: boolean;
    pendingTokensValue: unknown;
  } = {
    loginError: null,
    view: null,
    authSessionCalls: 0,
    pendingTokensCleared: false,
    pendingTokensValue: null,
  };
  const setters: AuthMenuSetters = {
    setView: (view) => {
      state.view = view;
    },
    setPending: () => undefined,
    setLoginError: (error) => {
      state.loginError = error;
    },
    setPendingTokens: (tokens) => {
      state.pendingTokensCleared = tokens === null;
      state.pendingTokensValue = tokens;
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

function createAdapter(overrides?: Partial<AuthPlatformAdapter>): AuthPlatformAdapter {
  return {
    checkEmail: async () => ({ exists: true }),
    requestEmailOtp: async () => ({ success: true }),
    verifyEmailOtp: async () => ({ loginState: 0 } as never),
    verifyTwoFactor: async () => ({ accessToken: 'token' } as never),
    walletChallenge: async () => ({ message: 'challenge', nonce: 'nonce' }),
    walletLogin: async () => ({ loginState: 0 } as never),
    oauthLogin: async () => ({ loginState: 0 } as never),
    updatePassword: async () => undefined,
    loadCurrentUser: async () => null,
    applyToken: async () => undefined,
    oauthBridge: {
      hasShellHostInvoke: () => false,
      oauthListenForCode: async () => ({ code: '', state: '', error: '' }),
      openExternalUrl: async () => ({ opened: true }),
      focusMainWindow: async () => undefined,
    },
    ...overrides,
  };
}

describe('auth menu handlers', () => {
  it('surfaces a normalized login failure message for password login errors', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      passwordLogin: async () => {
        throw new Error('boom');
      },
    });

    await handleEmailLogin(
      createEvent(),
      'user@example.com',
      'secret123',
      false,
      setters,
      adapter,
    );

    expect(state.loginError).toBe(AUTH_COPY.emailLoginFailed);
  });

  it('completes fresh browser-session password login without applying tokens', async () => {
    const { state, setters } = createSetters();
    const applyToken = vi.fn();
    const completeBrowserSessionLogin = vi.fn(async () => true);
    const adapter = createAdapter({
      passwordLogin: async () => ({ loginState: 'ok' }),
      applyToken,
      completeBrowserSessionLogin,
    });

    await handleEmailLogin(createEvent(), 'user@example.com', 'secret123', false, setters, adapter);

    expect(completeBrowserSessionLogin).toHaveBeenCalledTimes(1);
    expect(applyToken).not.toHaveBeenCalled();
    expect(state.authSessionCalls).toBe(0);
    expect(state.loginError).toBeNull();
  });

  it('completes fresh browser-session 2FA without applying tokens', async () => {
    const { state, setters } = createSetters();
    const applyToken = vi.fn();
    const completeBrowserSessionLogin = vi.fn(async () => true);
    const adapter = createAdapter({
      verifyTwoFactor: async () => null,
      applyToken,
      completeBrowserSessionLogin,
    });

    await handleVerify2Fa(createEvent(), 'temporary-token', '123456', setters, adapter);

    expect(completeBrowserSessionLogin).toHaveBeenCalledTimes(1);
    expect(applyToken).not.toHaveBeenCalled();
    expect(state.authSessionCalls).toBe(0);
    expect(state.loginError).toBeNull();
  });

  // The legacy "Authorize Desktop with my web session" flow
  // (handleConfirmDesktopAuthorization) was deleted in Wave A2 — direct-to-loopback
  // makes the realm 302-redirect to the desktop loopback redirect_uri after
  // /api/auth/oauth/authorize sees a valid web session cookie. The "no exchange"
  // regression lock lives in test/desktop-callback-no-exchange.test.ts.

  it('continues password setup when reloading the latest user fails', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      updatePassword: async () => undefined,
      loadCurrentUser: async () => {
        throw new Error('current user reload failed');
      },
    });

    await handleSetPasswordAfterOtp(
      createEvent(),
      'secret123',
      'secret123',
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1' },
      } as never,
      setters,
      adapter,
    );

    expect(state.loginError).toBeNull();
    expect(state.authSessionCalls).toBe(1);
    expect(state.pendingTokensCleared).toBe(true);
  });

  it('routes OTP users without passwords through password setup before login finalization', async () => {
    const { state, setters } = createSetters();
    const tokens = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
      user: {
        id: 'user-1',
        hasPassword: false,
      },
    };
    const applyTokenCalls: Array<[string, string | undefined]> = [];
    const adapter = createAdapter({
      verifyEmailOtp: async () => ({ tokens }) as never,
      applyToken: async (accessToken, refreshToken) => {
        applyTokenCalls.push([accessToken, refreshToken]);
      },
    });

    await handleVerifyEmailOtp(
      createEvent(),
      ' user@example.com ',
      '123456',
      setters,
      adapter,
    );

    expect(applyTokenCalls).toEqual([['access-token', 'refresh-token']]);
    expect(state.pendingTokensValue).toEqual(tokens);
    expect(state.view).toBe('email_set_password');
    expect(state.authSessionCalls).toBe(0);
    expect(state.loginError).toBeNull();
  });

  it('tells the user to sign in directly when password setup succeeds but login finalization fails', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      updatePassword: async () => undefined,
      applyToken: async (token) => {
        if (token) {
          throw new Error('persist session failed');
        }
      },
    });

    await handleSetPasswordAfterOtp(
      createEvent(),
      'secret123',
      'secret123',
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1' },
      } as never,
      setters,
      adapter,
    );

    expect(state.loginError).toBe(AUTH_COPY.setPasswordFinalizeFailed);
    expect(state.view).toBe('main');
    expect(state.authSessionCalls).toBe(0);
    expect(state.pendingTokensCleared).toBe(true);
  });
});
