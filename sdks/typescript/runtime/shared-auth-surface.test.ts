import assert from 'node:assert/strict';
import test from 'node:test';

import { RUNTIME_ACCOUNT_METHODS } from './runtime-method-modules';

test('app-facing Runtime account module omits public refresh helper', () => {
  assert.equal(RUNTIME_ACCOUNT_METHODS.includes('invokeRealmUnary'), true);
  assert.equal((RUNTIME_ACCOUNT_METHODS as readonly string[]).includes('refreshAccountSession'), false);
});
