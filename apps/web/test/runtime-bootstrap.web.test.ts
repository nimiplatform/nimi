import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  bootstrapAuthSessionForTest,
  isExpectedUnauthorizedAutoLogin,
  withTimeout,
} from '../src/desktop-adapter/runtime-bootstrap.web.js';
import { hasDesktopCallbackRequestInLocation } from '../../../kit/auth/src/logic/desktop-callback-helpers.js';

const runtimeBootstrapWebSource = readFileSync(
  new URL('../src/desktop-adapter/runtime-bootstrap.web.ts', import.meta.url),
  'utf8',
);

test('runtime-bootstrap.web detects unauthorized auto-login errors', () => {
  assert.equal(isExpectedUnauthorizedAutoLogin(new Error('HTTP_401 token expired')), true);
  assert.equal(isExpectedUnauthorizedAutoLogin(new Error('request unauthorized by policy')), true);
  assert.equal(isExpectedUnauthorizedAutoLogin(new Error('network timeout')), false);
});

test('runtime-bootstrap.web withTimeout resolves and times out deterministically', async () => {
  const resolved = await withTimeout(Promise.resolve('ok'), 20, 'fast-path');
  assert.equal(resolved, 'ok');

  await assert.rejects(
    async () => withTimeout(new Promise<void>(() => {}), 10, 'timeout-branch'),
    /timeout-branch timeout after 10ms/,
  );
});

test('runtime-bootstrap.web detects desktop callback requests in hash and search params', () => {
  assert.equal(
    hasDesktopCallbackRequestInLocation({
      search: '',
      hash: '#/login?desktop_callback=http%3A%2F%2F127.0.0.1%3A54093%2Foauth%2Fcallback&desktop_state=desktop%3Av1',
    }),
    true,
  );
  assert.equal(
    hasDesktopCallbackRequestInLocation({
      search: '?desktop_callback=http%3A%2F%2F127.0.0.1%3A54093%2Foauth%2Fcallback',
      hash: '#/login',
    }),
    true,
  );
  assert.equal(
    hasDesktopCallbackRequestInLocation({
      search: '',
      hash: '#/login',
    }),
    false,
  );
});

test('runtime-bootstrap.web defers chat and contact hydration until UI demand', () => {
  const bootstrapAuthSessionSection = runtimeBootstrapWebSource.slice(
    runtimeBootstrapWebSource.indexOf('async function bootstrapAuthSession'),
    runtimeBootstrapWebSource.indexOf('export function bootstrapRuntime()'),
  );

  assert.doesNotMatch(bootstrapAuthSessionSection, /deps\.dataSync\.loadChats\(\)/);
  assert.doesNotMatch(bootstrapAuthSessionSection, /deps\.dataSync\.loadContacts\(\)/);
});

test('runtime-bootstrap.web no longer restores bearer tokens from browser storage', () => {
  assert.doesNotMatch(runtimeBootstrapWebSource, /loadPersistedAccessToken/);
  assert.doesNotMatch(runtimeBootstrapWebSource, /fallbackToken/);
});

