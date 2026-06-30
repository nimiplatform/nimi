import assert from 'node:assert/strict';
import test from 'node:test';

import { createRealmWithRuntimeAccountToken } from './runtime-account-realm';

test('Realm Runtime account helper adds bearer token and refreshes after 401', async () => {
  const calls: Array<{ readonly authorization: string }> = [];
  let token = 'token-1';
  const realm = createRealmWithRuntimeAccountToken({
    baseUrl: 'https://realm.test',
    runtime: {
      account: {
        getAccessToken: async () => ({ accepted: true, accessToken: token }),
        refreshAccountSession: async () => {
          token = 'token-2';
          return { accepted: true };
        },
      },
    },
    accountCaller: {
      appId: 'nimi.thirdparty.fixture',
      appInstanceId: 'fixture.instance',
      deviceId: 'fixture.device',
      mode: 1,
      scopes: [],
    },
    fetchImpl: async (_request, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ authorization: headers.get('authorization') || '' });
      return calls.length === 1
        ? new Response(JSON.stringify({ message: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await realm.core.unary({
    methodId: 'listNotifications',
    body: { query: {}, path: {}, headers: {} },
  } as never);

  assert.deepEqual(calls.map((call) => call.authorization), [
    'Bearer token-1',
    'Bearer token-2',
  ]);
});
