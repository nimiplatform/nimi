import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeLocalAssetAdminClient,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  type NimiRuntimeLocalAssetAdminRpc,
} from './runtime-local-asset-admin';

test('Runtime local client does not expose the retired LocalAsset and local Profile planes', () => {
  const client = createNimiRuntimeLocalAssetAdminClient({
    local: {} as NimiRuntimeLocalAssetAdminRpc,
  });
  for (const method of [
    'listAssets',
    'snapshot',
    'rescanBundle',
    'inspectRemoval',
    'remove',
    'start',
    'stop',
    'scanUnregisteredAssets',
    'resolveProfile',
    'applyProfile',
  ]) {
    assert.equal(method in client, false, `${method} must stay outside the canonical client`);
  }
});

test('Runtime local environment state helpers retain Runtime-owned state semantics', () => {
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobActiveState('DOWNLOADING'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobActiveState('ready'), false);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobRetryableState('failed'), true);
  assert.equal(isNimiRuntimeLocalEnvironmentDependencyJobRetryableState('running'), false);
});
