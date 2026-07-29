import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectDesktopElectronSystemResourceSnapshot,
  createDesktopElectronSystemResourcesHost,
} from '../src-electron/system-resources-host.js';

test('Electron system resources host reports an observed local snapshot', async () => {
  const snapshot = await collectDesktopElectronSystemResourceSnapshot();
  assert.ok(snapshot.cpuPercent >= 0 && snapshot.cpuPercent <= 100);
  assert.ok(snapshot.memoryTotalBytes > 0);
  assert.ok(snapshot.memoryUsedBytes >= 0 && snapshot.memoryUsedBytes <= snapshot.memoryTotalBytes);
  assert.ok(snapshot.diskTotalBytes > 0);
  assert.ok(snapshot.diskUsedBytes >= 0 && snapshot.diskUsedBytes <= snapshot.diskTotalBytes);
  assert.equal(snapshot.temperatureCelsius, null);
  assert.equal(snapshot.source, `electron-${process.platform}`);
  assert.ok(snapshot.capturedAtMs > 0);
});

test('Electron system resources host rejects renderer payload fields', async () => {
  const host = createDesktopElectronSystemResourcesHost();
  await assert.rejects(
    host.commandHandlers.get_system_resource_snapshot({ payload: { path: '/' } }),
    /desktop-system-resources-payload-invalid/u,
  );
});
