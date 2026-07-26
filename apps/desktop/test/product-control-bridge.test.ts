import assert from 'node:assert/strict';
import test from 'node:test';

import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { pickProductDataRootDirectory } from '../src/shell/renderer/bridge/runtime-bridge/product-control';

type DesktopBridgeTestWindow = {
  __NIMI_HTML_BOOT_ID__?: string;
  __NIMI_TAURI_TEST__?: DesktopBridgeTestGlobal['__NIMI_TAURI_TEST__'];
};

type DesktopBridgeTestGlobal = {
  window?: DesktopBridgeTestWindow;
  __NIMI_TAURI_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => Promise<() => void> | (() => void);
  };
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

async function withStandardShellInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as unknown as DesktopBridgeTestGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  try {
    return await run();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
}

async function withTauriShellInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as unknown as DesktopBridgeTestGlobal;
  const previous = root.__NIMI_TAURI_TEST__;
  const previousWindow = root.window;
  const hook = { invoke, listen: () => () => undefined };
  root.__NIMI_TAURI_TEST__ = hook;
  root.window = {
    ...(previousWindow ?? {}),
    __NIMI_HTML_BOOT_ID__: previousWindow?.__NIMI_HTML_BOOT_ID__ ?? 'product-control-bridge-test',
    __NIMI_TAURI_TEST__: hook,
  };
  try {
    return await run();
  } finally {
    root.__NIMI_TAURI_TEST__ = previous;
    root.window = previousWindow;
  }
}

test('product-control data-root picker uses Kit standard file dialog without a guessed startDirectory', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withTauriShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    return { canceled: false, paths: ['D:/nimi-data'] };
  }, async () => {
    await assert.doesNotReject(async () => {
      const picked = await pickProductDataRootDirectory();
      assert.equal(picked, 'D:/nimi-data');
    });
  });

  assert.deepEqual(calls, [{
    command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
    payload: {
      payload: {
        kind: 'directory',
        title: 'Choose where Nimi stores models and data',
      },
    },
  }]);
});

test('product-control data-root picker preserves cancel as null', async () => {
  await withStandardShellInvoke(async () => ({ canceled: true, paths: [] }), async () => {
    assert.equal(await pickProductDataRootDirectory(), null);
  });
});
