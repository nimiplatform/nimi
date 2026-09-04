import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMenuBarRuntimeSyncKey,
  buildMenuBarRuntimeSyncPayload,
  MENU_BAR_SYNC_HEARTBEAT_MS,
  shouldSyncMenuBarRuntimeHealth,
  type MenuBarRuntimeSyncState,
} from '../src/shell/renderer/infra/menu-bar/menu-bar-runtime-sync';
import {
  parseMenuBarOpenTabPayload,
} from '../src/shell/shared/menu-bar-types.js';
import {
  syncMenuBarRuntimeHealth,
} from '../src/shell/renderer/bridge/runtime-bridge/menu-bar.js';

function createState(overrides: Partial<MenuBarRuntimeSyncState> = {}): MenuBarRuntimeSyncState {
  return {
    runtimeHealth: null,
    lastFetchedAt: null,
    lastStreamAt: null,
    error: null,
    streamError: null,
    ...overrides,
  };
}

test('menu-bar Runtime sync projects runtime status', () => {
  const payload = buildMenuBarRuntimeSyncPayload(
    createState({
      runtimeHealth: {
        status: 4,
        reason: 'provider quorum lost',
      } as NonNullable<MenuBarRuntimeSyncState['runtimeHealth']>,
      lastStreamAt: '2026-03-15T04:21:14.552Z',
    }),
  );

  assert.deepEqual(payload, {
    runtimeHealthStatus: 'DEGRADED',
    runtimeHealthReason: 'provider quorum lost',
    updatedAt: '2026-03-15T04:21:14.552Z',
  });
});

test('menu-bar Runtime sync dedupes unchanged payloads until the 10s heartbeat', () => {
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
});

test('menu-bar navigation accepts only the closed runtime pages and Settings shape', () => {
  assert.deepEqual(
    parseMenuBarOpenTabPayload({ tab: 'runtime', page: 'environment' }),
    { tab: 'runtime', page: 'environment' },
  );
  assert.deepEqual(
    parseMenuBarOpenTabPayload({ tab: 'runtime', page: 'modelMarket' }),
    { tab: 'runtime', page: 'modelMarket' },
  );
  assert.throws(
    () => parseMenuBarOpenTabPayload({ tab: 'runtime', page: 'models' }),
    /menu-bar-open-tab-payload-invalid/u,
  );
  assert.throws(
    () => parseMenuBarOpenTabPayload({ tab: 'runtime', page: 'advanced' }),
    /menu-bar-open-tab-payload-invalid/u,
  );
  assert.deepEqual(parseMenuBarOpenTabPayload({ tab: 'settings' }), { tab: 'settings' });
  assert.throws(
    () => parseMenuBarOpenTabPayload({ tab: 'runtime', page: 'unknown' }),
    /menu-bar-open-tab-payload-invalid/u,
  );
  assert.throws(
    () => parseMenuBarOpenTabPayload({ tab: 'settings', page: 'overview' }),
    /menu-bar-open-tab-payload-invalid/u,
  );
});

test('menu-bar health bridge requires Electron and validates the host acknowledgement', async () => {
  const root = globalThis as unknown as {
    window?: {
      __NIMI_ELECTRON_TEST__?: {
        invoke: (command: string, payload?: unknown) => Promise<unknown>;
        listen: () => () => void;
      };
    };
    __NIMI_ELECTRON_TEST__?: {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
      listen: () => () => void;
    };
  };
  const previous = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  const calls: Array<{ command: string; payload: unknown }> = [];
  try {
    root.__NIMI_ELECTRON_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return { synced: true };
      },
      listen: () => () => undefined,
    };
    root.window = { __NIMI_ELECTRON_TEST__: root.__NIMI_ELECTRON_TEST__ };
    await syncMenuBarRuntimeHealth({
      runtimeHealthStatus: 'READY',
      updatedAt: '2026-07-29T00:00:00.000Z',
    });
    assert.deepEqual(calls, [{
      command: 'menu_bar_sync_runtime_health',
      payload: {
        payload: {
          runtimeHealthStatus: 'READY',
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
      },
    }]);

    root.__NIMI_ELECTRON_TEST__.invoke = async () => ({ synced: false });
    await assert.rejects(
      syncMenuBarRuntimeHealth({ runtimeHealthStatus: 'READY' }),
      /menu-bar-runtime-health-sync-result-invalid/u,
    );
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
    root.window = previousWindow;
  }
});
