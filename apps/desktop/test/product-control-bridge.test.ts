import assert from 'node:assert/strict';
import test from 'node:test';

import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  getProductControlRecord,
  getProductControlCheckSync,
  pickProductDataRootDirectory,
  replaceProductDataRoot,
  selectProductDataRoot,
  startProductControlCheckSync,
} from '../src/shell/renderer/bridge/runtime-bridge/product-control';

type DesktopBridgeTestWindow = {
  __NIMI_HTML_BOOT_ID__?: string;
  __NIMI_ELECTRON_TEST__?: DesktopBridgeTestGlobal['__NIMI_ELECTRON_TEST__'];
  localStorage?: {
    getItem: (key: string) => string | null;
  };
};

type DesktopBridgeTestGlobal = {
  window?: DesktopBridgeTestWindow;
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
  const previousWindow = root.window;
  const hook = { invoke, listen: () => () => undefined };
  root.__NIMI_ELECTRON_TEST__ = hook;
  root.window = {
    ...(previousWindow ?? {}),
    __NIMI_HTML_BOOT_ID__: previousWindow?.__NIMI_HTML_BOOT_ID__ ?? 'product-control-bridge-test',
    __NIMI_ELECTRON_TEST__: hook,
  };
  try {
    return await run();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
    root.window = previousWindow;
  }
}

test('product-control data-root picker uses Kit standard file dialog without a guessed startDirectory', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
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

test('product-control record ignores fabricated renderer-local ready state', async () => {
  const root = globalThis as unknown as DesktopBridgeTestGlobal;
  const previousElectron = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  const rendererState = new Map<string, string>([
    ['nimi.productControl.state', 'ready_for_use'],
    ['nimi.productControl.projection', JSON.stringify({ state: 'ready_for_use' })],
  ]);
  delete root.__NIMI_ELECTRON_TEST__;
  root.window = {
    __NIMI_HTML_BOOT_ID__: 'renderer-only-product-control-test',
    localStorage: {
      getItem: (key) => rendererState.get(key) ?? null,
    },
  };

  try {
    const projection = await getProductControlRecord();
    assert.equal(projection.state, 'config_missing');
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previousElectron;
    root.window = previousWindow;
  }
});

test('product-control record reads the Electron shell projection', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    return {
      path: '/runtime/.nimi/nimi.json',
      exists: true,
      state: 'ready_for_use',
      record: null,
      error: null,
    };
  }, async () => {
    const projection = await getProductControlRecord();
    assert.equal(projection.state, 'ready_for_use');
    assert.equal(projection.path, '/runtime/.nimi/nimi.json');
  });

  assert.deepEqual(calls, [{
    command: 'product_control_record_get',
    payload: {},
  }]);
});

test('source Runtime data-root selection preserves the committed projection without requesting an unavailable restart', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'product_control_record_select_data_root') {
      return {
        path: 'C:/Users/test/.nimi/nimi.json',
        exists: true,
        state: 'data_root_selected',
        record: null,
        error: null,
        configMutation: {
          disposition: 'restart_required',
          reasonCode: 'CONFIG_RESTART_REQUIRED',
          actionHint: 'request_typed_runtime_restart',
        },
      };
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status']) {
      return {
        running: true,
        managed: false,
        launchMode: 'SOURCE',
        grpcAddr: 'nimi-runtime-source-local',
      };
    }
    throw new Error(`unexpected command: ${command}`);
  }, async () => {
    const selected = await selectProductDataRoot('C:/Users/test/nimi-data');
    assert.equal(selected.state, 'data_root_selected');
    assert.equal(selected.configMutation?.reasonCode, 'CONFIG_RESTART_REQUIRED');
  });

  assert.deepEqual(calls, [
    {
      command: 'product_control_record_select_data_root',
      payload: { payload: { dataRoot: 'C:/Users/test/nimi-data' } },
    },
    {
      command: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
      payload: {},
    },
  ]);
});

test('managed Runtime data-root selection still performs the required typed restart and refresh', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'product_control_record_select_data_root') {
      return {
        path: 'C:/Users/test/.nimi/nimi.json',
        exists: true,
        state: 'data_root_selected',
        record: null,
        error: null,
        configMutation: {
          disposition: 'restart_required',
          reasonCode: 'CONFIG_RESTART_REQUIRED',
          actionHint: 'request_typed_runtime_restart',
        },
      };
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status']) {
      return {
        running: true,
        managed: true,
        launchMode: 'RUNTIME',
        grpcAddr: 'nimi-runtime-fixed',
      };
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart']) {
      return {
        running: true,
        managed: true,
        launchMode: 'RUNTIME',
        grpcAddr: 'nimi-runtime-fixed',
      };
    }
    if (command === 'product_control_record_get') {
      return {
        path: 'C:/Users/test/.nimi/nimi.json',
        exists: true,
        state: 'data_root_selected',
        record: null,
        error: null,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  }, async () => {
    const selected = await selectProductDataRoot('D:/nimi-data');
    assert.equal(selected.state, 'data_root_selected');
    assert.equal(selected.configMutation, null);
  });

  assert.deepEqual(calls.map(({ command }) => command), [
    'product_control_record_select_data_root',
    NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
    NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'],
    'product_control_record_get',
  ]);
});

test('post-ready replacement and Check & Sync remain Host-supervised protected commands', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'product_control_root_activation_initialize') {
      return { path: 'C:/Users/test/.nimi/nimi.json', exists: true, state: 'ready_for_use', record: null, error: null };
    }
    if (command === 'product_control_data_root_replace') {
      return {
        path: 'C:/Users/test/.nimi/nimi.json', exists: true, state: 'ready_for_use', record: null, error: null,
        activation: { activated: true, reasonCode: 'DATA_ROOT_REPLACED', actionHint: 'restart_runtime_and_check_sync' },
        configMutation: { disposition: 'restart_required', reasonCode: 'CONFIG_RESTART_REQUIRED', actionHint: 'request_typed_runtime_restart' },
      };
    }
    if (command === 'product_control_check_sync_start' || command === 'product_control_check_sync_get') {
      return {
        run: {
          runId: 'sync_test', rootActivationId: 'rootact_test', trigger: 'manual', state: 'running',
          owners: [{
            ownerId: 'dependencies_environments', state: 'completed',
            resources: [{ kind: 'python_profile', status: 'unavailable', reason: 'PROFILE_RETRY_REQUIRED', nextAction: 'rerun_check_sync' }],
          }], unclaimed: [],
        },
        obligation: { rootActivationId: 'rootact_test', state: 'required' },
        error: null,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  }, async () => {
    const replaced = await replaceProductDataRoot('D:/next-nimi-data');
    assert.equal(replaced.activation?.activated, true);
    assert.equal(replaced.configMutation?.disposition, 'restart_required');
    const started = await startProductControlCheckSync();
    assert.equal(started.run?.state, 'running');
    assert.equal(started.run?.owners[0]?.resources[0]?.nextAction, 'rerun_check_sync');
    assert.equal((await getProductControlCheckSync()).obligation?.state, 'required');
  });

  assert.deepEqual(calls, [
    { command: 'product_control_root_activation_initialize', payload: {} },
    { command: 'product_control_data_root_replace', payload: { payload: { targetRoot: 'D:/next-nimi-data' } } },
    { command: 'product_control_root_activation_initialize', payload: {} },
    { command: 'product_control_check_sync_start', payload: {} },
    { command: 'product_control_check_sync_get', payload: {} },
  ]);
});
