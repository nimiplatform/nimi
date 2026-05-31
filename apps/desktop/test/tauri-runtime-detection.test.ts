import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasTauriInvoke,
  hasTauriRuntime,
  invokeTauri,
} from '@nimiplatform/kit/shell/renderer/bridge';

function resetTauriGlobals(): void {
  const globalRecord = globalThis as Record<string, unknown>;
  delete globalRecord.__NIMI_TAURI_TEST__;
  delete globalRecord.__NIMI_TAURI_RUNTIME__;
  delete globalRecord.__TAURI__;
  delete globalRecord.__TAURI_INTERNALS__;
  delete globalRecord.__TAURI_IPC__;
  delete globalRecord.window;
}

test('the Kit-installed runtime hook is not treated as native Tauri availability', () => {
  resetTauriGlobals();
  // Simulate the hook installNimiShellRuntimeBridge() publishes. Desktop's
  // detection probes must still report no native Tauri — the hook is a transport,
  // not a capability-availability signal.
  (globalThis as Record<string, unknown>).__NIMI_TAURI_RUNTIME__ = {
    invoke: async () => null,
    listen: async () => () => {},
  };

  assert.equal(hasTauriRuntime(), false);
  assert.equal(hasTauriInvoke(), false);

  resetTauriGlobals();
});

test('native Tauri invoke is detected by function presence only', () => {
  resetTauriGlobals();
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(null),
  };

  assert.equal(hasTauriRuntime(), true);
  assert.equal(hasTauriInvoke(), true);

  resetTauriGlobals();
});

test('direct invoke can use the published SDK runtime hook without relaxing availability probes', async () => {
  resetTauriGlobals();
  (globalThis as Record<string, unknown>).__NIMI_TAURI_RUNTIME__ = {
    invoke: async (command: string, payload: unknown) => ({ command, payload }),
  };

  assert.equal(hasTauriRuntime(), false);
  assert.equal(hasTauriInvoke(), false);
  assert.deepEqual(await invokeTauri('runtime_bridge_status', { ok: true }), {
    command: 'runtime_bridge_status',
    payload: { ok: true },
  });

  resetTauriGlobals();
});
