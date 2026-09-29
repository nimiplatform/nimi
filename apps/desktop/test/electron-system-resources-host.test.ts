import assert from 'node:assert/strict';
import { mkdtemp, rm, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import {
  collectDesktopElectronSystemResourceSnapshot,
  createDesktopElectronSystemResourcesHost,
  memoryPressureFromMacosLevel,
  resolveDataRootForDisk,
} from '../src-electron/system-resources-host.js';

const MEMORY_PRESSURES = ['normal', 'warning', 'critical', 'unknown'];

test('Electron system resources host reports an observed local snapshot', async () => {
  const snapshot = await collectDesktopElectronSystemResourceSnapshot({ resolveDataRoot: async () => os.tmpdir() });
  assert.ok(snapshot.cpuPercent >= 0 && snapshot.cpuPercent <= 100);
  assert.ok(snapshot.memoryTotalBytes > 0);
  assert.ok(snapshot.memoryUsedBytes >= 0 && snapshot.memoryUsedBytes <= snapshot.memoryTotalBytes);
  assert.ok(MEMORY_PRESSURES.includes(snapshot.memoryPressure));
  if (process.platform === 'darwin') {
    assert.notEqual(snapshot.memoryPressure, 'unknown', 'macOS reports its own memory pressure level');
  } else {
    assert.equal(snapshot.memoryPressure, 'unknown');
  }
  assert.ok(snapshot.diskTotalBytes !== null && snapshot.diskTotalBytes > 0);
  assert.ok(snapshot.diskUsedBytes !== null && snapshot.diskUsedBytes >= 0 && snapshot.diskUsedBytes <= snapshot.diskTotalBytes);
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

test('macOS pressure levels map to a closed set and anything else stays unknown', () => {
  assert.equal(memoryPressureFromMacosLevel('1\n'), 'normal');
  assert.equal(memoryPressureFromMacosLevel('2'), 'warning');
  assert.equal(memoryPressureFromMacosLevel('4'), 'critical');
  for (const level of ['0', '3', '8', '', 'normal', '-1']) {
    assert.equal(memoryPressureFromMacosLevel(level), 'unknown', level);
  }
});

test('the reported pressure comes from the OS verdict, not from the occupancy share', async () => {
  const host = createDesktopElectronSystemResourcesHost({ readMemoryPressure: async () => 'critical' });
  const snapshot = await host.commandHandlers.get_system_resource_snapshot({ payload: {} });
  assert.equal(snapshot.memoryPressure, 'critical');
});

test('disk usage is measured on the volume holding the selected data root', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-resources-root-'));
  try {
    let asked = 0;
    const snapshot = await collectDesktopElectronSystemResourceSnapshot({
      resolveDataRoot: async () => { asked += 1; return dataRoot; },
      readMemoryPressure: async () => 'normal',
    });
    const volume = await statfs(dataRoot);
    assert.equal(asked, 1);
    assert.equal(snapshot.diskTotalBytes, volume.bsize * volume.blocks);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test('an absent data root leaves disk unavailable and keeps memory and CPU measurements', async () => {
  const snapshot = await collectDesktopElectronSystemResourceSnapshot({
    resolveDataRoot: async () => path.join(os.tmpdir(), 'nimi-resources-missing', String(process.pid), 'root'),
    readMemoryPressure: async () => 'normal',
  });
  assert.equal(snapshot.diskTotalBytes, null);
  assert.equal(snapshot.diskUsedBytes, null);
  assert.ok(snapshot.memoryTotalBytes > 0);
  assert.ok(snapshot.cpuPercent >= 0);
});

test('the data root is used only when Nimi reports an absolute path in time', async () => {
  assert.equal(await resolveDataRootForDisk(undefined), null);
  assert.equal(await resolveDataRootForDisk(async () => '/Volumes/Models/nimi'), '/Volumes/Models/nimi');
  assert.equal(await resolveDataRootForDisk(async () => 'relative/root'), null);
  assert.equal(await resolveDataRootForDisk(async () => { throw new Error('runtime-unavailable'); }), null);

  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = resolveDataRootForDisk(() => new Promise<string>(() => undefined));
    mock.timers.tick(1_000);
    assert.equal(await pending, null);
  } finally {
    mock.timers.reset();
  }
});
