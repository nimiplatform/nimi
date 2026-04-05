import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BOOTSTRAP_RUNTIME_MODS_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-runtime-mods.ts',
);
const runtimeModsSource = readFileSync(BOOTSTRAP_RUNTIME_MODS_PATH, 'utf-8');

test('D-BOOT: bootstrap runtime mods does not re-sync shell state after reconcile', () => {
  assert.ok(
    runtimeModsSource.includes('const { manifests, failures } = await reconcileRuntimeLocalMods();'),
    'bootstrap runtime mods must reconcile local mods',
  );
  assert.ok(
    !runtimeModsSource.includes('syncRuntimeModShellState('),
    'bootstrap runtime mods must not perform a second shell-state sync after reconcileRuntimeLocalMods()',
  );
});

test('D-BOOT: bootstrap runtime mods surfaces failures in-context instead of global banner noise', () => {
  assert.doesNotMatch(
    runtimeModsSource,
    /bootstrapPartialFailure/,
  );
  assert.doesNotMatch(
    runtimeModsSource,
    /setStatusBanner\(/,
  );
});

test('D-BOOT: App watchdog uses distinct completion/failure event names', () => {
  const appSource = readFileSync(resolve(import.meta.dirname, '../src/shell/renderer/App.tsx'), 'utf-8');
  assert.ok(
    appSource.includes("message: 'phase:bootstrap-watchdog:done'"),
    'App watchdog completion log must use a distinct event name',
  );
  assert.ok(
    appSource.includes("message: 'phase:bootstrap-watchdog:failed'"),
    'App watchdog failure log must use a distinct event name',
  );
});
