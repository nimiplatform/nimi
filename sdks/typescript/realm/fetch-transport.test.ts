import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealmFetchTransport, Realm } from './index';

test('Realm fetch transport maps generated operation requests to HTTP fetch', async () => {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test/',
    headers: { 'x-sdk': 'vnext' },
    fetch: async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        postId: 'post-1',
        attachments: [],
      }), {
        status: 200,
        headers: { 'x-trace-id': 'trace-1' },
      });
    },
  });
  const realm = new Realm({ transport });

  const post = await realm.generated.getPublicPost({
    path: { id: 'post 1' },
  }, {
    metadata: { 'x-request': 'request-1' },
  });

  assert.equal(post.postId, 'post-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://realm.test/api/world/posts/public/post%201');
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
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await transport.unary({
    methodId: 'updatePost',
    body: {
      path: { id: 'post-2' },
      query: { worldId: 'world-1', tag: ['a', 'b'] },
      headers: { 'x-post': 'post-2' },
      body: { caption: 'updated' },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://realm.test/api/world/posts/by-id/post-2?worldId=world-1&tag=a&tag=b');
  assert.equal(calls[0]!.init.method, 'PATCH');
  assert.equal((calls[0]!.init.headers as Headers).get('content-type'), 'application/json');
  assert.equal((calls[0]!.init.headers as Headers).get('x-post'), 'post-2');
  assert.equal(calls[0]!.init.body, '{"caption":"updated"}');
});

test('Realm fetch transport fails closed on HTTP errors and streaming calls', async () => {
  const transport = createRealmFetchTransport({
    baseUrl: 'https://realm.test',
    fetch: async () => new Response(JSON.stringify({
      reasonCode: 'REALM_POST_NOT_FOUND',
      actionHint: 'show_not_found',
      message: 'Post not found',
    }), { status: 404 }),
  });

  await assert.rejects(
    transport.unary({
      methodId: 'getPublicPost',
      body: { path: { id: 'missing' } },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'REALM_POST_NOT_FOUND');
      assert.equal((error as { actionHint?: string }).actionHint, 'show_not_found');
      return true;
    },
  );

  await assert.rejects(
    async () => {
      for await (const _event of transport.serverStream({ methodId: 'getPublicPost', body: {} })) {
        // unreachable
      }
    },
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_FETCH_STREAM_UNSUPPORTED');
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
      methodId: 'getPublicPost',
      body: { path: {} },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_PATH_PARAMETER_REQUIRED');
      return true;
    },
  );

  await assert.rejects(
    transport.unary({
      methodId: 'getPublicPost',
      body: { path: { id: 'post-1' } },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_REALM_RESPONSE_DECODE_FAILED');
      return true;
    },
  );
});
