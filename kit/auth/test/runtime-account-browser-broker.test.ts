import { describe, expect, it, vi } from 'vitest';

import { createRuntimeAccountBrowserBroker } from '../src/logic/runtime-account-browser-broker';

describe('createRuntimeAccountBrowserBroker', () => {
  it('begins runtime account login with runtime-owned authorize URL', async () => {
    const beginLogin = vi.fn(async () => ({
      accepted: true,
      loginAttemptId: 'attempt-1',
      oauthAuthorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize?client_id=app',
      state: 'state-1',
      nonce: 'nonce-1',
    }));
    const completeLogin = vi.fn();
    const beforeRequest = vi.fn();

    const broker = createRuntimeAccountBrowserBroker({
      caller: { appId: 'dev.nimi.test' },
      beforeRequest,
      requestedScopes: ['profile', 'profile', ''],
      getClient: () => ({
        runtime: {
          account: {
            beginLogin,
            completeLogin,
          },
        },
      }),
    });

    await expect(broker.begin({
      callbackUrl: 'http://127.0.0.1:4100/oauth/callback',
      timeoutMs: 12_500,
    })).resolves.toEqual({
      loginAttemptId: 'attempt-1',
      authorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize?client_id=app',
      state: 'state-1',
      nonce: 'nonce-1',
    });

    expect(beforeRequest).toHaveBeenCalledOnce();
    expect(beginLogin).toHaveBeenCalledWith({
      caller: { appId: 'dev.nimi.test' },
      redirectUri: 'http://127.0.0.1:4100/oauth/callback',
      callbackOrigin: 'http://127.0.0.1:4100',
      requestedScopes: ['profile'],
      ttlSeconds: 13,
    });
  });

  it('completes runtime account login without exposing refresh token custody to apps', async () => {
    const beginLogin = vi.fn();
    const completeLogin = vi.fn(async () => ({
      accepted: true,
      accountProjection: {
        accountId: 'acct-1',
        displayName: 'Runtime User',
        realmEnvironmentId: 'realm-dev',
      },
    }));

    const broker = createRuntimeAccountBrowserBroker({
      caller: { appId: 'dev.nimi.test' },
      getClient: () => ({
        runtime: {
          account: {
            beginLogin,
            completeLogin,
          },
        },
      }),
    });

    await expect(broker.complete({
      loginAttemptId: 'attempt-1',
      code: 'oauth-code',
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: 'http://localhost:4100/oauth/callback',
    })).resolves.toEqual({
      user: {
        id: 'acct-1',
        displayName: 'Runtime User',
        realmEnvironmentId: 'realm-dev',
      },
    });

    expect(completeLogin).toHaveBeenCalledWith({
      caller: { appId: 'dev.nimi.test' },
      loginAttemptId: 'attempt-1',
      code: 'oauth-code',
      refreshToken: '',
      state: 'state-1',
      nonce: 'nonce-1',
      redirectUri: 'http://localhost:4100/oauth/callback',
      callbackOrigin: 'http://localhost:4100',
      uxTraceId: '',
      sealedCompletionTicket: '',
    });
  });

  it('rejects retired desktop relay authorize URLs', async () => {
    const broker = createRuntimeAccountBrowserBroker({
      caller: { appId: 'dev.nimi.test' },
      getClient: () => ({
        runtime: {
          account: {
            beginLogin: async () => ({
              accepted: true,
              loginAttemptId: 'attempt-1',
              oauthAuthorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize?desktop_callback=http%3A%2F%2Flocalhost',
              state: 'state-1',
              nonce: 'nonce-1',
            }),
            completeLogin: vi.fn(),
          },
        },
      }),
    });

    await expect(broker.begin({
      callbackUrl: 'http://127.0.0.1:4100/oauth/callback',
      timeoutMs: 1_000,
    })).rejects.toThrow(/retired desktop relay URL/);
  });
});
