import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REMEMBER_LOGIN_KEY,
  loadRememberedLogin,
  saveRememberedLogin,
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

async function loadWebAuthStorage() {
  vi.resetModules();
  const restoreEnv = installImportMetaEnvForTest({
    VITE_NIMI_SHELL_MODE: 'web',
  });
  const module = await import('../auth/src/logic/auth-session-storage.js');
  return { module, restoreEnv };
}

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(String(key));
    },
    setItem(key: string, value: string) {
      entries.set(String(key), String(value));
    },
  };
}

function installMemoryLocalStorageForTest(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
  });
}

beforeEach(() => {
  installMemoryLocalStorageForTest();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('remembered login storage', () => {
  it('stores only email and rememberMe metadata', () => {
    saveRememberedLogin({
      email: 'user@example.com',
      rememberMe: true,
    });

    const stored = JSON.parse(String(localStorage.getItem(REMEMBER_LOGIN_KEY) || '{}')) as {
      email?: string;
      rememberMe?: boolean;
      password?: string;
      expiresAt?: string;
    };
    expect(stored.email).toBe('user@example.com');
    expect(stored.rememberMe).toBe(true);
    expect(typeof stored.expiresAt).toBe('string');
    expect('password' in stored).toBe(false);
  });

  it('migrates legacy stored passwords out of localStorage', () => {
    localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({
      email: 'legacy@example.com',
      password: 'plaintext-secret',
      rememberMe: true,
    }));

    expect(loadRememberedLogin()).toEqual({
      email: 'legacy@example.com',
      rememberMe: true,
    });
    const stored = JSON.parse(String(localStorage.getItem(REMEMBER_LOGIN_KEY) || '{}')) as {
      email?: string;
      rememberMe?: boolean;
      password?: string;
      expiresAt?: string;
    };
    expect(stored.email).toBe('legacy@example.com');
    expect(stored.rememberMe).toBe(true);
    expect(typeof stored.expiresAt).toBe('string');
    expect('password' in stored).toBe(false);
  });

  it('clears expired entries from localStorage', () => {
    localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({
      email: 'expired@example.com',
      rememberMe: true,
      updatedAt: new Date(Date.now() - (40 * 24 * 60 * 60 * 1000)).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }));

    expect(loadRememberedLogin()).toBeNull();
    expect(localStorage.getItem(REMEMBER_LOGIN_KEY)).toBeNull();
  });
});

describe('web auth session metadata storage', () => {
  it('clears expired web auth session metadata from localStorage', async () => {
    const { module, restoreEnv } = await loadWebAuthStorage();
    try {
      localStorage.setItem(module.WEB_AUTH_SESSION_KEY, JSON.stringify({
        accessToken: 'header.payload.signature',
        user: { id: 'u1' },
        updatedAt: new Date(Date.now() - 7200000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }));

      expect(module.loadPersistedAuthSession()).toBeNull();
      expect(localStorage.getItem(module.WEB_AUTH_SESSION_KEY)).toBeNull();
    } finally {
      restoreEnv();
    }
  });

  it('stores session expiry metadata without raw access tokens', async () => {
    const { module, restoreEnv } = await loadWebAuthStorage();
    try {
      const payload = Buffer.from(JSON.stringify({
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      const token = `header.${payload}.signature`;

      module.persistAuthSession({
        accessToken: token,
        user: { id: 'u1' },
      });

      const stored = JSON.parse(String(localStorage.getItem(module.WEB_AUTH_SESSION_KEY) || '{}')) as {
        accessToken?: string;
        expiresAt?: string;
        user?: { id?: string };
      };
      expect(typeof stored.expiresAt).toBe('string');
      expect('accessToken' in stored).toBe(false);
      expect(stored.user?.id).toBe('u1');
    } finally {
      restoreEnv();
    }
  });

  it('stores explicit web auth metadata without accepting raw tokens', async () => {
    const { module, restoreEnv } = await loadWebAuthStorage();
    try {
      module.persistAuthSessionMetadata({
        user: { id: 'u1' },
        updatedAt: '2026-04-24T00:00:00.000Z',
        expiresAt: '2026-04-24T01:00:00.000Z',
      });

      const stored = JSON.parse(String(localStorage.getItem(module.WEB_AUTH_SESSION_KEY) || '{}')) as {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: string;
        user?: { id?: string };
      };
      expect(stored.expiresAt).toBe('2026-04-24T01:00:00.000Z');
      expect('accessToken' in stored).toBe(false);
      expect('refreshToken' in stored).toBe(false);
      expect(stored.user?.id).toBe('u1');
    } finally {
      restoreEnv();
    }
  });

  it('never restores raw access tokens and prunes legacy token keys', async () => {
    const { module, restoreEnv } = await loadWebAuthStorage();
    try {
      localStorage.setItem(module.WEB_AUTH_SESSION_KEY, JSON.stringify({
        accessToken: 'header.payload.signature',
        refreshToken: 'refresh-token',
        user: { id: 'u1' },
        updatedAt: '2026-04-24T00:00:00.000Z',
        expiresAt: '2099-04-24T01:00:00.000Z',
      }));

      const session = module.loadPersistedAuthSession();
      const token = module.loadPersistedAccessToken();
      const raw = String(localStorage.getItem(module.WEB_AUTH_SESSION_KEY) || '');

      expect(token).toBe('');
      expect(session?.user?.id).toBe('u1');
      expect(raw).not.toContain('"accessToken"');
      expect(raw).not.toContain('"refreshToken"');
    } finally {
      restoreEnv();
    }
  });
});
