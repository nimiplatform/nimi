import assert from 'node:assert/strict';
import test from 'node:test';

import { REALM_OPERATION_BY_ID } from '../core-generated/realm-client';
import * as realmGenerated from './generated';

test('realm generated public barrel does not expose raw descriptor client surface', () => {
  const oldAddGroupSourceOperation = ['addGroup', 'Agent'].join('');
  const oldRemoveGroupSourceOperation = ['removeGroup', 'Agent'].join('');
  const oldCreatePersonaOperation = ['WorldCoreController', 'createRealm', 'Persona'].join('_');

  assert.equal('RealmGeneratedClient' in realmGenerated, false);
  assert.equal('REALM_OPERATIONS' in realmGenerated, false);
  assert.equal('REALM_OPERATION_BY_ID' in realmGenerated, false);
  assert.equal('RealmTypedClient' in realmGenerated, false);
  assert.equal('SourceMaterializationPacketV3Dto' in realmGenerated, false);
  assert.equal('AppPermissionGrantRequestDto' in realmGenerated, false);
  assert.equal(REALM_OPERATION_BY_ID.has('commitRealmGroupSourceMessageCandidate'), true);
  assert.equal(REALM_OPERATION_BY_ID.has('addGroupSourceParticipant'), true);
  assert.equal(REALM_OPERATION_BY_ID.has('removeGroupSourceParticipant'), true);
  assert.equal(REALM_OPERATION_BY_ID.has(oldAddGroupSourceOperation), false);
  assert.equal(REALM_OPERATION_BY_ID.has(oldRemoveGroupSourceOperation), false);
  assert.equal(REALM_OPERATION_BY_ID.has(oldCreatePersonaOperation), false);
  assert.equal(REALM_OPERATION_BY_ID.has('WorldCoreController_createPersonaCharacter'), true);
  assert.equal(
    REALM_OPERATION_BY_ID.get('WorldCoreController_getWorldCharacter')?.path,
    '/api/realm/core/world-characters/by-id/{characterId}',
  );
  assert.equal(REALM_OPERATION_BY_ID.get('EconomyController_getSourceOrigin')?.method, 'POST');
  assert.equal(REALM_OPERATION_BY_ID.get('EconomyController_previewRevenueDistribution')?.method, 'POST');
});
