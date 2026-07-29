import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRuntimeBridgeStatus,
} from '../src/shell/renderer/bridge/runtime-bridge/runtime-daemon.js';

type ElectronHostGlobal = {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: () => () => void;
  };
};

test('Desktop Runtime lifecycle fails closed without the Electron standard shell host', async () => {
  const root = globalThis as unknown as ElectronHostGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  delete root.__NIMI_ELECTRON_TEST__;
  try {
    await assert.rejects(
      getRuntimeBridgeStatus(),
      /requires the Electron standard shell host/u,
    );
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
});

test('Desktop Runtime lifecycle reads the real Electron host status', async () => {
  const root = globalThis as unknown as ElectronHostGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
  root.__NIMI_ELECTRON_TEST__ = {
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      return {
        running: true,
        managed: true,
        launchMode: 'RUNTIME',
        grpcAddr: 'protected-desktop-control',
        pid: 123,
        version: '0.1.0',
      };
    },
    listen: () => () => undefined,
  };
  try {
    const status = await getRuntimeBridgeStatus();
    assert.equal(status.running, true);
    assert.equal(status.managed, true);
    assert.equal(status.pid, 123);
    assert.deepEqual(calls, [{
      command: 'nimi.shell.runtimeLifecycle.status',
      payload: {},
    }]);
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
});
