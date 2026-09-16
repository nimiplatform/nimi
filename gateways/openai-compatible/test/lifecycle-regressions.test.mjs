import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createOpenAICompatibleGateway, createOpenAICompatibleGatewayHttpServer, createOpenAICompatibleRuntimeAdapter } from '../src/index.mjs';
import { GatewayArtifactCache } from '../src/artifact-cache.mjs';

const headers = { authorization: 'Bearer test-key', 'content-type': 'application/json' };
const target = (id, capability) => ({ id, supported: true, capabilities: [capability] });
const createGateway = (runtime, options = {}) => createOpenAICompatibleGateway({ appId: 'gateway.test', apiKeys: ['test-key'], runtime, ...options });
const post = (gateway, path, body, signal) => gateway.fetch(new Request(`http://127.0.0.1:1234/v1/${path}`, {
  method: 'POST', headers, body: JSON.stringify(body), signal,
}), { remoteAddress: '127.0.0.1' });

test('ambiguous aliases fail closed at discovery and execution without a raw model override', async () => {
  let submitted = 0;
  const gateway = createGateway({
    listModels: () => [target('A', 'image.generate'), target('B', 'image.generate')],
    runImageGenerationJob: async () => { submitted++; throw new Error('must not execute'); },
  });
  const responses = [await gateway.fetch(new Request('http://127.0.0.1:1234/v1/models', { headers }), { remoteAddress: '127.0.0.1' })];
  for (const model of ['A', 'B']) responses.push(await post(gateway, 'images/generations', { model, prompt: 'same' }));
  for (const response of responses) {
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_MODEL_CATALOG_AMBIGUOUS');
  }
  assert.equal(submitted, 0);
});

test('invalid embedding members reject the entire batch before execution', async () => {
  const calls = [];
  const gateway = createGateway({
    listModels: () => [target('embed', 'text.embed')],
    runEmbedding: async (request) => { calls.push(request); return { embeddings: request.input.map((_, index) => [index]) }; },
  });
  for (const input of [['A', null, 'B'], ['A', '', 'B'], ['A', 7], ['A', '  '], ['A', {}], []]) {
    const response = await post(gateway, 'embeddings', { model: 'embed', input });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'NIMI_GATEWAY_REQUEST_INVALID');
  }
  assert.equal(calls.length, 0);
  const response = await post(gateway, 'embeddings', { model: 'embed', input: ['A', 'B'] });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].input, ['A', 'B']);
  assert.deepEqual((await response.json()).data.map((entry) => entry.index), [0, 1]);
});

test('SSE consumer demand bounds production and cancellation releases the iterator', async () => {
  let produced = 0;
  let finished = false;
  let signal;
  const gateway = createGateway({
    listModels: () => [target('chat', 'text.stream')],
    async *streamChatCompletion(request) {
      signal = request.signal;
      try { for (let i = 0; i < 300; i++) { produced++; yield { delta: { content: 'x' } }; } }
      finally { finished = true; }
    },
  });
  const response = await post(gateway, 'chat/completions', { model: 'chat', messages: [{ role: 'user', content: 'x' }], stream: true });
  await delay(20);
  assert.equal(produced, 1, 'one queued chunk without consumer reads');
  const reader = response.body.getReader();
  await reader.read();
  await delay(10);
  assert.equal(produced, 2);
  await reader.cancel('client done');
  await delay(0);
  assert.equal(signal.aborted, true);
  assert.equal(finished, true);
});

test('an aborted request interrupts a pending SSE read and closes its producer', async () => {
  let finished = false;
  const cancellation = new AbortController();
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const gateway = createGateway({
    listModels: () => [target('chat', 'text.stream')],
    async *streamChatCompletion({ signal }) {
      try {
        started();
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        yield {};
      } finally { finished = true; }
    },
  });
  const response = await post(gateway, 'chat/completions', { model: 'chat', messages: [{}], stream: true }, cancellation.signal);
  const reader = response.body.getReader();
  const pending = reader.read();
  const rejected = assert.rejects(pending, /client gone/);
  await ready;
  cancellation.abort(new Error('client gone'));
  await rejected;
  await delay(0);
  assert.equal(finished, true);
});

