import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS,
  DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS,
} from '../src-electron/desktop-electron-command-matrix.js';

const productControlBridgeSource = readFileSync(
  new URL('../src/shell/renderer/bridge/runtime-bridge/product-control.ts', import.meta.url),
  'utf8',
);
const electronAcceptanceSource = readFileSync(
  new URL('../test/electron-acceptance.mjs', import.meta.url),
  'utf8',
);

test('Desktop Electron command matrix admits Runtime-local product-control reads and setup mutations only', () => {
  assert.ok(DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.includes(
    '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  ));
  assert.ok(DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.includes(
    '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState',
  ));
  assert.equal(
    DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.some((methodId) =>
      methodId.includes('AdmitProductControlReadyForUse')),
    false,
  );
});

test('Desktop Electron command matrix explicitly leaves admission repair commands Tauri-only', () => {
  assert.ok(DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS.includes('product_control_record_admit_ready_for_use'));
  assert.ok(DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS.includes('product_control_pick_data_root_directory'));
  assert.match(productControlBridgeSource, /product_control_record_admit_ready_for_use requires Tauri runtime/);
  assert.match(productControlBridgeSource, /product_control_pick_data_root_directory requires Tauri runtime/);
});

test('Desktop Electron acceptance recognizes admission-failed as a renderer surface, not bootstrap crash', () => {
  assert.match(electronAcceptanceSource, /admissionFailed:\s*'\[data-testid="desktop-admission-failed"\]'/);
});
