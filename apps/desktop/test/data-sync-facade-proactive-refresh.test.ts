import assert from 'node:assert/strict';
import test from 'node:test';

import { Realm } from '@nimiplatform/sdk/realm';
import { DataSync } from '../src/runtime/data-sync/facade.js';
import { readDataSyncHotState } from '../src/runtime/data-sync/facade-hot-state.js';

function makeJwt(expiresInSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function clearHotState(): void {
  delete (globalThis as Record<string, unknown>).__NIMI_DATA_SYNC_API_CONFIG__;
}

test('DataSync Runtime token provider keeps tokens out of hot state and disables proactive refresh ownership', async () => {
  clearHotState();
  const originalRefreshAccessToken = Realm.refreshAccessToken;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const setAuthCalls: Array<{ user: Record<string, unknown> | null; token: string; refreshToken?: string }> = [];
  let clearAuthCalls = 0;
  let stopAllPollingCalls = 0;
  let refreshCalls = 0;

  Realm.refreshAccessToken = async () => {
    refreshCalls += 1;
    throw new Error('DataSync must not own refresh when Runtime token provider is active');
  };
  globalThis.setTimeout = ((callback: () => void, delayMs?: number) => {
    scheduled.push({ callback, delayMs: Number(delayMs || 0) });
    return Symbol('timeout') as never;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;

  try {
    const dataSync = new DataSync();
    dataSync.initApi({
      realmBaseUrl: 'https://realm.example',
      accessTokenProvider: async () => 'runtime-account-access-token',
    });
    dataSync.setToken(makeJwt(1200));
    dataSync.setRefreshToken('refresh-1');
    dataSync.setAuthCallbacks({
      setAuth: (user, token, refreshToken) => {
        setAuthCalls.push({ user: user ?? null, token, refreshToken });
      },
      clearAuth: () => {
        clearAuthCalls += 1;
      },
      getCurrentUser: () => ({ id: 'user-1' }),
      isFriend: () => false,
    });
    dataSync.stopAllPolling = (() => {
      stopAllPollingCalls += 1;
    }) as typeof dataSync.stopAllPolling;

    dataSync.scheduleProactiveRefresh(makeJwt(1200));
    await (dataSync as unknown as { doProactiveRefresh(): Promise<void> }).doProactiveRefresh();

    const hotState = readDataSyncHotState();
    assert.equal(hotState?.accessToken, '');
    assert.equal(hotState?.refreshToken, '');
    assert.equal(refreshCalls, 0);
    assert.equal(setAuthCalls.length, 0);
    assert.equal(clearAuthCalls, 0);
    assert.equal(stopAllPollingCalls, 0);
    assert.equal(scheduled.length, 0);
  } finally {
    Realm.refreshAccessToken = originalRefreshAccessToken;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    clearHotState();
  }
});

test('DataSync legacy refresh path remains unavailable when Runtime provider owns token projection', async () => {
  clearHotState();
  const originalRefreshAccessToken = Realm.refreshAccessToken;
  const originalClearTimeout = globalThis.clearTimeout;

  let clearAuthCalls = 0;
  let stopAllPollingCalls = 0;
  const clearedTimers: unknown[] = [];
  let refreshCalls = 0;

  Realm.refreshAccessToken = async () => {
    refreshCalls += 1;
    throw new Error('refresh failed');
  };
  globalThis.clearTimeout = ((handle?: unknown) => {
    clearedTimers.push(handle);
  }) as typeof globalThis.clearTimeout;

  try {
    const dataSync = new DataSync();
    dataSync.initApi({
      realmBaseUrl: 'https://realm.example',
      accessTokenProvider: async () => 'runtime-account-access-token',
    });
    dataSync.setRefreshToken('refresh-1');
    dataSync.setAuthCallbacks({
      setAuth: () => undefined,
      clearAuth: () => {
        clearAuthCalls += 1;
      },
      getCurrentUser: () => ({ id: 'user-1' }),
      isFriend: () => false,
    });
    dataSync.stopAllPolling = (() => {
      stopAllPollingCalls += 1;
    }) as typeof dataSync.stopAllPolling;
    (dataSync as unknown as { proactiveRefreshTimer: unknown }).proactiveRefreshTimer = 'timer-handle';

    await (dataSync as unknown as { doProactiveRefresh(): Promise<void> }).doProactiveRefresh();

    assert.equal(refreshCalls, 0);
    assert.equal(clearAuthCalls, 0);
    assert.equal(stopAllPollingCalls, 0);
    assert.deepEqual(clearedTimers, []);
    assert.equal((dataSync as unknown as { proactiveRefreshTimer: unknown }).proactiveRefreshTimer, 'timer-handle');
  } finally {
    Realm.refreshAccessToken = originalRefreshAccessToken;
    globalThis.clearTimeout = originalClearTimeout;
    clearHotState();
  }
});

test('DataSync Runtime token provider fails Realm access closed after logout or user switch revokes projection', async () => {
  clearHotState();
  let revoked = false;
  const dataSync = new DataSync();
  dataSync.initApi({
    realmBaseUrl: 'https://realm.example',
    accessTokenProvider: async () => {
      if (revoked) {
        throw new Error('Runtime account access token unavailable: revoked');
      }
      return 'runtime-account-access-token';
    },
    fetchImpl: async (_input, init) => {
      const auth = _input instanceof Request
        ? _input.headers.get('authorization') || ''
        : new Headers(init?.headers as HeadersInit | undefined).get('authorization') || '';
      assert.equal(auth, 'Bearer runtime-account-access-token');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await dataSync.callApi((realm) => realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' }));
  revoked = true;
  await assert.rejects(
    () => dataSync.callApi((realm) => realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' })),
    /Runtime account access token unavailable: revoked/,
  );
  const hotState = readDataSyncHotState();
  assert.equal(hotState?.accessToken, '');
  assert.equal(hotState?.refreshToken, '');
  clearHotState();
});
