import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESKTOP_CALLBACK_TIMEOUT_MS,
  createDesktopCallbackRedirectUri,
  createDesktopCallbackState,
  localizeAuthError,
  toErrorMessage,
  validateDesktopCallbackState,
} from '@nimiplatform/nimi-kit/core/oauth';
import { REMEMBER_LOGIN_KEY, loadRememberedLogin, saveRememberedLogin } from '../../../kit/auth/src/logic/remember-login.js';
import { handleWalletLogin } from '../../../kit/auth/src/logic/auth-menu-handlers-ext.js';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function installWindowForTest(overrides: Record<string, unknown> = {}): () => void {
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const baseWindow = {
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    setTimeout,
    clearTimeout,
    ...overrides,
  };
  Object.defineProperty(globalThis, 'window', {
    value: baseWindow,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: baseWindow.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: baseWindow.sessionStorage,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: previousLocalStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: previousSessionStorage,
      configurable: true,
    });
  };
}

function installCryptoForTest(cryptoValue: Crypto): () => void {
  const previousCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    value: cryptoValue,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: previousCrypto,
      configurable: true,
    });
  };
}

function installImportMetaEnvForTest(env: Record<string, string | boolean | undefined>): () => void {
  const globalRecord = globalThis as typeof globalThis & {
    __NIMI_IMPORT_META_ENV__?: Record<string, string | boolean | undefined>;
  };
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

test('saveRememberedLogin stores only email and rememberMe', () => {
  const restoreWindow = installWindowForTest();
  try {
    saveRememberedLogin({
      email: 'user@example.com',
      rememberMe: true,
    });
    const stored = globalThis.localStorage.getItem(REMEMBER_LOGIN_KEY);
    assert.equal(stored, JSON.stringify({
      email: 'user@example.com',
      rememberMe: true,
    }));
    assert.ok(!String(stored).includes('password'));
  } finally {
    restoreWindow();
  }
});

test('loadRememberedLogin migrates legacy stored passwords out of localStorage', () => {
  const restoreWindow = installWindowForTest();
  try {
    globalThis.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({
      email: 'legacy@example.com',
      password: 'plaintext-secret',
      rememberMe: true,
    }));
    assert.deepEqual(loadRememberedLogin(), {
      email: 'legacy@example.com',
      rememberMe: true,
    });
    assert.equal(globalThis.localStorage.getItem(REMEMBER_LOGIN_KEY), JSON.stringify({
      email: 'legacy@example.com',
      rememberMe: true,
    }));
  } finally {
    restoreWindow();
  }
});

test('desktop callback state validates flow and expiry using secure random state', () => {
  const restoreCrypto = installCryptoForTest({
    ...globalThis.crypto,
    randomUUID: () => '11111111-2222-3333-4444-555555555555',
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => array,
  } as Crypto);
  try {
    const state = createDesktopCallbackState('social-oauth');
    assert.ok(validateDesktopCallbackState({
      expectedState: state,
      actualState: state,
      flowKind: 'social-oauth',
      maxAgeMs: DESKTOP_CALLBACK_TIMEOUT_MS,
      nowMs: Date.now() + 1000,
    }));
    assert.equal(validateDesktopCallbackState({
      expectedState: state,
      actualState: state,
      flowKind: 'desktop-web-auth',
    }), false);
    assert.equal(validateDesktopCallbackState({
      expectedState: state,
      actualState: state,
      flowKind: 'social-oauth',
      maxAgeMs: 1,
      nowMs: Date.now() + DESKTOP_CALLBACK_TIMEOUT_MS + 1,
    }), false);
  } finally {
    restoreCrypto();
  }
});

test('desktop callback redirect uri uses expanded non-privileged port range', () => {
  const restoreCrypto = installCryptoForTest({
    ...globalThis.crypto,
    randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto),
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array) {
        array[0] = 0;
      }
      return array;
    },
  } as Crypto);
  try {
    const uri = new URL(createDesktopCallbackRedirectUri());
    assert.equal(uri.hostname, '127.0.0.1');
    assert.equal(uri.pathname, '/oauth/callback');
    assert.equal(Number(uri.port), 1024);
  } finally {
    restoreCrypto();
  }
});

test('localizeAuthError hides raw backend details for unknown messages', () => {
  assert.equal(
    localizeAuthError('SQLSTATE[42P01]: failed to decode auth payload at /internal/auth'),
    'Authentication failed. Please try again.',
  );
});

test('localizeAuthError surfaces bootstrap race clearly', () => {
  assert.equal(
    localizeAuthError('API not initialized'),
    'App is still starting. Please wait a moment and try again.',
  );
});

test('toErrorMessage appends raw auth details in debug boot mode', () => {
  const restoreEnv = installImportMetaEnvForTest({
    VITE_NIMI_DEBUG_BOOT: '1',
  });
  try {
    assert.equal(
      toErrorMessage(new Error('AUTH_FLOW_SUBMIT_HANDLER_MISSING'), 'Email sign-in failed'),
      'Authentication failed. Please try again. [debug: AUTH_FLOW_SUBMIT_HANDLER_MISSING]',
    );
  } finally {
    restoreEnv();
  }
});

test('wallet login keeps cancellations silent but surfaces non-cancellation failures to the UI', async () => {
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
  const desktopCtx = {
    desktopCallbackRequest: null,
    desktopCallbackToken: '',
    desktopCallbackUser: null,
    authToken: null,
  };

  const restoreWindow = installWindowForTest({
    ethereum: {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0x123'];
        if (method === 'eth_chainId') return '0x1';
        throw Object.assign(new Error('User rejected the request'), { code: 4001 });
      },
    },
  });

  try {
    await handleWalletLogin('metamask', setters as never, desktopCtx, adapter as never);
    assert.deepEqual(loginErrors, [null]);
    (globalThis.window as typeof globalThis.window & {
      ethereum: { request: (input: { method: string }) => Promise<unknown> };
    }).ethereum.request = async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return ['0x123'];
      if (method === 'eth_chainId') return '0x1';
      throw new Error('signature verification failed');
    };
    await handleWalletLogin('metamask', setters as never, desktopCtx, adapter as never);
    assert.deepEqual(loginErrors.slice(0, 2), [null, null]);
    assert.equal(typeof loginErrors[2], 'string');
    assert.notEqual(loginErrors[2], '');
  } finally {
    restoreWindow();
  }
});
