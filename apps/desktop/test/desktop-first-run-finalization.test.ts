import assert from 'node:assert/strict';
import test from 'node:test';

import { admitProductReadyForUse } from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';

type ElectronInvokeCall = {
  command: string;
  payload: unknown;
};

/**
 * Wave 7 — Desktop first-run finalization wiring.
 *
 * At `local_ai_ready` the renderer requests backend admission of the
 * `ready_for_use` transition via the `product_control_record_admit_ready_for_use`
 * Electron host command. The backend admission op is the sole authority
 * that writes `ready_for_use` (cold-start-authority-contract P-COLD-016); the
 * renderer only requests and routes the returned projection.
 */

function installElectronInvokeMock(
  handler: (command: string, payload?: unknown) => Promise<unknown> | unknown,
): { restore: () => void; calls: ElectronInvokeCall[] } {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousElectron = globalRecord.__NIMI_ELECTRON_TEST__;
  const previousWindow = globalRecord.window;
  const calls: ElectronInvokeCall[] = [];
  globalRecord.__NIMI_ELECTRON_TEST__ = {
    invoke: (command: string, payload?: unknown) => {
      calls.push({ command, payload });
      return handler(command, payload);
    },
  };
  globalRecord.window = {
    __NIMI_HTML_BOOT_ID__: 'renderer-session-finalization-test',
  };
  return {
    calls,
    restore: () => {
      if (typeof previousElectron === 'undefined') {
        delete globalRecord.__NIMI_ELECTRON_TEST__;
      } else {
        globalRecord.__NIMI_ELECTRON_TEST__ = previousElectron;
      }
      if (typeof previousWindow === 'undefined') {
        delete globalRecord.window;
      } else {
        globalRecord.window = previousWindow;
      }
    },
  };
}

test('Wave 7: local_ai_ready finalization invokes the backend admission command', async () => {
  const mock = installElectronInvokeMock((command) => {
    assert.equal(command, 'product_control_record_admit_ready_for_use');
    return {
      path: '/nimi/product-control.json',
      exists: true,
      state: 'ready_for_use',
      error: null,
      record: {
        schemaVersion: 1,
        installId: 'install-1',
        productVersion: '1.0.0',
        state: 'ready_for_use',
        dataRoot: null,
        firstRun: {
          installLevel: 'minimal',
          aiProfileAlias: 'local-speech-ready',
          completed: true,
          completedAt: '2026-07-14T00:00:00.000Z',
        },
        pointers: {},
        repair: { required: false },
      },
    };
  });
  try {
    const projection = await admitProductReadyForUse();
    // A backend ready_for_use projection mounts the ordinary shell; the gate
    // (useDesktopOrdinaryShellAdmission) admits ReadyDesktopShell on this state,
    // which lands at activeTab:'chat' / chatMode:'ai'.
    assert.equal(projection.state, 'ready_for_use');
    assert.equal(projection.record?.firstRun.completed, true);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0]?.command, 'product_control_record_admit_ready_for_use');
    // No-arg admission command — the renderer never supplies refs or state.
    assert.deepEqual(mock.calls[0]?.payload, {});
  } finally {
    mock.restore();
  }
});

test('Wave 7: a failed admission routes to the earliest-failed copy-floor surface', async () => {
  // On failure the backend admission op returns the earliest-failed product
  // state with a non-null error and record: null. The workflow routes to that
  // state's copy-floor surface — never a synthesized ready_for_use.
  const mock = installElectronInvokeMock(() => ({
    path: '/nimi/product-control.json',
    exists: true,
    state: 'local_ai_assets_downloaded_environment_not_ready',
    error: 'current local environment is not ready',
    record: null,
  }));
  try {
    const projection = await admitProductReadyForUse();
    assert.notEqual(projection.state, 'ready_for_use');
    assert.equal(projection.state, 'local_ai_assets_downloaded_environment_not_ready');
    assert.equal(projection.record, null);
    assert.equal(projection.error, 'current local environment is not ready');
  } finally {
    mock.restore();
  }
});

test('Wave 7: admission fails closed when the Electron host is unavailable', async () => {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousElectron = globalRecord.__NIMI_ELECTRON_TEST__;
  delete globalRecord.__NIMI_ELECTRON_TEST__;
  try {
    await assert.rejects(
      () => admitProductReadyForUse(),
      /product_control_record_admit_ready_for_use requires standard shell Runtime/,
    );
  } finally {
    if (typeof previousElectron !== 'undefined') {
      globalRecord.__NIMI_ELECTRON_TEST__ = previousElectron;
    }
  }
});
