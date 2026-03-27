import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AuthPlatformAdapter } from '../auth/src/platform/auth-platform-adapter.js';
import type { AuthMenuSetters, DesktopCallbackContext } from '../auth/src/logic/auth-menu-handlers.js';
import { AUTH_COPY } from '../auth/src/logic/auth-copy.js';
import {
  handleEmailLogin,
} from '../auth/src/logic/auth-menu-handlers.js';
import {
  handleConfirmDesktopAuthorization,
} from '../auth/src/logic/auth-menu-handlers-ext.js';

function createEvent(): FormEvent {
  return {
    preventDefault: vi.fn(),
  } as unknown as FormEvent;
}

function createDesktopContext(overrides?: Partial<DesktopCallbackContext>): DesktopCallbackContext {
  return {
    desktopCallbackRequest: null,
    desktopCallbackToken: '',
    desktopCallbackUser: null,
    authToken: null,
    ...overrides,
  };
}

function createSetters() {
  const state: {
    loginError: string | null;
    view: string | null;
  } = {
    loginError: null,
    view: null,
  };
  const setters: AuthMenuSetters = {
    setView: (view) => {
      state.view = view;
    },
    setPending: () => undefined,
    setLoginError: (error) => {
      state.loginError = error;
    },
    setPendingTokens: () => undefined,
    setOtpCode: () => undefined,
    setOtpResendCountdown: () => undefined,
    setTempToken: () => undefined,
    setTwoFactorCode: () => undefined,
    setTwoFactorReturnView: () => undefined,
    setStatusBanner: () => undefined,
    setAuthSession: () => undefined,
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
      hasTauriInvoke: () => false,
      oauthListenForCode: async () => ({ code: '', state: '', error: '' }),
      oauthTokenExchange: async () => ({ accessToken: '' }),
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
      createDesktopContext(),
      adapter,
    );

    expect(state.loginError).toBe(AUTH_COPY.emailLoginFailed);
  });

  it('maps expired desktop authorization sessions to a dedicated message', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      applyToken: async () => {
        throw new Error('HTTP_401 unauthorized');
      },
    });

    await handleConfirmDesktopAuthorization(
      createEvent(),
      setters,
      createDesktopContext({
        desktopCallbackRequest: {
          callbackUrl: 'http://127.0.0.1:43123/oauth/callback',
          state: 'state-1',
        },
        authToken: 'access-token',
      }),
      adapter,
    );

    expect(state.loginError).toBe(AUTH_COPY.desktopSessionExpired);
    expect(state.view).toBe('main');
  });

  it('maps forbidden desktop authorization responses to a permission error', async () => {
    const { state, setters } = createSetters();
    const adapter = createAdapter({
      applyToken: async () => {
        throw new Error('PERMISSION_DENIED');
      },
    });

    await handleConfirmDesktopAuthorization(
      createEvent(),
      setters,
      createDesktopContext({
        desktopCallbackRequest: {
          callbackUrl: 'http://127.0.0.1:43123/oauth/callback',
          state: 'state-2',
        },
        authToken: 'access-token',
      }),
      adapter,
    );

    expect(state.loginError).toBe(AUTH_COPY.desktopPermissionDenied);
    expect(state.view).toBe('main');
  });
});
