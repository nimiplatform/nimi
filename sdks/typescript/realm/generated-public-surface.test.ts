import assert from 'node:assert/strict';
import test from 'node:test';

import { REALM_OPERATION_BY_ID } from '../core-generated/realm-client';
import * as realmGenerated from './generated';

test('realm generated public barrel does not expose raw descriptor client surface', () => {
  const oldAddGroupSourceOperation = ['addGroup', 'Agent'].join('');
  const oldRemoveGroupSourceOperation = ['removeGroup', 'Agent'].join('');

  assert.equal('RealmGeneratedClient' in realmGenerated, false);
  assert.equal('REALM_OPERATIONS' in realmGenerated, false);
  assert.equal('REALM_OPERATION_BY_ID' in realmGenerated, false);
  assert.equal('RealmTypedClient' in realmGenerated, true);
  assert.equal(REALM_OPERATION_BY_ID.has('commitRealmGroupMessageCandidate'), false);
  assert.equal(REALM_OPERATION_BY_ID.has(oldAddGroupSourceOperation), false);
  assert.equal(REALM_OPERATION_BY_ID.has(oldRemoveGroupSourceOperation), false);
});
