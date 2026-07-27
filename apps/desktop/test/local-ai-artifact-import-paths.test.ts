import assert from 'node:assert/strict';
import test from 'node:test';

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

test('pickLocalRuntimeAssetManifestPath uses the unified Tauri manifest picker', async () => {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousHook = globalRecord.__NIMI_TAURI_TEST__;
  const previousWindow = globalRecord.window;

  globalRecord.__NIMI_TAURI_TEST__ = {
    invoke: async (command: string, payload?: unknown) => {
      calls.push({ command, payload });
      return '/tmp/runtime-models/resolved/demo/asset.manifest.json';
    },
    listen: async () => () => {},
  };
  globalRecord.window = {
    __NIMI_HTML_BOOT_ID__: 'renderer-session-local-runtime-picker-test',
  };

  try {
    const { pickLocalRuntimeAssetManifestPath } = await import('../src/shell/renderer/bridge/runtime-bridge/local-runtime-os-helpers');
    const manifestPath = await pickLocalRuntimeAssetManifestPath();
    assert.equal(manifestPath, '/tmp/runtime-models/resolved/demo/asset.manifest.json');
    assert.deepEqual(calls, [{
      command: 'runtime_local_pick_asset_manifest_path',
      payload: {},
    }]);
  } finally {
    if (typeof previousHook === 'undefined') {
      delete globalRecord.__NIMI_TAURI_TEST__;
    } else {
      globalRecord.__NIMI_TAURI_TEST__ = previousHook;
    }
    if (typeof previousWindow === 'undefined') {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  }
});
