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
// D-SHELL-010: Source Observability & Conflicts
// Mods Panel must show source type, source dir, and current status.
// Developer Panel must display source directories, conflicts, reload logs.
// ---------------------------------------------------------------------------

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'world.nimi.observable',
    name: 'Observable Mod',
    description: 'Test mod for observability',
    version: '1.0.0',
    path: '/mods/observable/manifest.json',
    manifest: { name: 'Observable Mod', version: '1.0.0' },
    ...overrides,
  };
}

// 1. ModHubMod exposes source type field
test('D-SHELL-010: mod row carries runtimeSourceType', () => {
  const row = toRuntimeModRow(
    makeSummary({ sourceType: 'dev' }) as never,
    0,
    { isInstalled: true, isEnabled: true },
  );

  assert.equal(row.runtimeSourceType, 'dev');
});

test('D-SHELL-010: mod row carries runtimeSourceType=installed', () => {
  const row = toRuntimeModRow(
    makeSummary({ sourceType: 'installed' }) as never,
    0,
    { isInstalled: true, isEnabled: true },
  );

  assert.equal(row.runtimeSourceType, 'installed');
});

// 2. ModHubMod exposes source directory
test('D-SHELL-010: mod row carries runtimeSourceDir', () => {
  const row = toRuntimeModRow(
    makeSummary({ sourceDir: '/home/dev/my-mods' }) as never,
    0,
    { isInstalled: true, isEnabled: true },
  );

  assert.equal(row.runtimeSourceDir, '/home/dev/my-mods');
});

// 3. ModHubMod status covers all 4 required states
test('D-SHELL-010: runtimeStatus=loaded for healthy enabled mod', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
  });
  assert.equal(row.runtimeStatus, 'loaded');
});

test('D-SHELL-010: runtimeStatus=disabled for disabled mod', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: false,
  });
  assert.equal(row.runtimeStatus, 'disabled');
});

test('D-SHELL-010: runtimeStatus=failed for mod with register failure', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
    failure: { modId: 'world.nimi.observable', error: 'init failed' },
  });
  assert.equal(row.runtimeStatus, 'failed');
});

test('D-SHELL-010: runtimeStatus=conflict for mod with conflict diagnostic', () => {
  const diagnostic: RuntimeModDiagnosticRecord = {
    modId: 'world.nimi.observable',
    status: 'conflict',
    sourceId: 'src-1',
    sourceType: 'dev',
    sourceDir: '/dev/mods',
    conflictPaths: ['/dev/mods-a/manifest.json', '/dev/mods-b/manifest.json'],
  };
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
    diagnostic,
  });
  assert.equal(row.runtimeStatus, 'conflict');
});

// 4. Runtime error is propagated from failure/diagnostic/fused
test('D-SHELL-010: runtimeError is populated from failure', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
    failure: { modId: 'world.nimi.observable', error: 'module parse error' },
  });
  assert.equal(row.runtimeError, 'module parse error');
});

test('D-SHELL-010: runtimeError is populated from fused state', () => {
  const row = toRuntimeModRow(makeSummary() as never, 0, {
    isInstalled: true,
    isEnabled: true,
    fused: { reason: 'crash-loop', lastError: 'stack overflow', at: '2026-01-01T00:00:00Z' },
  });
  assert.equal(row.runtimeError, 'stack overflow');
});

// 5. Failed and conflict mods surface first in management view
test('D-SHELL-010: failed/conflict mods sort before enabled in management view', () => {
  const failedMod = toRuntimeModRow(makeSummary({ id: 'mod.failed', name: 'Failed' }) as never, 0, {
    isInstalled: true,
    isEnabled: true,
    failure: { modId: 'mod.failed', error: 'fail' },
  });
  const enabledMod = toRuntimeModRow(makeSummary({ id: 'mod.ok', name: 'OK' }) as never, 1, {
    isInstalled: true,
    isEnabled: true,
  });

  const sorted = sortModsForManagement([enabledMod, failedMod]);
  assert.equal(sorted[0]?.id, 'mod.failed');
});

// 6. Developer panel displays diagnostics section
test('D-SHELL-010: developer page renders diagnostics with status badges', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /issueDiagnostics/, 'Must filter non-resolved diagnostics');
  assert.match(source, /StatusBadge.*status=\{sourceStatusTone\(record\.status\)\}/, 'Must render status badge per diagnostic');
  assert.match(source, /record\.sourceType/, 'Must display source type per diagnostic');
  assert.match(source, /record\.modId/, 'Must display mod ID per diagnostic');
});

// 7. Developer panel shows recent reloads
test('D-SHELL-010: developer page renders recent reload results', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /runtimeModRecentReloads/, 'Must read recent reloads from store');
  assert.match(source, /record\.occurredAt/, 'Must display reload timestamp');
  assert.match(source, /record\.error/, 'Must display reload errors');
});

// 8. Developer panel shows registered sources with enabled/disabled state
test('D-SHELL-010: developer page renders registered sources with enable/disable controls', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/settings/settings-developer-page.tsx'),
    'utf8',
  );

  assert.match(source, /runtimeModSources\.map/, 'Must iterate over registered sources');
  assert.match(source, /source\.enabled/, 'Must show enabled state');
  assert.match(source, /source\.isDefault/, 'Must show default badge');
  assert.match(source, /toggleSourceEnabled/, 'Must have toggle enable/disable action');
});

// 9. ModHubMod type includes all required observability fields
test('D-SHELL-010: ModHubMod type has required observability fields', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/mod-hub/mod-hub-model.ts'),
    'utf8',
  );

  assert.match(source, /runtimeStatus\?:\s*'loaded'\s*\|\s*'disabled'\s*\|\s*'failed'\s*\|\s*'conflict'/, 'Must have runtimeStatus with 4 states');
  assert.match(source, /runtimeSourceType\?:\s*'installed'\s*\|\s*'dev'/, 'Must have runtimeSourceType');
  assert.match(source, /runtimeSourceDir\?:\s*string/, 'Must have runtimeSourceDir');
  assert.match(source, /runtimeConflictPaths\?:\s*string\[\]/, 'Must have runtimeConflictPaths');
  assert.match(source, /runtimeError\?:\s*string/, 'Must have runtimeError');
});
