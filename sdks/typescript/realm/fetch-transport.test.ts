import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserProfileDto } from '../core-generated/realm-typed-client';
import { createRealmFetchTransport, Realm } from './index';
import { ReasonCode } from '../types';

const USER_PROFILE_FIXTURE = {
  createdAt: '2026-06-05T00:00:00.000Z',
  displayName: 'User One',
  handle: 'user-one',
  id: 'user-1',
} satisfies UserProfileDto;

test('Realm fetch transport maps generated operation requests to HTTP fetch', async () => {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test/',
    headers: { 'x-sdk': 'vnext' },
    fetch: async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(USER_PROFILE_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-1' },
      });
    },
  });
  const realm = new Realm({ transport });

  const profile = await realm.generated.getUser({
    path: { id: 'user 1' },
  }, {
    metadata: { 'x-request': 'request-1' },
  });

  assert.equal(profile.id, 'user-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://realm.test/api/human/accounts/user%201');
  assert.equal(calls[0]!.init.method, 'GET');
  assert.equal((calls[0]!.init.headers as Headers).get('x-sdk'), 'vnext');
  assert.equal((calls[0]!.init.headers as Headers).get('x-request'), 'request-1');
  assert.equal(calls[0]!.init.body, undefined);
});

test('Realm fetch transport expands query and JSON body request fields', async () => {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await transport.unary({
    methodId: 'updateMe',
    body: {
      path: {},
      query: { worldId: 'world-1', tag: ['a', 'b'] },
      headers: { 'x-profile': 'user-1' },
      body: { displayName: 'Updated' },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://realm.test/api/human/me?worldId=world-1&tag=a&tag=b');
  assert.equal(calls[0]!.init.method, 'PATCH');
  assert.equal((calls[0]!.init.headers as Headers).get('content-type'), 'application/json');
  assert.equal((calls[0]!.init.headers as Headers).get('x-profile'), 'user-1');
  assert.equal(calls[0]!.init.body, '{"displayName":"Updated"}');
});

test('Realm fetch transport fails closed on HTTP errors and streaming calls', async () => {
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => new Response(JSON.stringify({
      reasonCode: 'REALM_USER_NOT_FOUND',
      actionHint: 'show_not_found',
      message: 'User not found',
      traceId: 'trace-not-found',
    }), { status: 404, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    transport.unary({
      methodId: 'getUser',
      body: { path: { id: 'missing' } },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'REALM_USER_NOT_FOUND');
      assert.equal((error as { actionHint?: string }).actionHint, 'show_not_found');
      assert.equal((error as { traceId?: string }).traceId, 'trace-not-found');
      return true;
    },
  );

  await assert.rejects(
    async () => {
      for await (const _event of transport.serverStream({ methodId: 'getUser', body: {} })) {
        // unreachable
      }
    },
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_FETCH_STREAM_UNSUPPORTED');
      return true;
    },
  );
});

test('Realm fetch transport does not read legacy error aliases', async () => {
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => new Response(JSON.stringify({
      error: 'Legacy error message',
      reason_code: 'LEGACY_REASON',
      code: 'LEGACY_CODE',
      action_hint: 'legacy_action',
      trace_id: 'legacy-trace',
    }), { status: 400, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    transport.unary({
      methodId: 'getUser',
      body: { path: { id: 'user-1' } },
    }),
    (error: unknown) => {
      const record = error as {
        readonly message?: string;
        readonly reasonCode?: string;
        readonly actionHint?: string;
        readonly traceId?: string;
      };
      assert.equal(record.message, 'Realm operation getUser failed with HTTP 400.');
      assert.equal(record.reasonCode, ReasonCode.SDK_REALM_HTTP_REQUEST_FAILED);
      assert.equal(record.actionHint, 'inspect_realm_http_response');
      assert.equal(record.traceId, '');
      return true;
    },
  );
});

test('Realm fetch transport maps network fetch failures to Realm unavailable', async () => {
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });

  await assert.rejects(
    transport.unary({
      methodId: 'WorldPublicController_listWorldCatalog',
      body: { path: {}, query: {} },
    }),
    (error: unknown) => {
      const record = error as {
        readonly reasonCode?: string;
        readonly source?: string;
        readonly retryable?: boolean;
        readonly details?: { readonly operationId?: string };
      };
      assert.equal(record.reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal(record.source, 'realm');
      assert.equal(record.retryable, true);
      assert.equal(record.details?.operationId, 'WorldPublicController_listWorldCatalog');
      return true;
    },
  );
});

test('Realm fetch transport fails closed on malformed operation boundaries', async () => {
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => new Response('not json', { status: 200 }),
  });

  await assert.rejects(
    transport.unary({
      methodId: 'missingOperation',
      body: {},
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_OPERATION_UNKNOWN');
      return true;
    },
  );

  await assert.rejects(
    transport.unary({
      methodId: 'getUser',
      body: { path: {} },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_PATH_PARAMETER_REQUIRED');
      return true;
    },
  );

  await assert.rejects(
    transport.unary({
      methodId: 'getUser',
      body: { path: { id: 'user-1' } },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_RESPONSE_DECODE_FAILED');
      return true;
    },
  );
});

test('Realm fetch transport fails closed on non-JSON and empty successful responses', async () => {
  const htmlTransport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => new Response('<html>ok</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  });
  await assert.rejects(
    htmlTransport.unary({
      methodId: 'getUser',
      body: { path: { id: 'user-1' } },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_RESPONSE_DECODE_FAILED');
      return true;
    },
  );

  const emptyTransport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => new Response('', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(
    emptyTransport.unary({
      methodId: 'getUser',
      body: { path: { id: 'user-1' } },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_RESPONSE_DECODE_FAILED');
      return true;
    },
  );

  const noContentTransport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => new Response(null, { status: 204 }),
  });
  assert.deepEqual(
    await noContentTransport.unary({
      methodId: 'removeFriend',
      body: { path: { id: 'user-1' } },
    }),
    {},
  );
});
