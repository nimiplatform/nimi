import assert from 'node:assert/strict';
import test from 'node:test';

import { claimUnownedModels } from '../sdks/generators/lib/runtime-realm-carrier.mjs';

test('Runtime Realm carrier models have one package-level owner', () => {
  const claimed = new Set();
  const authError = { name: 'AuthErrorDto', schema: { kind: 'object' } };
  const introspectionError = { name: 'IntrospectSessionErrorDto', schema: { kind: 'object' } };

  assert.deepEqual(claimUnownedModels([authError], claimed), [authError]);
  assert.deepEqual(claimUnownedModels([authError, introspectionError], claimed), [introspectionError]);
  assert.deepEqual([...claimed], ['AuthErrorDto', 'IntrospectSessionErrorDto']);
});