test('runtime-bootstrap.web preserves persisted web auth storage during desktop callback bootstrap', () => {
  assert.match(runtimeBootstrapWebSource, /preservePersistedAuthSession = deps\.hasDesktopCallbackRequestInLocation\(\);/);
  assert.match(runtimeBootstrapWebSource, /if \(!input\.preservePersistedAuthSession\) \{\s*deps\.clearPersistedAccessToken\(\);/s);
});

test('runtime-bootstrap.web desktop callback refreshes access token from same-origin session and preserves auth store', async () => {
  const callLog: string[] = [];
  let authState = {
    status: 'authenticated',
    user: { id: 'persisted-user' },
    token: 'persisted-token',
    refreshToken: 'persisted-refresh',
  };
  const deps = {
    dataSync: {
      callApi: async (task: (realm: {
        services: {
          AuthService: {
            refreshToken: () => Promise<{ accessToken: string; refreshToken: string }>;
          };
        };
      }) => Promise<unknown>) => {
        callLog.push('refreshToken');
        return task({
          services: {
            AuthService: {
              refreshToken: async () => ({
                accessToken: 'cookie-session-token',
                refreshToken: 'cookie-session-refresh',
              }),
            },
          },
        });
      },
      loadCurrentUser: async () => {
        callLog.push('loadCurrentUser');
        return { id: 'current-user' };
      },
      setToken: (token: string) => {
        callLog.push(`setToken:${token}`);
      },
      setRefreshToken: (token: string) => {
        callLog.push(`setRefreshToken:${token}`);
      },
    },
    useAppStore: {
      getState: () => ({
        auth: authState,
        setAuthSession: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => {
          authState = {
            status: 'authenticated',
            user,
            token,
            refreshToken: refreshToken || '',
          };
        },
        clearAuthSession: () => {
          authState = {
            status: 'anonymous',
            user: null,
            token: '',
            refreshToken: '',
          };
        },
      }),
    },
    clearPersistedAccessToken: () => {
      throw new Error('desktop callback must not clear persisted auth storage');
    },
    persistAuthSession: (input: { accessToken: string; refreshToken?: string; user?: Record<string, unknown> | null }) => {
      callLog.push(`persist:${input.accessToken}:${String(input.refreshToken || '')}`);
    },
    logRendererEvent: () => undefined,
  };

  await bootstrapAuthSessionForTest({
    flowId: 'flow-1',
    accessToken: '',
    refreshToken: '',
    preservePersistedAuthSession: true,
    authSessionSnapshot: {
      status: 'authenticated',
      user: { id: 'persisted-user' },
      token: '',
      refreshToken: '',
    },
  }, deps as never);

  assert.deepEqual(callLog, [
    'refreshToken',
    'setToken:cookie-session-token',
    'setRefreshToken:cookie-session-refresh',
    'loadCurrentUser',
    'persist:cookie-session-token:cookie-session-refresh',
  ]);
  assert.equal(authState.status, 'authenticated');
  assert.equal(authState.token, 'cookie-session-token');
});

test('runtime-bootstrap.web desktop callback restores prior auth snapshot when current-user load fails', async () => {
  let clearPersistedCalls = 0;
  let authState = {
    status: 'authenticated',
    user: { id: 'persisted-user' },
    token: 'persisted-token',
    refreshToken: 'persisted-refresh',
  };
  const tokenWrites: string[] = [];
  const deps = {
    dataSync: {
      callApi: async () => {
        throw new Error('should not refresh when snapshot token exists');
      },
      loadCurrentUser: async () => {
        throw new Error('HTTP_401 current user unauthorized');
      },
      setToken: (token: string) => {
        tokenWrites.push(`token:${token}`);
      },
      setRefreshToken: (token: string) => {
        tokenWrites.push(`refresh:${token}`);
      },
    },
    useAppStore: {
      getState: () => ({
        auth: authState,
        setAuthSession: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => {
          authState = {
            status: 'authenticated',
            user,
            token,
            refreshToken: refreshToken || '',
          };
        },
        clearAuthSession: () => {
          authState = {
            status: 'anonymous',
            user: null,
            token: '',
            refreshToken: '',
          };
        },
      }),
    },
    clearPersistedAccessToken: () => {
      clearPersistedCalls += 1;
    },
    persistAuthSession: () => undefined,
    logRendererEvent: () => undefined,
  };

  await bootstrapAuthSessionForTest({
    flowId: 'flow-2',
    accessToken: '',
    refreshToken: '',
    preservePersistedAuthSession: true,
    authSessionSnapshot: {
      status: 'authenticated',
      user: { id: 'persisted-user' },
      token: 'persisted-token',
      refreshToken: 'persisted-refresh',
    },
  }, deps as never);

  assert.equal(clearPersistedCalls, 0);
  assert.deepEqual(tokenWrites, [
    'token:persisted-token',
    'refresh:persisted-refresh',
    'token:persisted-token',
    'refresh:persisted-refresh',
  ]);
  assert.equal(authState.status, 'authenticated');
  assert.equal(authState.token, 'persisted-token');
});
