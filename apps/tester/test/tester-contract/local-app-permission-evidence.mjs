import assert from 'node:assert/strict';
import test from 'node:test';
import { importBehaviorModule } from './helpers.mjs';

test('revoke evidence accepts only the closed typed revocation reasons', async () => {
  const { isExpectedRevokedPermissionError } = await importBehaviorModule(
    'tester/local-app-permission-evidence.js',
  );
  assert.equal(isExpectedRevokedPermissionError(
    Object.assign(new Error('revoked'), { reasonCode: 'permission-revoked' }),
  ), true);
  assert.equal(isExpectedRevokedPermissionError(
    Object.assign(new Error('revoked'), { reasonCode: 'LOCAL_APP_PERMISSION_REVOKED' }),
  ), true);
  assert.equal(isExpectedRevokedPermissionError(
    Object.assign(new Error('runtime down'), { reasonCode: 'runtime-service-unavailable' }),
  ), false);
  assert.equal(isExpectedRevokedPermissionError(
    Object.assign(new Error('unknown'), { reasonCode: 'unexpected-failure' }),
  ), false);
  assert.equal(isExpectedRevokedPermissionError(new Error('permission-revoked')), false);
});

test('reserved evidence accepts only the SDK not-admitted contract error', async () => {
  const { isExpectedReservedPermissionError } = await importBehaviorModule(
    'tester/local-app-permission-evidence.js',
  );
  assert.equal(isExpectedReservedPermissionError(
    Object.assign(new Error('reserved'), { reasonCode: 'SDK_PERMISSION_NOT_ADMITTED' }),
  ), true);
  assert.equal(isExpectedReservedPermissionError(
    Object.assign(new Error('runtime down'), { reasonCode: 'runtime-service-unavailable' }),
  ), false);
  assert.equal(isExpectedReservedPermissionError(
    Object.assign(new Error('unknown'), { reasonCode: 'unexpected-failure' }),
  ), false);
  assert.equal(isExpectedReservedPermissionError(new Error('SDK_PERMISSION_NOT_ADMITTED')), false);
});
