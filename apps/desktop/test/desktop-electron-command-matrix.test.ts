import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import {
  DESKTOP_ELECTRON_COMMAND_MATRIX,
  DESKTOP_ELECTRON_DESKTOP_OPEN_COMMANDS,
  DESKTOP_ELECTRON_FIRST_RUN_EVIDENCE_COMMANDS,
  DESKTOP_ELECTRON_LOCAL_DEVELOPMENT_COMMANDS,
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

test('Desktop Electron method matrix matches the complete exact protected product-control set', () => {
  assert.ok(DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.includes(
    '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  ));
  assert.ok(DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.includes(
    '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState',
  ));
  assert.ok(DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.includes(
    '/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse',
  ));
  assert.ok(DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.includes(
    '/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob',
  ));
  assert.equal(DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS.length, 21);
});

test('Desktop Electron command matrix covers first-run evidence and admission through the standard shell', () => {
  assert.ok(DESKTOP_ELECTRON_FIRST_RUN_EVIDENCE_COMMANDS.includes('product_control_record_admit_ready_for_use'));
  assert.ok(DESKTOP_ELECTRON_FIRST_RUN_EVIDENCE_COMMANDS.includes('account_default_profile_for_scope_init'));
  assert.ok(DESKTOP_ELECTRON_FIRST_RUN_EVIDENCE_COMMANDS.includes('built_in_ai_config_for_scope_init'));
  assert.match(productControlBridgeSource, /product_control_record_admit_ready_for_use requires standard shell Runtime/);
  assert.doesNotMatch(productControlBridgeSource, /invokeChecked\('product_control_pick_data_root_directory'/);
});

test('Desktop Electron product-control consumes the final Kit shell carrier, never an SDK generated client', () => {
  assert.match(productControlBridgeSource, /hasShellHostInvoke\(\)/);
  assert.match(productControlBridgeSource, /invokeChecked\('product_control_record_get'/);
  assert.doesNotMatch(productControlBridgeSource, /getDesktopRuntime\(\)/);
  assert.doesNotMatch(productControlBridgeSource, /getDesktopRuntime\(\)\.generated/);
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

  assert.deepEqual(coveredCommands, [
    ...DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_COMMANDS,
    ...DESKTOP_ELECTRON_FIRST_RUN_EVIDENCE_COMMANDS,
    ...DESKTOP_ELECTRON_LOCAL_DEVELOPMENT_COMMANDS,
    ...DESKTOP_ELECTRON_DESKTOP_OPEN_COMMANDS,
    'developer_mode_set',
    'developer_mode_status',
  ].sort());
});

test('Desktop Electron acceptance recognizes admission-failed as a renderer surface, not bootstrap crash', () => {
  assert.match(electronAcceptanceSource, /admissionFailed:\s*'\[data-testid="desktop-admission-failed"\]'/);
});
