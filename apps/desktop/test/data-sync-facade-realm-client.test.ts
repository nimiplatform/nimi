import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSync } from '../src/runtime/data-sync/facade.js';

function clearHotState(): void {
  delete (globalThis as Record<string, unknown>).__NIMI_DATA_SYNC_API_CONFIG__;
}

test('DataSync callApi reuses one Realm client and does not serialize concurrent tasks', async () => {
  clearHotState();
  const dataSync = new DataSync();
  dataSync.initApi({
    realmBaseUrl: 'https://realm.example',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  });

  const seenRealmInstances = new Set<object>();
  let releaseFirstTask: (() => void) | undefined;
  const firstTaskGate = new Promise<void>((resolve) => {
    releaseFirstTask = () => {
      resolve();
    };
  });
  let firstTaskStarted = false;
  let secondTaskStarted = false;

  const firstCall = dataSync.callApi(async (realm) => {
    firstTaskStarted = true;
    seenRealmInstances.add(realm);
    await firstTaskGate;
    return 'first';
  });
  await Promise.resolve();

  const secondCall = dataSync.callApi(async (realm) => {
    secondTaskStarted = true;
    seenRealmInstances.add(realm);
    return 'second';
  });
  await Promise.resolve();

  assert.equal(firstTaskStarted, true);
  assert.equal(secondTaskStarted, true);
  assert.equal(seenRealmInstances.size, 1);

  assert.ok(releaseFirstTask);
  releaseFirstTask();

  const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
  assert.equal(firstResult, 'first');
  assert.equal(secondResult, 'second');
});
