import assert from 'node:assert/strict';
import test from 'node:test';

import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  pickLocalRuntimeAssetDirectory,
  pickLocalRuntimeAssetFile,
  revealLocalRuntimeAssetInFolder,
  revealLocalRuntimeAssetsRootFolder,
} from '../src/shell/renderer/bridge/runtime-bridge/local-runtime-os-helpers';

type DesktopBridgeTestWindow = {
  __NIMI_HTML_BOOT_ID__?: string;
  __NIMI_ELECTRON_TEST__?: DesktopBridgeTestGlobal['__NIMI_ELECTRON_TEST__'];
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
    __NIMI_HTML_BOOT_ID__: previousWindow?.__NIMI_HTML_BOOT_ID__
      ?? 'desktop-local-runtime-os-helpers-test',
    __NIMI_ELECTRON_TEST__: hook,
  };
  try {
    return await run();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
    root.window = previousWindow;
  }
}

function selectedDataRootProjection(dataRoot: string) {
  return {
    path: '/home/tester/.nimi/nimi.json',
    exists: true,
    state: 'ready_for_use',
    dataRoot: {
      path: dataRoot,
      status: 'ready',
      selectedAt: '2026-01-01T00:00:00Z',
      verifiedAt: '2026-01-01T00:00:00Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 1,
    },
    error: null,
  };
}

test('local runtime asset file picker uses Kit standard file dialog with import filters', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    return { canceled: false, paths: ['D:/models/model.gguf'] };
  }, async () => {
    assert.equal(await pickLocalRuntimeAssetFile(), 'D:/models/model.gguf');
  });

  assert.deepEqual(calls, [{
    command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
    payload: {
      payload: {
        kind: 'file',
        title: 'Select asset file to import',
        filters: [
          { name: 'Asset Files', extensions: ['gguf', 'safetensors', 'bin', 'pt', 'onnx', 'pth'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      },
    },
  }]);
});

test('local runtime asset directory picker uses Kit standard directory dialog', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    return { canceled: false, paths: ['D:/models/bundle'] };
  }, async () => {
    assert.equal(await pickLocalRuntimeAssetDirectory(), 'D:/models/bundle');
  });

  assert.deepEqual(calls, [{
    command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
    payload: {
      payload: {
        kind: 'directory',
        title: 'Select asset bundle directory to import',
      },
    },
  }]);
});

test('local runtime asset pickers preserve cancel as null', async () => {
  await withStandardShellInvoke(async () => ({ canceled: true, paths: [] }), async () => {
    assert.equal(await pickLocalRuntimeAssetFile(), null);
    assert.equal(await pickLocalRuntimeAssetDirectory(), null);
  });
});

test('local runtime asset reveal uses Kit standard file reveal for the asset directory', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'product_control_selected_data_root_get') {
      return selectedDataRootProjection('/tmp/nimi-data');
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) {
      return { revealed: true, path: '/tmp/nimi-data/models/asset-1' };
    }
    throw new Error(`unexpected command: ${command}`);
  }, async () => {
    await revealLocalRuntimeAssetInFolder('asset-1');
  });

  assert.deepEqual(calls, [
    { command: 'product_control_selected_data_root_get', payload: {} },
    {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      payload: { payload: { path: '/tmp/nimi-data/models/asset-1' } },
    },
  ]);
});

test('local runtime asset reveal falls back to models root when asset directory is missing', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'product_control_selected_data_root_get') {
      return selectedDataRootProjection('/tmp/nimi-data');
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) {
      const revealPath = (payload as { payload?: { path?: string } }).payload?.path;
      if (revealPath === '/tmp/nimi-data/models/asset-missing') {
        throw {
          code: 'not-found',
          reasonCode: 'electron-file-reveal-target-not-found',
          actionHint: 'materialize_file_before_revealing_it',
        };
      }
      return { revealed: true, path: '/tmp/nimi-data/models' };
    }
    throw new Error(`unexpected command: ${command}`);
  }, async () => {
    await revealLocalRuntimeAssetInFolder('asset-missing');
  });

  assert.deepEqual(calls, [
    { command: 'product_control_selected_data_root_get', payload: {} },
    {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      payload: { payload: { path: '/tmp/nimi-data/models/asset-missing' } },
    },
    {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      payload: { payload: { path: '/tmp/nimi-data/models' } },
    },
  ]);
});

test('local runtime asset reveal sends invalid asset ids directly to models root', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'product_control_selected_data_root_get') {
      return selectedDataRootProjection('/tmp/nimi-data');
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) {
      return { revealed: true, path: '/tmp/nimi-data/models' };
    }
    throw new Error(`unexpected command: ${command}`);
  }, async () => {
    await revealLocalRuntimeAssetInFolder('../asset-1');
  });

  assert.deepEqual(calls, [
    { command: 'product_control_selected_data_root_get', payload: {} },
    {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      payload: { payload: { path: '/tmp/nimi-data/models' } },
    },
  ]);
});

test('local runtime models root reveal uses Kit standard file reveal', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  await withStandardShellInvoke(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'product_control_selected_data_root_get') {
      return selectedDataRootProjection('/tmp/nimi-data');
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) {
      return { revealed: true, path: '/tmp/nimi-data/models' };
    }
    throw new Error(`unexpected command: ${command}`);
  }, async () => {
    await revealLocalRuntimeAssetsRootFolder();
  });

  assert.deepEqual(calls, [
    { command: 'product_control_selected_data_root_get', payload: {} },
    {
      command: NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      payload: { payload: { path: '/tmp/nimi-data/models' } },
    },
  ]);
});