test('real HTTP disconnect propagates through the image adapter to its SDK operation', { timeout: 5000 }, async (t) => {
  let started;
  let aborted;
  const ready = new Promise((resolve) => { started = resolve; });
  const stopped = new Promise((resolve) => { aborted = resolve; });
  const adapter = createOpenAICompatibleRuntimeAdapter({
    runtime: {}, listImageGenerationModels: () => [target('image', 'image.generate')],
    runNimiRuntimeImageGeneration({ signal }) {
      assert.ok(signal instanceof AbortSignal);
      started();
      return new Promise((_, reject) => signal.addEventListener('abort', () => {
        aborted(); reject(signal.reason);
      }, { once: true }));
    },
  });
  const server = createOpenAICompatibleGatewayHttpServer(createGateway(adapter));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/v1/images/generations', method: 'POST', headers });
  client.on('error', () => {});
  t.after(() => client.destroy());
  client.end(JSON.stringify({ model: 'image', prompt: 'x' }));
  await ready;
  client.destroy();
  await stopped;
});

test('URL cache actively expires bytes without another GET and bounds entries and bytes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100 });
  const cache = new GatewayArtifactCache({ nowMs: () => Date.now(), maxBytes: 5, maxEntries: 2 });
  const deleted = t.mock.method(cache, 'delete');
  const value = (count) => ({ bytes: new Uint8Array(count), mimeType: 'image/png', expiresAtMs: Date.now() + 10 });
  cache.set('old', value(3));
  const deletesBefore = deleted.mock.callCount();
  t.mock.timers.tick(11);
  assert.ok(deleted.mock.callCount() > deletesBefore, 'expiry must delete before any cache read');
  assert.equal(cache.get('old'), undefined);
  cache.set('A', value(3)); cache.set('B', value(3));
  assert.equal(cache.get('A'), undefined, 'byte budget evicts the oldest entry');
  assert.equal(cache.get('B').bytes.byteLength, 3);
  cache.set('C', value(1)); cache.set('D', value(1));
  assert.equal(cache.get('B'), undefined, 'entry count also bounds tiny images');
  assert.throws(() => cache.set('oversized', value(6)), { code: 'NIMI_GATEWAY_ARTIFACT_TOO_LARGE' });
  t.mock.timers.tick(11);
});

test('an old expiry timer cannot evict a replacement artifact with the same ID', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100 });
  const cache = new GatewayArtifactCache({ nowMs: () => Date.now(), maxBytes: 5, maxEntries: 2 });
  cache.set('id', { bytes: new Uint8Array(1), expiresAtMs: 110 });
  cache.set('id', { bytes: new Uint8Array(2), expiresAtMs: 120 });
  t.mock.timers.tick(11);
  assert.equal(cache.get('id').bytes.byteLength, 2);
  t.mock.timers.tick(10);
  assert.equal(cache.get('id'), undefined);
});

test('oversized URL responses fail honestly while b64_json remains available', async () => {
  const gateway = createGateway({
    listModels: () => [target('image', 'image.generate')],
    runImageGenerationJob: async () => ({ artifacts: [{ bytes: new Uint8Array(6), mimeType: 'image/png' }] }),
  }, { artifactMaxBytes: 5 });
  const url = await post(gateway, 'images/generations', { model: 'image', prompt: 'x' });
  assert.equal(url.status, 503);
  assert.equal((await url.json()).error.code, 'NIMI_GATEWAY_ARTIFACT_TOO_LARGE');
  const base64 = await post(gateway, 'images/generations', { model: 'image', prompt: 'x', response_format: 'b64_json' });
  assert.equal(base64.status, 200);
});
