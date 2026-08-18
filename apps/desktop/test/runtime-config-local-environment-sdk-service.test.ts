import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeConfigCatalogClient } from '../src/shell/renderer/features/runtime-config/runtime-config-catalog-sdk-service.js';
import { createRuntimeConfigLocalEnvironmentClient } from '../src/shell/renderer/features/runtime-config/runtime-config-local-environment-sdk-service.js';

test('local environment client defers Runtime RPC acquisition until an operation runs', async () => {
  let acquisitionCount = 0;
  const client = createRuntimeConfigLocalEnvironmentClient(() => {
    acquisitionCount += 1;
    throw new Error('DESKTOP_TEST_LOCAL_ENVIRONMENT_UNAVAILABLE');
  });

  assert.equal(acquisitionCount, 0);
  await assert.rejects(
    client.listModelAssets(),
    /DESKTOP_TEST_LOCAL_ENVIRONMENT_UNAVAILABLE/u,
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
