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
    'reloadRuntimeMod',
    'reloadAllRuntimeMods',
    'listRuntimeModDiagnostics',
  ];

  for (const op of devOps) {
    assert.match(source, new RegExp(`export\\s+async\\s+function\\s+${op}\\s*\\(`), `${op} must be a callable async bridge function`);
  }
});

// 2. The mod-developer bridge does not own a casual data-root rewrite. Moving
//    nimi_data after first-run is the staged nimi_data migration flow (P-MIG-007),
//    not a bridge-level pointer setter.
test('D-MOD-015: mod-developer bridge has no casual data-root rewrite primitive', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/mod-local.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /setRuntimeModDataDir/, 'mod-local bridge must not expose a casual data-root setter');
  assert.doesNotMatch(source, /'runtime_mod_data_dir_set'/, 'mod-local bridge must not invoke the retired runtime_mod_data_dir_set command');
});

// 3. Developer settings page provides UI for mod developer operations
test('D-MOD-015: settings developer page provides UI for mod developer operations', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/developer/developer-mod-sources-section.tsx'),
    'utf8',
  );

  // Source directory management
  assert.match(source, /upsertRuntimeModSource/, 'Must have source add via upsertRuntimeModSource');
  assert.match(source, /removeRuntimeModSource/, 'Must have source remove via removeRuntimeModSource');

  assert.doesNotMatch(source, /setRuntimeModDataDir/, 'Mod Developer must not own global data dir configuration');
  assert.doesNotMatch(source, /syncRuntimeLocalModelsConfig/, 'Mod Developer must not own runtime storage path sync');

  // Developer mode toggle
  assert.match(source, /setRuntimeModDeveloperMode/, 'Must have developer mode toggle');

  // Reload controls
  assert.match(source, /reloadAllRuntimeMods/, 'Must have reload all button');

  // Diagnostics display
  assert.match(source, /runtimeModDiagnostics/, 'Must display diagnostics');
});

// P-MIG-007: moving nimi_data after first-run is a migration flow, not a
// casual data-root pointer rewrite. The Data Management page owns the data-root
// migration entry: it must preview the size/impact, then run a confirmed,
// staged, integrity-checked migration via the nimi_data migration bridge.
test('D-MOD-015: data management page owns the nimi_data migration flow', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-data-management-page.tsx'),
    'utf8',
  );

  assert.match(source, /previewNimiDataMigration/, 'Data Management must preview the nimi_data migration impact before any move (P-MIG-007)');
  assert.match(source, /runNimiDataMigration/, 'Data Management must run the confirmed nimi_data migration via bridge (P-MIG-007)');
  assert.doesNotMatch(source, /setRuntimeModDataDir/, 'Data Management must not retain the casual data-root pointer rewrite the migration flow replaced');
  assert.match(source, /syncRuntimeLocalModelsConfig/, 'Data Management must sync runtime storage config after a completed migration');
  assert.match(source, /resolvedLocalModelsDir/, 'Data Management must display resolved runtime local models dir');
  assert.match(source, /resolvedLocalRuntimeStatePath/, 'Data Management must display resolved runtime local state path');
});

// 4. No startup parameter dependency in developer settings page
test('D-MOD-015: developer settings page has no startup parameter references', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/developer/developer-mod-sources-section.tsx'),
    'utf8',
  );

  assert.doesNotMatch(source, /process\.env/, 'Must not reference process.env');
  assert.doesNotMatch(source, /--dev-mode/, 'Must not reference startup flags');
  assert.doesNotMatch(source, /launch.*param/i, 'Must not reference launch parameters');
});

// 5. StorageDirs type exposes required paths per spec
test('D-MOD-015: RuntimeModStorageDirs exposes data, mod, model, and state paths', () => {
  const typesSource = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/runtime-types.ts'),
    'utf8',
  );

  assert.match(typesSource, /nimiDir:\s*string/, 'Must have nimiDir field');
  assert.match(typesSource, /nimiDataDir:\s*string/, 'Must have nimiDataDir field');
  assert.match(typesSource, /installedModsDir:\s*string/, 'Must have installedModsDir field');
  assert.match(typesSource, /localModelsDir:\s*string/, 'Must have localModelsDir field');
  assert.match(typesSource, /localRuntimeStatePath:\s*string/, 'Must have localRuntimeStatePath field');
});

// 6. Data Management page displays resolved directory paths
test('D-MOD-015: data management page displays resolved storage directory paths', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-data-management-page.tsx'),
    'utf8',
  );

  assert.match(source, /resolvedNimiDir/, 'Must display resolved .nimi_dir');
  assert.match(source, /resolvedNimiDataDir/, 'Must display resolved nimi_data_dir');
  assert.match(source, /resolvedInstalledModsDir/, 'Must display resolved installed mods dir');
  assert.match(source, /resolvedLocalModelsDir/, 'Must display resolved runtime local models dir');
  assert.match(source, /resolvedLocalRuntimeStatePath/, 'Must display resolved runtime local state path');
  assert.match(source, /nimiDataDirInput/, 'Must have input for nimi_data_dir');
});
