import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loginWithPassword, registerWithPassword } from '../src/runtime/data-sync/flows/auth-flow.js';

type AuthResult = {
  tokens?: {
    user?: Record<string, unknown> | null;
    accessToken?: string;
    refreshToken?: string;
  };
};

function createAuthCallApi(result: AuthResult) {
  return async <T>(task: (realm: never) => Promise<T>): Promise<T> => {
    const realm = {
      services: {
        AuthService: {
          passwordLogin: async () => result,
          passwordRegister: async () => result,
        },
      },
    };
    return task(realm as never);
  };
}

test('password login fails closed when Realm returns no access token', async () => {
  const tokens: string[] = [];
  const refreshTokens: string[] = [];
  const authCalls: unknown[] = [];

  await assert.rejects(
    () => loginWithPassword(
      createAuthCallApi({ tokens: { user: { id: 'user-1' }, refreshToken: 'refresh-only' } }),
      (token) => { tokens.push(String(token || '')); },
      'user@example.com',
      'password',
      { flowId: 'login-missing-token', startedAt: 0 },
      (token) => { refreshTokens.push(String(token || '')); },
      (...args) => { authCalls.push(args); },
    ),
    /DATASYNC_AUTH_ACCESS_TOKEN_REQUIRED/,
  );

  assert.deepEqual(tokens, []);
  assert.deepEqual(refreshTokens, []);
  assert.deepEqual(authCalls, []);
});

test('password register fails closed when Realm returns no access token', async () => {
  const tokens: string[] = [];
  const refreshTokens: string[] = [];
  const authCalls: unknown[] = [];

  await assert.rejects(
    () => registerWithPassword(
      createAuthCallApi({ tokens: { user: { id: 'user-1' }, accessToken: '   ' } }),
      (token) => { tokens.push(String(token || '')); },
      'user@example.com',
      'password',
      { flowId: 'register-missing-token', startedAt: 0 },
      (token) => { refreshTokens.push(String(token || '')); },
      (...args) => { authCalls.push(args); },
    ),
    /DATASYNC_AUTH_ACCESS_TOKEN_REQUIRED/,
  );

  assert.deepEqual(tokens, []);
  assert.deepEqual(refreshTokens, []);
  assert.deepEqual(authCalls, []);
});

test('password login applies concrete access token and optional refresh token', async () => {
  const tokens: string[] = [];
  const refreshTokens: string[] = [];
  const authCalls: unknown[] = [];

  await loginWithPassword(
    createAuthCallApi({
      tokens: {
        user: { id: 'user-1' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    }),
    (token) => { tokens.push(String(token || '')); },
    'user@example.com',
    'password',
    { flowId: 'login-token', startedAt: 0 },
    (token) => { refreshTokens.push(String(token || '')); },
    (...args) => { authCalls.push(args); },
  );

  assert.deepEqual(tokens, ['access-token']);
  assert.deepEqual(refreshTokens, ['refresh-token']);
  assert.deepEqual(authCalls, [[{ id: 'user-1' }, 'access-token', 'refresh-token']]);
});
