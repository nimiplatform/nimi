import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopBridge,
  listRuntimeLocalModManifests,
  readRuntimeLocalModEntry,
} from '../src/desktop-adapter/bridge.web.js';

test('bridge.web returns empty local mod manifest list in web mode', async () => {
  const manifests = await listRuntimeLocalModManifests();
  assert.deepEqual(manifests, []);

  const bridgeManifests = await desktopBridge.listRuntimeLocalModManifests();
  assert.deepEqual(bridgeManifests, []);
});

test('bridge.web rejects desktop-only local mod entry access', async () => {
  await assert.rejects(
    async () => readRuntimeLocalModEntry('/tmp/local-mod.js'),
    /Local mod entry is only available in desktop runtime/,
  );

  await assert.rejects(
    async () => desktopBridge.readRuntimeLocalModEntry('/tmp/local-mod.js'),
    /Local mod entry is only available in desktop runtime/,
  );
});
