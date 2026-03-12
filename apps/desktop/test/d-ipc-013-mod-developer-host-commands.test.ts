import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as modLocalBridge from '../src/shell/renderer/bridge/runtime-bridge/mod-local';

// ---------------------------------------------------------------------------
// D-IPC-013: Mod Developer Host Commands
// Desktop must expose a managed IPC surface for mod developer host operations.
// ---------------------------------------------------------------------------

// 1. Source registry: list, add, remove, enable, disable
test('D-IPC-013: source registry IPC commands are exported', () => {
  assert.equal(typeof modLocalBridge.listRuntimeModSources, 'function');
  assert.equal(typeof modLocalBridge.upsertRuntimeModSource, 'function');
  assert.equal(typeof modLocalBridge.removeRuntimeModSource, 'function');
});

// 2. Storage dirs: read .nimi_dir, nimi_data_dir, installed mods paths, and update nimi_data_dir
test('D-IPC-013: storage directory IPC commands are exported', () => {
  assert.equal(typeof modLocalBridge.getRuntimeModStorageDirs, 'function');
  assert.equal(typeof modLocalBridge.setRuntimeModDataDir, 'function');
});

// 3. Developer mode: read/toggle App Developer Mode state
test('D-IPC-013: developer mode IPC commands are exported', () => {
  assert.equal(typeof modLocalBridge.getRuntimeModDeveloperMode, 'function');
  assert.equal(typeof modLocalBridge.setRuntimeModDeveloperMode, 'function');
});

// 4. Reload controls: reload single mod or all mods
test('D-IPC-013: reload IPC commands are exported', () => {
  assert.equal(typeof modLocalBridge.reloadRuntimeMod, 'function');
  assert.equal(typeof modLocalBridge.reloadAllRuntimeMods, 'function');
});

// 5. Diagnostics: list source scan results, duplicate mod ID conflicts, recent reload results
test('D-IPC-013: diagnostics IPC command is exported', () => {
  assert.equal(typeof modLocalBridge.listRuntimeModDiagnostics, 'function');
});

// 6. Manifest listing
test('D-IPC-013: manifest listing IPC command is exported', () => {
  assert.equal(typeof modLocalBridge.listRuntimeLocalModManifests, 'function');
});

// 7. Verify the IPC commands invoke the correct Tauri command names
test('D-IPC-013: mod-local bridge invokes correct Tauri command names', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/mod-local.ts'),
    'utf8',
  );

  const requiredCommands = [
    'runtime_mod_sources_list',
    'runtime_mod_sources_upsert',
    'runtime_mod_sources_remove',
    'runtime_mod_storage_dirs_get',
    'runtime_mod_data_dir_set',
    'runtime_mod_dev_mode_get',
    'runtime_mod_dev_mode_set',
    'runtime_mod_reload',
    'runtime_mod_reload_all',
    'runtime_mod_diagnostics_list',
    'runtime_mod_list_local_manifests',
  ];

  for (const command of requiredCommands) {
    assert.ok(
      source.includes(`'${command}'`),
      `mod-local.ts must invoke Tauri command: ${command}`,
    );
  }
});

// 8. Event subscriptions for live reload notifications
test('D-IPC-013: event subscription functions are exported', () => {
  assert.equal(typeof modLocalBridge.subscribeRuntimeModSourceChanged, 'function');
  assert.equal(typeof modLocalBridge.subscribeRuntimeModReloadResult, 'function');
});
