import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasTauriInvoke,
  hasTauriRuntime,
  installSdkTauriRuntimeHook,
  invokeTauri,
} from '../src/runtime/tauri-api.js';

function resetTauriGlobals(): void {
  const globalRecord = globalThis as Record<string, unknown>;
  delete globalRecord.__NIMI_TAURI_TEST__;
  delete globalRecord.__NIMI_TAURI_RUNTIME__;
  delete globalRecord.__TAURI__;
  delete globalRecord.__TAURI_INTERNALS__;
  delete globalRecord.__TAURI_IPC__;
  delete globalRecord.window;
}

test('installed SDK runtime hook is not treated as native Tauri availability', () => {
  resetTauriGlobals();
  installSdkTauriRuntimeHook();

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
