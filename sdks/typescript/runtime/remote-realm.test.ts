import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteAppRealmClients } from './remote-realm.js';
import { AccountReasonCode, ReasonCode, type RuntimeTypedClient } from '../core-generated/runtime-typed-client.js';
import { InvokeRealmUnaryResponse } from '../core-generated/runtime-protobuf/runtime/v1/account.js';

// Resource adapter fixtures cover the typed broker envelope and projections;
// they are not Realm ownership, source admission or product acceptance.
function fixture() {
  const calls: Parameters<RuntimeTypedClient['invokeRealmUnary']>[0][] = [];
  let response = InvokeRealmUnaryResponse.create({ accepted: true, reasonCode: ReasonCode.ACTION_EXECUTED,
    accountReasonCode: AccountReasonCode.ACTION_EXECUTED, httpStatus: 200, responseJson: '[]' });
  const client = createRemoteAppRealmClients({ async invokeRealmUnary(request) { calls.push(request); return response; } });
  return { client, calls, respond: (json: string) => { response = { ...response, responseJson: json }; },
    reject: (reasonCode: ReasonCode) => { response = { ...response, accepted: false, reasonCode }; } };
}

test('remote Realm resource lists fix owned scope and expose only resource methods without account authority', async () => {
  const f = fixture();
  assert.deepEqual(await f.client.personaCharacter.listOwned({ worldId: 'world-1', visibility: 'private', take: 7 }), { items: [] });
  assert.deepEqual(await f.client.worldCore.list({ take: 3 }), []);
  assert.deepEqual(f.calls.map(call => call.methodId), ['WorldCoreController_listPersonaCharacters', 'WorldCoreController_listWorldCores']);
  assert.deepEqual(JSON.parse(f.calls[0].requestJson), { path: {}, query: { scope: 'owned', worldId: 'world-1', visibility: 'private', take: 7 } });
  for (const call of f.calls) { assert.equal(call.caller, undefined); assert.equal(call.realmBaseUrl, ''); }
  assert.deepEqual(Object.keys(f.client).sort(), ['personaCharacter', 'worldCore']);
  assert.equal(typeof f.client.worldCore.getCreationEligibility, 'function');
  assert.equal(typeof f.client.worldCore.createCharacter, 'function');
  assert.equal('invoke' in f.client.worldCore, false);
  await assert.rejects(f.client.personaCharacter.listOwned({ ownerAccountId: 'other' } as never), { reasonCode: 'invalid-input' });
  assert.equal(f.calls.length, 2);
});

test('remote Persona deletion keeps the exact id and requires the owner success projection', async () => {
  const f = fixture(); f.respond('{"personaCharacterId":"persona-1","deleted":true}');
  assert.deepEqual(await f.client.personaCharacter.delete('persona-1'), { personaCharacterId: 'persona-1', deleted: true });
  assert.equal(f.calls[0].methodId, 'WorldCoreController_deletePersonaCharacter');
  assert.deepEqual(JSON.parse(f.calls[0].requestJson), { path: { personaCharacterId: 'persona-1' }, query: {} });
  f.respond('{"personaCharacterId":"other","deleted":true}');
  await assert.rejects(f.client.personaCharacter.delete('persona-1'), { reasonCode: 'contract-invalid' });
});

test('broker owner failures stay typed and malformed success never becomes resource data', async () => {
  const f = fixture(); f.reject(ReasonCode.REALM_NOT_FOUND);
  await assert.rejects(f.client.personaCharacter.getOwned('missing'), { reasonCode: 'not-found' });
  f.reject(ReasonCode.APP_SCOPE_FORBIDDEN);
  await assert.rejects(f.client.personaCharacter.listOwned(), { reasonCode: 'access-denied' });
  const invalid = fixture(); invalid.respond('{}');
  await assert.rejects(invalid.client.worldCore.get('world-1'), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
  invalid.respond('not JSON');
  await assert.rejects(invalid.client.personaCharacter.listOwned(), { reasonCode: 'contract-invalid' });
  assert.equal(invalid.calls.length, 2, 'failed calls are not automatically replayed');
});

test('world creation eligibility remains a Realm fact rather than a client grant', async () => {
  const f = fixture(); f.respond('{"canCreateWorld":false}');
  assert.deepEqual(await f.client.worldCore.getCreationEligibility(), { canCreateWorld: false });
  assert.equal(f.calls[0].methodId, 'WorldCoreController_getWorldCreationEligibility');
  assert.deepEqual(JSON.parse(f.calls[0].requestJson), { path: {}, query: {} });
  f.reject(ReasonCode.APP_SCOPE_FORBIDDEN);
  await assert.rejects(f.client.worldCore.getCreationEligibility(), { reasonCode: 'access-denied' });
});
