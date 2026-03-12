import assert from 'node:assert/strict';
import test from 'node:test';

import * as desktopBridge from '../src/shell/renderer/bridge/runtime-bridge';
import * as modLocalBridge from '../src/shell/renderer/bridge/runtime-bridge/mod-local';

test('D-MOD-013: mod source registry bridge surface stays exported', () => {
  assert.equal(typeof modLocalBridge.listRuntimeModSources, 'function');
  assert.equal(typeof modLocalBridge.upsertRuntimeModSource, 'function');
  assert.equal(typeof modLocalBridge.removeRuntimeModSource, 'function');
  assert.equal(typeof modLocalBridge.getRuntimeModStorageDirs, 'function');
  assert.equal(typeof modLocalBridge.setRuntimeModDataDir, 'function');
  assert.equal(typeof modLocalBridge.listRuntimeModDiagnostics, 'function');

  assert.equal(typeof desktopBridge.listRuntimeModSources, 'function');
  assert.equal(typeof desktopBridge.upsertRuntimeModSource, 'function');
  assert.equal(typeof desktopBridge.removeRuntimeModSource, 'function');
  assert.equal(typeof desktopBridge.getRuntimeModStorageDirs, 'function');
  assert.equal(typeof desktopBridge.setRuntimeModDataDir, 'function');
  assert.equal(typeof desktopBridge.listRuntimeModDiagnostics, 'function');
});
