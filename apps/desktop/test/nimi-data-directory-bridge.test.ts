import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeNimiDataCleanup,
  parseCleanupOutcome,
  parseCleanupPlan,
  planNimiDataCleanup,
} from '../src/shell/renderer/bridge/runtime-bridge/nimi-data-directory.js';

type ElectronBridgeGlobal = {
  window?: {
    __NIMI_HTML_BOOT_ID__?: string;
  };
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: () => () => void;
  };
};

async function withElectronInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  const root = globalThis as unknown as ElectronBridgeGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  root.window = {
    ...(previousWindow ?? {}),
    __NIMI_HTML_BOOT_ID__: 'nimi-data-directory-bridge-test',
  };
  try {
    return await operation();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
    root.window = previousWindow;
  }
}

test('nimi_data cleanup renderer bridge uses the Electron standard shell host', async () => {
  const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
  await withElectronInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'nimi_data_cleanup_plan') {
      return {
        directory: 'logs',
        owner: 'runtime_product_support',
        cleanupClass: 'confirm_required',
        totalBytes: 12,
        fileCount: 2,
        requiresConfirmation: true,
        runtimeOwnerBlocked: false,
      };
    }
    return {
      directory: 'logs',
      removedBytes: 12,
      removedFiles: 2,
    };
  }, async () => {
    assert.equal((await planNimiDataCleanup('logs')).fileCount, 2);
    assert.equal((await executeNimiDataCleanup('logs', 'CLEAN')).removedFiles, 2);
  });

  assert.deepEqual(calls, [
    {
      command: 'nimi_data_cleanup_plan',
      payload: { directory: 'logs' },
    },
    {
      command: 'nimi_data_cleanup_execute',
      payload: { payload: { directory: 'logs', confirmation: 'CLEAN' } },
    },
  ]);
});

test('nimi_data cleanup renderer bridge rejects malformed host success payloads', () => {
  assert.throws(
    () => parseCleanupPlan({
      directory: 'logs',
      owner: 'runtime_product_support',
      cleanupClass: 'confirm_required',
      totalBytes: '12',
      fileCount: 2,
      requiresConfirmation: true,
      runtimeOwnerBlocked: false,
    }),
    /invalid integer/u,
  );
  assert.throws(
    () => parseCleanupPlan({
      directory: 'logs',
      owner: 'runtime_product_support',
      cleanupClass: 'confirm_required',
      totalBytes: 12,
      fileCount: 2,
      requiresConfirmation: true,
      runtimeOwnerBlocked: false,
      path: '/',
    }),
    /invalid payload/u,
  );
  assert.throws(
    () => parseCleanupOutcome({
      directory: 'logs',
      removedBytes: 12,
      removedFiles: -1,
    }),
    /invalid integer/u,
  );
});
