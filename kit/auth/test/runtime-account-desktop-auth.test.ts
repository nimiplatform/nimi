import { describe, expect, it, vi } from 'vitest';

import { createRuntimeAccountDesktopBrowserAuth } from '../src/logic/runtime-account-desktop-auth';

const testCaller = {
  appId: 'dev.nimi.test',
  appInstanceId: 'dev.nimi.test.local-developer',
  deviceId: 'dev-nimi-test-local-developer-device',
  mode: 7,
  scopes: [],
};

function createFakeClient() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const client = {
    runtime: {
      account: {
        getAccountSessionStatus: vi.fn(async (input) => {
          calls.push({ method: 'getAccountSessionStatus', input });
          return {
            accepted: true,
            snapshot: {
              state: 'authenticated',
              accountProjection: {
                accountId: 'acct-1',
                displayName: 'Runtime User',
              },
            },
          };
        }),
        beginLogin: vi.fn(async (input) => {
          calls.push({ method: 'beginLogin', input });
          return {
            accepted: true,
            loginAttemptId: 'attempt-1',
            oauthAuthorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize?client_id=app',
            state: 'state-1',
            nonce: 'nonce-1',
          };
        }),
        completeLogin: vi.fn(async (input) => {
          calls.push({ method: 'completeLogin', input });
          return {
            accepted: true,
            accountProjection: {
              accountId: 'acct-1',
              displayName: 'Runtime User',
            },
          };
        }),
        logout: vi.fn(async (input) => {
          calls.push({ method: 'logout', input });
          return { accepted: true };
        }),
      },
    },
  };
  return { client, calls };
}

describe('createRuntimeAccountDesktopBrowserAuth', () => {
  it('loads Runtime account projection and brokers login without renderer token custody', async () => {
    const { client, calls } = createFakeClient();
    const onLoginComplete = vi.fn();
    const auth = createRuntimeAccountDesktopBrowserAuth({
      caller: testCaller,
      getClient: () => client,
      isAuthenticatedState: (state) => state === 'authenticated',
      logoutReason: 'test_logout',
    });

    await expect(auth.loadCurrentUser()).resolves.toEqual({
      id: 'acct-1',
      displayName: 'Runtime User',
    });
    expect(calls[0]).toEqual({
      method: 'getAccountSessionStatus',
      input: { caller: testCaller },
    });

    const broker = auth.createRuntimeAccountBroker();
    await expect(broker.begin({
      callbackUrl: 'http://127.0.0.1:4100/oauth/callback',
      timeoutMs: 12_500,
    })).resolves.toMatchObject({
      loginAttemptId: 'attempt-1',
      state: 'state-1',
      nonce: 'nonce-1',
    });

    await expect(broker.complete({
      loginAttemptId: 'attempt-1',
      code: 'oauth-code',
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: 'http://127.0.0.1:4100/oauth/callback',
    })).resolves.toEqual({
      user: {
        id: 'acct-1',
        displayName: 'Runtime User',
      },
    });
    expect(calls.find((call) => call.method === 'completeLogin')?.input).toMatchObject({
      caller: testCaller,
      refreshToken: '',
    });
    expect(JSON.stringify(calls)).not.toContain('accessToken');
    expect(JSON.stringify(calls)).not.toContain('subjectUserId');

    const adapter = auth.createDesktopBrowserAuthAdapter(onLoginComplete);
    await expect(adapter.applyToken('app-token', 'app-refresh')).rejects.toThrow(
      /must not own access or refresh token custody/,
    );
    await expect(adapter.persistSession?.({
      accessToken: 'app-token',
      refreshToken: 'app-refresh',
    })).rejects.toThrow(/must not persist access or refresh tokens/);

    await adapter.clearPersistedSession?.();
    expect(calls.at(-1)).toEqual({
      method: 'logout',
      input: { caller: testCaller, reason: 'test_logout' },
    });
  });
});
