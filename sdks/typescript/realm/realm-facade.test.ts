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
    if (request.methodId === 'listGroups') {
      return { items: [] } as Response;
    }
    if (request.methodId === 'WorldController_getMainWorld') {
      return { id: 'world-1', name: 'Main World' } as Response;
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
  assert.equal(typeof realm.groupChat.listGroups, 'function');
  assert.equal(typeof realm.world.worldControllerGetMainWorld, 'function');
  assert.equal(typeof realm.generated.worldControllerGetMainWorld, 'function');

  await realm.auth.checkEmail({ path: {}, body: { email: 'test@example.com' } });
  assert.equal(transport.unaryCalls[0]?.methodId, 'checkEmail');
  assert.equal(transport.unaryCalls[0]?.metadata?.authorization, 'Bearer realm-token');

  await realm.notifications.getUnreadCount({ path: {} });
  assert.equal(transport.unaryCalls[1]?.methodId, 'getUnreadCount');

  await realm.me();
  assert.equal(transport.unaryCalls[2]?.methodId, 'getMe');
  assert.deepEqual(transport.unaryCalls[2]?.body, { path: {} });

  await realm.world.worldControllerGetMainWorld({ path: {} });
  assert.equal(transport.unaryCalls[3]?.methodId, 'WorldController_getMainWorld');
});

test('Realm facade keeps generated core explicit and blocks generated permission bypass', async () => {
  const transport = new FakeRealmTransport();
  const realm = new Realm({ transport });
  assert.equal(await realm.generated.getMe({ path: {} }).then((value) => (value as { id?: string }).id), 'user-1');
  await assert.rejects(
    realm.generated.requestMyAppPermissionGrant({
      path: {},
      body: {
        appId: 'app.example',
        scopeFamily: 'account',
        scopeName: 'account.read',
        reason: 'test',
      },
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_PERMISSION_TYPED_CLIENT_REQUIRED',
  );
});

test('Realm facade fails closed when transport is missing', () => {
  assert.throws(
    () => new Realm({} as never),
    (error: unknown) => (error as { code?: string }).code === 'SDK_CORE_TRANSPORT_REQUIRED',
  );
});
