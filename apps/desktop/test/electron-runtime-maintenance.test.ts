import assert from 'node:assert/strict';
import test from 'node:test';
import { createElectronRuntimeBridgeCommandNames } from '@nimiplatform/kit/shell/electron/main';

import { observeDesktopRuntimeMaintenance, readDesktopRuntimeMaintenance, runtimeStatusIsMaintenance } from '../src-electron/runtime-maintenance.js';
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
