import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMenuBarRuntimeSyncKey,
  buildMenuBarRuntimeSyncPayload,
  MENU_BAR_SYNC_HEARTBEAT_MS,
  shouldSyncMenuBarRuntimeHealth,
  type MenuBarRuntimeSyncState,
} from '../src/shell/renderer/infra/menu-bar/menu-bar-runtime-sync';

function createState(overrides: Partial<MenuBarRuntimeSyncState> = {}): MenuBarRuntimeSyncState {
  return {
    runtimeHealth: null,
    providerHealth: [],
    lastFetchedAt: null,
    lastStreamAt: null,
    error: null,
    streamError: null,
    ...overrides,
  };
}

test('buildMenuBarRuntimeSyncPayload projects runtime status and provider summary', () => {
  const payload = buildMenuBarRuntimeSyncPayload(
    createState({
      runtimeHealth: {
        status: 4,
        reason: 'provider quorum lost',
      } as NonNullable<MenuBarRuntimeSyncState['runtimeHealth']>,
      providerHealth: [
        { state: 'healthy' },
        { state: 'unhealthy' },
        { state: undefined },
      ] as MenuBarRuntimeSyncState['providerHealth'],
      lastStreamAt: '2026-03-15T04:21:14.552Z',
    }),
  );

  assert.deepEqual(payload, {
    runtimeHealthStatus: 'DEGRADED',
    runtimeHealthReason: 'provider quorum lost',
    providerSummary: {
      healthy: 1,
      unhealthy: 1,
      unknown: 1,
      total: 3,
    },
    updatedAt: '2026-03-15T04:21:14.552Z',
  });
});

test('shouldSyncMenuBarRuntimeHealth dedupes unchanged payloads until heartbeat', () => {
  const payload = buildMenuBarRuntimeSyncPayload(
    createState({
      runtimeHealth: {
        status: 3,
        reason: 'ready',
      } as NonNullable<MenuBarRuntimeSyncState['runtimeHealth']>,
      lastStreamAt: '2026-03-15T04:21:14.552Z',
    }),
  );
  const lastSync = {
    key: buildMenuBarRuntimeSyncKey(payload),
    syncedAtMs: 1_000,
  };

  assert.equal(
    shouldSyncMenuBarRuntimeHealth(
      { ...payload, updatedAt: '2026-03-15T04:21:15.552Z' },
      lastSync,
      1_000 + MENU_BAR_SYNC_HEARTBEAT_MS - 1,
    ),
    false,
  );
  assert.equal(
    shouldSyncMenuBarRuntimeHealth(
      { ...payload, updatedAt: '2026-03-15T04:21:24.552Z' },
      lastSync,
      1_000 + MENU_BAR_SYNC_HEARTBEAT_MS,
    ),
    true,
  );
  assert.equal(
    shouldSyncMenuBarRuntimeHealth(
      { ...payload, runtimeHealthReason: 'provider probe failed' },
      lastSync,
      1_500,
    ),
    true,
  );
});
