import assert from 'node:assert/strict';
import test from 'node:test';
import { createElectronRuntimeBridgeCommandNames } from '@nimiplatform/kit/shell/electron/main';

import { observeDesktopRuntimeMaintenance, readDesktopRuntimeMaintenance, readStartupHomeProfileScope, runtimeStatusIsMaintenance, startWindowsHomeRuntime } from '../src-electron/runtime-maintenance.js';
import { createDesktopHomeCommandPolicy } from '../src-electron/home-host-policy.js';

test('only a not-running status with the typed refusal is maintenance', () => {
  assert.equal(runtimeStatusIsMaintenance({ running: false, lastError: 'runtime-stored-data-unsupported' }), true);
  for (const status of [
    { running: true, lastError: 'runtime-stored-data-unsupported' },
    { running: false, lastError: 'runtime-service-unavailable' },
    { running: false },
    null,
    'runtime-stored-data-unsupported',
  ]) {
    assert.equal(runtimeStatusIsMaintenance(status), false, JSON.stringify(status));
  }
});

test('an unreadable Runtime status is not treated as maintenance', async () => {
  assert.equal(await readDesktopRuntimeMaintenance(async () => { throw new Error('runtime-service-unavailable'); }), false);
  assert.equal(await readDesktopRuntimeMaintenance(async () => ({ running: false, lastError: 'runtime-stored-data-unsupported' })), true);
});

test('the maintenance relaunch and replacement stay reachable while ordinary Home work is closed', async () => {
  const policy = createDesktopHomeCommandPolicy(() => false);
  assert.deepEqual(await policy({ command: 'desktop_runtime_maintenance_relaunch' } as never), { allow: true });
  assert.deepEqual(await policy({ command: 'product_control_maintenance_data_root_replace' } as never), { allow: true });
  assert.equal((await policy({ command: 'local_development_start' } as never)).allow, false);
});

test('a late protected maintenance status closes ordinary work before returning it to the renderer', async () => {
  const names = createElectronRuntimeBridgeCommandNames();
  let closed = false;
  const maintenance = { running: false, lastError: 'runtime-stored-data-unsupported' };
  const host = observeDesktopRuntimeMaintenance({
    stop: async () => {},
    invoke: async (command) => {
      if (command === names.start) throw new Error('runtime-service-unavailable');
      return maintenance;
    },
  }, () => { closed = true; });
  assert.equal(await readDesktopRuntimeMaintenance(() => host.invoke(names.start, names)), false);
  assert.equal(closed, false);
  assert.equal(await host.invoke(names.status, names), maintenance);
  assert.equal(closed, true);
});

test('Windows profile preparation defers service start to a pending update and fails closed on an unreadable handoff', async () => {
  let starts = 0;
  const start = async () => { starts++; return { running: true }; };
  assert.deepEqual(await startWindowsHomeRuntime(async () => true, start), { kind: 'deferred' });
  const error = new Error('handoff unreadable');
  assert.deepEqual(await startWindowsHomeRuntime(async () => { throw error; }, start), { kind: 'failed', error });
  assert.equal(starts, 0);
});

test('Windows profile preparation returns the verified service result, including maintenance and failure', async () => {
  const clear = async () => false;
  assert.deepEqual(await startWindowsHomeRuntime(clear, async () => ({ running: true })), { kind: 'ready' });
  assert.deepEqual(await startWindowsHomeRuntime(clear, async () => ({
    running: false, lastError: 'runtime-stored-data-unsupported',
  })), { kind: 'maintenance' });
  const result = await startWindowsHomeRuntime(clear, async () => ({ running: false, lastError: 'runtime-service-untrusted' }));
  assert.equal(result.kind, 'failed');
  if (result.kind === 'failed') assert.match(String(result.error), /runtime-service-untrusted/);
});

test('profile selection waits for the native start; a late result remains available after the pre-ready timeout', async () => {
  for (const withinBudget of [true, false]) {
    let starts = 0;
    let reads = 0;
    let finishStart!: () => void;
    const native = new Promise<{ running: boolean }>(resolve => { finishStart = () => resolve({ running: true }); });
    const preparation = startWindowsHomeRuntime(async () => false, () => { starts++; return native; });
    const scope = readStartupHomeProfileScope(preparation, async () => { reads++; return 'protected scope'; }, withinBudget ? 1_000 : 1);
    assert.equal(reads, 0);
    if (!withinBudget) await assert.rejects(scope, /desktop-home-profile-scope-read-timeout/);
    finishStart();
    assert.deepEqual(await preparation, { kind: 'ready' });
    if (withinBudget) assert.equal(await scope, 'protected scope');
    assert.equal(reads, withinBudget ? 1 : 0);
    assert.equal(starts, 1);
  }
});
