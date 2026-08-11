import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeConfigCatalogClient } from '../src/shell/renderer/features/runtime-config/runtime-config-catalog-sdk-service.js';
import { createRuntimeConfigLocalAssetAdminClient } from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sdk-service.js';

test('local model center defers Runtime client acquisition until an operation runs', async () => {
  let acquisitionCount = 0;
  const client = createRuntimeConfigLocalAssetAdminClient(() => {
    acquisitionCount += 1;
    throw new Error('DESKTOP_TEST_LOCAL_ASSET_ADMIN_UNAVAILABLE');
  });

  assert.equal(acquisitionCount, 0);
  await assert.rejects(
    client.listAssets(),
    /DESKTOP_TEST_LOCAL_ASSET_ADMIN_UNAVAILABLE/u,
  );
  assert.equal(acquisitionCount, 1);
});

test('Runtime catalog defers connector acquisition until an operation runs', async () => {
  let acquisitionCount = 0;
  const client = createRuntimeConfigCatalogClient(() => {
    acquisitionCount += 1;
    throw new Error('DESKTOP_TEST_CONNECTOR_ADMIN_UNAVAILABLE');
  });

  assert.equal(acquisitionCount, 0);
  await assert.rejects(
    client.listProviders(),
    /DESKTOP_TEST_CONNECTOR_ADMIN_UNAVAILABLE/u,
  );
  assert.equal(acquisitionCount, 1);
});
