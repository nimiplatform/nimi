import assert from 'node:assert/strict';
import test from 'node:test';

import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { pickLocalAppRootDirectory } from '../src/shell/renderer/features/apps/apps-local-app-picker';

type DesktopBridgeTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

async function withStandardShellInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as DesktopBridgeTestGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  try {
    return await run();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
}

test('local app root picker uses Kit standard directory dialog', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    return { canceled: false, paths: ['D:/apps/example'] };
  }, async () => {
    assert.equal(await pickLocalAppRootDirectory(), 'D:/apps/example');
  });

  assert.deepEqual(calls, [{
    command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
    payload: {
      payload: {
        kind: 'directory',
        title: 'Select local app root directory',
      },
    },
  }]);
});

test('local app root picker preserves cancel as null', async () => {
  await withStandardShellInvoke(async () => ({ canceled: true, paths: [] }), async () => {
    assert.equal(await pickLocalAppRootDirectory(), null);
  });
});
