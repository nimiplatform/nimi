import assert from 'node:assert/strict';
import test from 'node:test';

import { readDesktopRuntimeMaintenance, runtimeStatusIsMaintenance } from '../src-electron/runtime-maintenance.js';
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
