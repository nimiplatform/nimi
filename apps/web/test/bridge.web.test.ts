import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopBridge,
  getRuntimeBridgeConfig,
  setRuntimeBridgeConfig,
} from '../src/desktop-adapter/bridge.web.js';

test('bridge.web rejects desktop-only runtime bridge config access', async () => {
  await assert.rejects(
    async () => getRuntimeBridgeConfig(),
    /Runtime bridge config is only available in desktop runtime/,
  );

  await assert.rejects(
    async () => desktopBridge.getRuntimeBridgeConfig(),
    /Runtime bridge config is only available in desktop runtime/,
  );

  await assert.rejects(
    async () => setRuntimeBridgeConfig('{}'),
    /Runtime bridge config updates are only available in desktop runtime/,
  );

  await assert.rejects(
    async () => desktopBridge.setRuntimeBridgeConfig('{}'),
    /Runtime bridge config updates are only available in desktop runtime/,
  );
});
