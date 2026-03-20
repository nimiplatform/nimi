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

test('DataSync proactive refresh success updates tokens, persists hot state, and reschedules refresh', async () => {
  clearHotState();
  const originalRefreshAccessToken = Realm.refreshAccessToken;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const nextAccessToken = makeJwt(3600);
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const setAuthCalls: Array<{ user: Record<string, unknown> | null; token: string; refreshToken?: string }> = [];
  let clearAuthCalls = 0;
  let stopAllPollingCalls = 0;

  Realm.refreshAccessToken = async () => ({
    accessToken: nextAccessToken,
    refreshToken: 'refresh-2',
  });
  globalThis.setTimeout = ((callback: () => void, delayMs?: number) => {
    scheduled.push({ callback, delayMs: Number(delayMs || 0) });
    return Symbol('timeout') as never;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;

  try {
    const dataSync = new DataSync();
    dataSync.initApi({
      realmBaseUrl: 'https://realm.example',
      accessToken: makeJwt(1200),
      refreshToken: 'refresh-1',
    });
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

    await (dataSync as unknown as { doProactiveRefresh(): Promise<void> }).doProactiveRefresh();

    const hotState = readDataSyncHotState();
    assert.equal(hotState?.accessToken, nextAccessToken);
    assert.equal(hotState?.refreshToken, 'refresh-2');
    assert.equal(setAuthCalls.length, 1);
    assert.deepEqual(setAuthCalls[0], {
      user: { id: 'user-1' },
      token: nextAccessToken,
      refreshToken: 'refresh-2',
    });
    assert.equal(clearAuthCalls, 0);
    assert.equal(stopAllPollingCalls, 0);
    assert.equal(scheduled.length, 1);
    assert.ok(scheduled[0]!.delayMs >= 1000);
  } finally {
    Realm.refreshAccessToken = originalRefreshAccessToken;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    clearHotState();
  }
});

test('DataSync proactive refresh failure clears auth, stops polling, and clears the timer', async () => {
  clearHotState();
  const originalRefreshAccessToken = Realm.refreshAccessToken;
  const originalClearTimeout = globalThis.clearTimeout;

  let clearAuthCalls = 0;
  let stopAllPollingCalls = 0;
  const clearedTimers: unknown[] = [];

  Realm.refreshAccessToken = async () => {
    throw new Error('refresh failed');
  };
  globalThis.clearTimeout = ((handle?: unknown) => {
    clearedTimers.push(handle);
  }) as typeof globalThis.clearTimeout;

  try {
    const dataSync = new DataSync();
    dataSync.initApi({
      realmBaseUrl: 'https://realm.example',
      accessToken: makeJwt(1200),
      refreshToken: 'refresh-1',
    });
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

    assert.equal(clearAuthCalls, 1);
    assert.equal(stopAllPollingCalls, 1);
    assert.deepEqual(clearedTimers, ['timer-handle']);
    assert.equal((dataSync as unknown as { proactiveRefreshTimer: unknown }).proactiveRefreshTimer, null);
  } finally {
    Realm.refreshAccessToken = originalRefreshAccessToken;
    globalThis.clearTimeout = originalClearTimeout;
    clearHotState();
  }
});
