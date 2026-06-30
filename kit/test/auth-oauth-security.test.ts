import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_CALLBACK_TIMEOUT_MS,
  createDesktopOAuthCallbackRedirectUri,
  createDesktopOAuthCallbackState,
  handleWalletLogin,
  localizeAuthError,
  toDesktopBrowserAuthErrorMessage,
  toErrorMessage,
  validateDesktopCallbackState,
} from '@nimiplatform/kit/auth';

type ImportMetaEnvCarrier = typeof globalThis & {
  __NIMI_IMPORT_META_ENV__?: Record<string, string | boolean | undefined>;
};

function installImportMetaEnvForTest(env: Record<string, string | boolean | undefined>): () => void {
  const globalRecord = globalThis as ImportMetaEnvCarrier;
  const previous = globalRecord.__NIMI_IMPORT_META_ENV__;
  Object.defineProperty(globalThis, '__NIMI_IMPORT_META_ENV__', {
    value: env,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, '__NIMI_IMPORT_META_ENV__', {
      value: previous,
      configurable: true,
    });
  };
}

function stubCrypto(cryptoValue: Partial<Crypto>): void {
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    ...cryptoValue,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('desktop OAuth callback security', () => {
  it('validates flow kind and expiry using secure random state', () => {
    stubCrypto({
      randomUUID: () => '11111111-2222-3333-4444-555555555555',
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => array,
    });

    const state = createDesktopOAuthCallbackState('social-oauth');

    expect(validateDesktopCallbackState({
      expectedState: state,
      actualState: state,
      flowKind: 'social-oauth',
      maxAgeMs: DESKTOP_CALLBACK_TIMEOUT_MS,
      nowMs: Date.now() + 1000,
    })).toBe(true);
    expect(validateDesktopCallbackState({
      expectedState: state,
      actualState: state,
      flowKind: 'desktop-web-auth',
    })).toBe(false);
    expect(validateDesktopCallbackState({
      expectedState: state,
      actualState: state,
      flowKind: 'social-oauth',
      maxAgeMs: 1,
      nowMs: Date.now() + DESKTOP_CALLBACK_TIMEOUT_MS + 1,
    })).toBe(false);
  });

  it('uses the expanded non-privileged loopback port range', () => {
    stubCrypto({
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint32Array) {
          array[0] = 0;
        }
        return array;
      },
    });

    const uri = new URL(createDesktopOAuthCallbackRedirectUri());
    expect(uri.hostname).toBe('127.0.0.1');
    expect(uri.pathname).toBe('/oauth/callback');
    expect(Number(uri.port)).toBe(1024);
  });
});

describe('auth error rendering', () => {
  it('hides raw backend details for unknown messages', () => {
    expect(localizeAuthError('SQLSTATE[42P01]: failed to decode auth payload at /internal/auth'))
      .toBe('Authentication failed. Please try again.');
  });

  it('surfaces bootstrap races clearly', () => {
    expect(localizeAuthError('API not initialized'))
      .toBe('App is still starting. Please wait a moment and try again.');
  });

  it('appends raw details only in debug boot mode', () => {
    const restoreEnv = installImportMetaEnvForTest({
      VITE_NIMI_DEBUG_BOOT: '1',
    });
    try {
      expect(toErrorMessage(new Error('AUTH_FLOW_SUBMIT_HANDLER_MISSING'), 'Email sign-in failed'))
        .toBe('Authentication failed. Please try again. [debug: AUTH_FLOW_SUBMIT_HANDLER_MISSING]');
    } finally {
      restoreEnv();
    }
  });

  it('surfaces RuntimeAccountService availability failures for desktop browser auth', () => {
    expect(toDesktopBrowserAuthErrorMessage(new Error('Runtime account login could not start: electron-runtime-endpoint-unavailable')))
      .toBe('Runtime account service is unavailable. Start or connect the external Runtime daemon and try again.');
  });
});

describe('wallet login error handling', () => {
  it('keeps cancellations silent but surfaces non-cancellation failures to the UI', async () => {
    const loginErrors: Array<string | null> = [];
    const setters = {
      setPending: () => undefined,
      setLoginError: (value: string | null) => {
        loginErrors.push(value);
      },
    };
    const adapter = {
      walletChallenge: async () => ({ message: 'challenge', nonce: 'nonce' }),
      walletLogin: async () => ({ tokens: null }),
    };

    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        isMetaMask: true,
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts') return ['0x123'];
          if (method === 'eth_chainId') return '0x1';
          throw Object.assign(new Error('User rejected the request'), { code: 4001 });
        },
      },
    });

    await handleWalletLogin('metamask', setters as never, adapter as never);
    expect(loginErrors).toEqual([null]);

    (window as typeof window & {
      ethereum: { request: (input: { method: string }) => Promise<unknown> };
    }).ethereum.request = async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return ['0x123'];
      if (method === 'eth_chainId') return '0x1';
      throw new Error('signature verification failed');
    };

    await handleWalletLogin('metamask', setters as never, adapter as never);
    expect(loginErrors.slice(0, 2)).toEqual([null, null]);
    expect(loginErrors[2]).toEqual(expect.any(String));
    expect(loginErrors[2]).not.toBe('');
  });
});
