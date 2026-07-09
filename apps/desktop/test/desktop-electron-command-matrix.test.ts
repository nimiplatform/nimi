import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import {
  DESKTOP_ELECTRON_COMMAND_MATRIX,
  DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS,
  DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_COMMANDS,
  DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS,
} from '../src-electron/desktop-electron-command-matrix.js';

const repoRoot = path.join(import.meta.dirname, '../../..');
const checkerPath = path.join(repoRoot, 'scripts/check-desktop-tauri-command-execution.mjs');
const productControlBridgeSource = readFileSync(
  new URL('../src/shell/renderer/bridge/runtime-bridge/product-control.ts', import.meta.url),
  'utf8',
);
const electronAcceptanceSource = readFileSync(
  new URL('../test/electron-acceptance.mjs', import.meta.url),
  'utf8',
);

function readRegisteredDesktopTauriCommands(): string[] {
  const result = spawnSync(process.execPath, [checkerPath, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as { registered: string[] };
  return [...report.registered].sort();
}

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
  assert.ok(DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS.includes('account_default_profile_for_scope_init'));
  assert.ok(DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS.includes('built_in_ai_config_for_scope_init'));
  assert.match(productControlBridgeSource, /product_control_record_admit_ready_for_use requires Tauri runtime/);
  assert.doesNotMatch(productControlBridgeSource, /invokeChecked\('product_control_pick_data_root_directory'/);
});

test('Desktop Electron command matrix covers every active Desktop Tauri command as visibility-only inventory', () => {
  const registered = readRegisteredDesktopTauriCommands();
  const matrixCommands = DESKTOP_ELECTRON_COMMAND_MATRIX.map((entry) => entry.command).sort();

  assert.deepEqual(matrixCommands, registered);

  const uniqueCommands = new Set(matrixCommands);
  assert.equal(uniqueCommands.size, DESKTOP_ELECTRON_COMMAND_MATRIX.length);
  for (const entry of DESKTOP_ELECTRON_COMMAND_MATRIX) {
    assert.ok(
      [
        'standard-shell-covered',
        'electron-covered',
        'intentional-tauri-only',
        'electron-deferred',
        'electron-na',
      ].includes(entry.status),
      `unexpected status for ${entry.command}: ${entry.status}`,
    );
    assert.match(entry.reason, /\S/);
  }
});

test('Desktop Electron command matrix does not claim unimplemented app-domain handlers are covered', () => {
  const coveredCommands = DESKTOP_ELECTRON_COMMAND_MATRIX
    .filter((entry) => entry.status === 'electron-covered')
    .map((entry) => entry.command)
    .sort();

  assert.deepEqual(coveredCommands, [...DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_COMMANDS].sort());
});

test('Desktop Electron acceptance recognizes admission-failed as a renderer surface, not bootstrap crash', () => {
  assert.match(electronAcceptanceSource, /admissionFailed:\s*'\[data-testid="desktop-admission-failed"\]'/);
});
