import assert from 'node:assert/strict';
import test from 'node:test';

import { RUNTIME_ACCOUNT_METHODS } from './runtime-method-modules';

test('public Runtime account module omits private refresh and blocked workspace bindings', () => {
  assert.equal(RUNTIME_ACCOUNT_METHODS.includes('invokeRealmUnary'), true);
  assert.equal((RUNTIME_ACCOUNT_METHODS as readonly string[]).includes('refreshAccountSession'), false);
  assert.equal((RUNTIME_ACCOUNT_METHODS as readonly string[]).includes('issueWorkspaceBinding'), false);
  assert.equal((RUNTIME_ACCOUNT_METHODS as readonly string[]).includes('revokeWorkspaceBinding'), false);
});
