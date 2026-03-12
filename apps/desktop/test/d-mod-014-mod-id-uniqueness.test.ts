import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  toRuntimeModRow,
  sortModsForManagement,
} from '../src/shell/renderer/features/mod-hub/mod-hub-model';
import type { RuntimeModDiagnosticRecord } from '../src/shell/renderer/bridge/runtime-bridge/runtime-types';

// ---------------------------------------------------------------------------
// D-MOD-014: Mod ID Global Uniqueness
// Duplicate mod IDs must be marked as 'conflict' and rejected from loading.
// ---------------------------------------------------------------------------

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'world.nimi.test',
    name: 'Test Mod',
    description: 'A test mod',
    version: '1.0.0',
    path: '/mods/test-mod/manifest.json',
    manifest: { name: 'Test Mod', version: '1.0.0' },
    ...overrides,
  };
}

function makeConflictDiagnostic(modId: string, conflictPaths: string[]): RuntimeModDiagnosticRecord {
  return {
    modId,
    status: 'conflict',
    sourceId: 'source-a',
    sourceType: 'dev',
    sourceDir: '/dev/mods-a',
    manifestPath: '/dev/mods-a/manifest.json',
    conflictPaths,
  };
}

// 1. Conflict diagnostic produces 'conflict' visual state
test('D-MOD-014: mod with conflict diagnostic gets visualState=conflict', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
    diagnostic: makeConflictDiagnostic('world.nimi.test', [
      '/dev/mods-a/manifest.json',
      '/dev/mods-b/manifest.json',
    ]),
  });

  assert.equal(row.runtimeStatus, 'conflict');
  assert.equal(row.visualState, 'conflict');
  assert.equal(row.runtimeConflict, true);
});

// 2. Conflicting mods have no primary action (rejected from loading)
test('D-MOD-014: conflicting mod has null primary action (fail-close)', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
    diagnostic: makeConflictDiagnostic('world.nimi.test', [
      '/dev/mods-a/manifest.json',
      '/dev/mods-b/manifest.json',
    ]),
  });

  assert.equal(row.primaryAction, null);
});

// 3. Conflict paths are propagated to the mod row
test('D-MOD-014: conflict paths from diagnostic are carried to mod row', () => {
  const conflictPaths = ['/dev/mods-a/manifest.json', '/dev/mods-b/manifest.json'];
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
    diagnostic: makeConflictDiagnostic('world.nimi.test', conflictPaths),
  });

  assert.deepEqual(row.runtimeConflictPaths, conflictPaths);
});

// 4. Non-conflict mod does not get conflict state
test('D-MOD-014: mod without conflict diagnostic gets normal visual state', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
  });

  assert.notEqual(row.runtimeStatus, 'conflict');
  assert.notEqual(row.visualState, 'conflict');
  assert.equal(row.runtimeConflict, false);
});

// 5. Diagnostic type includes 'conflict' status
test('D-MOD-014: RuntimeModDiagnosticStatus type includes conflict', () => {
  const typesSource = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/runtime-types.ts'),
    'utf8',
  );

  assert.match(
    typesSource,
    /RuntimeModDiagnosticStatus\s*=\s*['"]resolved['"]\s*\|\s*['"]conflict['"]\s*\|\s*['"]invalid['"]/,
    'RuntimeModDiagnosticStatus must include conflict variant',
  );
});

// 6. Diagnostic record includes structured conflict fields
test('D-MOD-014: RuntimeModDiagnosticRecord includes conflictPaths field', () => {
  const typesSource = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/runtime-types.ts'),
    'utf8',
  );

  assert.match(typesSource, /conflictPaths\?:\s*string\[\]/, 'Must have conflictPaths field');
  assert.match(typesSource, /sourceDir:\s*string/, 'Must have sourceDir field');
  assert.match(typesSource, /manifestPath\?:\s*string/, 'Must have manifestPath field');
});

// 7. Conflict has higher management priority than enabled mods (surfaces first)
test('D-MOD-014: conflict mods sort before enabled mods in management view', () => {
  const conflictMod = toRuntimeModRow(makeSummary({ id: 'mod.conflict', name: 'Conflict' }) as never, 0, {
    isInstalled: true,
    isEnabled: true,
    diagnostic: makeConflictDiagnostic('mod.conflict', ['/a', '/b']),
  });

  const enabledMod = toRuntimeModRow(makeSummary({ id: 'mod.enabled', name: 'Enabled' }) as never, 1, {
    isInstalled: true,
    isEnabled: true,
  });

  const sorted = sortModsForManagement([enabledMod, conflictMod]);
  assert.equal(sorted[0]?.id, 'mod.conflict', 'Conflict mod must appear before enabled mod');
});
