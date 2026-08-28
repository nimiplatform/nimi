import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import { Realm, createRealm } from './index';

class FakeRealmTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.methodId === 'getMe') {
      return { id: 'user-1', handle: 'user', status: 'ACTIVE' } as Response;
    }
    if (request.methodId === 'checkEmail') {
      return { exists: false, available: true } as Response;
    }
    if (request.methodId === 'getUnreadCount') {
      return { total: 0, byType: {} } as Response;
    }
    if (request.methodId === 'WorldCoreController_getOasisWorld') {
      return { id: 'world-oasis', title: 'OASIS' } as Response;
    }
    if (request.methodId === 'WorldPublicController_listWorlds') {
      return [] as Response;
    }
    return { ok: true, methodId: request.methodId } as Response;
  }

  async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
    throw new Error('Realm facade must not use stream transport');
  }
}

test('Realm facade exposes generated operation modules over CoreClient', async () => {
  const transport = new FakeRealmTransport();
  const realm = createRealm({
    transport,
    authMetadata: () => ({ authorization: 'Bearer realm-token' }),
  });

  assert.equal(realm instanceof Realm, true);
  assert.equal(typeof realm.auth.checkEmail, 'function');
  assert.equal(typeof realm.auth.passwordLogin, 'function');
  assert.equal(typeof realm.auth.prepare2Fa, 'function');
  assert.equal(typeof realm.auth.walletChallenge, 'function');
  assert.equal(typeof realm.account.getMe, 'function');
  assert.equal(typeof realm.account.getMyCreatorEligibility, 'function');
  assert.equal(typeof realm.notifications.getUnreadCount, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerGetOasisWorld, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerListWorldEntities, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerGetWorldEntity, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerListWorldRelationships, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerGetWorldRelationship, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerGetPersonaCharacter, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerDiscoverPersonaCharacters, 'function');
  assert.equal(typeof realm.worldCore.worldCoreControllerDeleteWorldCharacter, 'function');
  assert.equal(typeof realm.worldPublic.worldPublicControllerListWorlds, 'function');
  assert.equal(typeof realm.worldPublic.worldPublicControllerGetCharacterSource, 'function');
  assert.equal(typeof realm.worldPublic.worldPublicControllerGetWorldDetailWithCharacters, 'function');
  assert.equal(typeof realm.generated.worldCoreControllerGetOasisWorld, 'function');

  await assert.rejects(
    realm.auth.checkEmail({ path: {}, body: { email: 'test@example.com' } }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED',
  );
  assert.equal(transport.unaryCalls[0]?.methodId, 'checkEmail');
  assert.equal(transport.unaryCalls[0]?.metadata?.authorization, 'Bearer realm-token');

  await realm.notifications.getUnreadCount({ path: {} });
  assert.equal(transport.unaryCalls[1]?.methodId, 'getUnreadCount');

  await assert.rejects(
    realm.me(),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED',
  );
  assert.equal(transport.unaryCalls[2]?.methodId, 'getMe');
  assert.deepEqual(transport.unaryCalls[2]?.body, { path: {} });

  await assert.rejects(
    realm.worldCore.worldCoreControllerGetOasisWorld({ path: {} }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED',
  );
  assert.equal(transport.unaryCalls[3]?.methodId, 'WorldCoreController_getOasisWorld');

  await assert.rejects(
    realm.worldCore.worldCoreControllerListWorldRelationships({
      path: { worldId: 'world-1' },
      query: { entityId: 'entity-1', type: 'knows', take: 25 },
    }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED',
  );
  assert.equal(
    transport.unaryCalls[4]?.methodId,
    'WorldCoreController_listWorldRelationships',
  );
  assert.deepEqual((transport.unaryCalls[4]?.body as { query?: unknown } | undefined)?.query, {
    entityId: 'entity-1',
    type: 'knows',
    take: 25,
  });

  await assert.rejects(
    realm.worldCore.worldCoreControllerListWorldEntities({
      path: { worldId: 'world-1' },
      query: { kind: 'text', afterId: 'entity-100', take: 100 },
    }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED',
  );
  assert.equal(transport.unaryCalls[5]?.methodId, 'WorldCoreController_listWorldEntities');
  assert.deepEqual((transport.unaryCalls[5]?.body as { query?: unknown } | undefined)?.query, {
    kind: 'text',
    afterId: 'entity-100',
    take: 100,
  });

  await assert.rejects(
    realm.worldCore.worldCoreControllerListWorldCharacters({
      path: { worldId: 'world-1' },
      query: { afterId: 'character-100', take: 100 },
    }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED',
  );
  assert.equal(transport.unaryCalls[6]?.methodId, 'WorldCoreController_listWorldCharacters');
  assert.deepEqual((transport.unaryCalls[6]?.body as { query?: unknown } | undefined)?.query, {
    afterId: 'character-100',
    take: 100,
  });

  await realm.worldPublic.worldPublicControllerListWorlds({ path: {} });
  assert.equal(transport.unaryCalls[7]?.methodId, 'WorldPublicController_listWorlds');
});

test('Realm facade blocks direct packet issuance and privileged permission lifecycle bypass', async () => {
  const transport = new FakeRealmTransport();
  const realm = new Realm({ transport });
  const generated = realm.generated as unknown as Record<string, unknown>;
  assert.equal(typeof generated.terminateCurrentAccount, 'function');
  await assert.rejects(
    realm.generated.getMe({ path: {} }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED',
  );
  assert.equal(typeof generated.getSourceMaterializationJwks, 'undefined');
  assert.equal(typeof generated.issueRuntimeRealmGrant, 'undefined');
  assert.equal(typeof generated.worldCoreControllerCreateSourceMaterializationPacket, 'undefined');
  assert.equal('worldCoreControllerCreateSourceMaterializationPacket' in realm.worldCore, false);
  assert.equal('core' in realm, false);
  assert.equal(Object.getPrototypeOf(realm.generated), null);
  assert.equal(Object.isFrozen(realm.generated), true);
});

test('Realm facade fails closed when transport is missing', () => {
  assert.throws(
    () => new Realm({} as never),
    (error: unknown) => (error as { code?: string }).code === 'SDK_CORE_TRANSPORT_REQUIRED',
  );
});
