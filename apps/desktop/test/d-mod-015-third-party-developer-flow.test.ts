import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// D-MOD-015: Third-party Developer Flow
// All developer operations must be UI-only (no CLI/env vars/startup parameters).
// nimi_data_dir must be configurable in App and apply immediately.
// ---------------------------------------------------------------------------

// 1. All developer bridge operations are callable functions (no CLI dependency)
test('D-MOD-015: developer operations are exposed as async bridge functions', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/mod-local.ts'),
    'utf8',
  );
  const devOps = [
    'listRuntimeModSources',
    'upsertRuntimeModSource',
    'removeRuntimeModSource',
    'getRuntimeModDeveloperMode',
    'setRuntimeModDeveloperMode',
    'getRuntimeModStorageDirs',
    'setRuntimeModDataDir',
    'reloadRuntimeMod',
    'reloadAllRuntimeMods',
    'listRuntimeModDiagnostics',
  ];

  for (const op of devOps) {
    assert.match(source, new RegExp(`export\\s+async\\s+function\\s+${op}\\s*\\(`), `${op} must be a callable async bridge function`);
  }
});

// 2. nimi_data_dir is configurable via bridge (setRuntimeModDataDir exists and takes a string)
test('D-MOD-015: nimi_data_dir configuration is available via bridge', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/mod-local.ts'),
    'utf8',
  );

  assert.match(source, /setRuntimeModDataDir\(nimiDataDir:\s*string\)/, 'Must accept nimiDataDir string parameter');
  assert.match(source, /'runtime_mod_data_dir_set'/, 'Must invoke Tauri command runtime_mod_data_dir_set');
});

// 3. Developer settings page provides UI for all developer operations
test('D-MOD-015: settings developer page provides UI for developer operations', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  // Source directory management
  assert.match(source, /upsertRuntimeModSource/, 'Must have source add via upsertRuntimeModSource');
  assert.match(source, /removeRuntimeModSource/, 'Must have source remove via removeRuntimeModSource');

  // nimi_data_dir configuration
  assert.match(source, /setRuntimeModDataDir/, 'Must have data dir configuration via setRuntimeModDataDir');
  assert.match(source, /syncRuntimeLocalModelsConfig/, 'Must sync runtime local models config after data dir changes');

  // Developer mode toggle
  assert.match(source, /setRuntimeModDeveloperMode/, 'Must have developer mode toggle');

  // Reload controls
  assert.match(source, /reloadAllRuntimeMods/, 'Must have reload all button');

  // Diagnostics display
  assert.match(source, /runtimeModDiagnostics/, 'Must display diagnostics');
});

// 4. No startup parameter dependency in developer settings page
test('D-MOD-015: developer settings page has no startup parameter references', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.doesNotMatch(source, /process\.env/, 'Must not reference process.env');
  assert.doesNotMatch(source, /--dev-mode/, 'Must not reference startup flags');
  assert.doesNotMatch(source, /launch.*param/i, 'Must not reference launch parameters');
});

// 5. StorageDirs type exposes required paths per spec
test('D-MOD-015: RuntimeModStorageDirs exposes nimiDir, nimiDataDir, installedModsDir', () => {
  const typesSource = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/runtime-types.ts'),
    'utf8',
  );

  assert.match(typesSource, /nimiDir:\s*string/, 'Must have nimiDir field');
  assert.match(typesSource, /nimiDataDir:\s*string/, 'Must have nimiDataDir field');
  assert.match(typesSource, /installedModsDir:\s*string/, 'Must have installedModsDir field');
});

// 6. Developer page displays resolved directory paths
test('D-MOD-015: developer page displays resolved storage directory paths', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /resolvedNimiDir/, 'Must display resolved .nimi_dir');
  assert.match(source, /resolvedInstalledModsDir/, 'Must display resolved installed mods dir');
  assert.match(source, /nimiDataDirInput/, 'Must have input for nimi_data_dir');
});
