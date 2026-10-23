import assert from 'node:assert/strict';
import test from 'node:test';
import { handleInstallGatewayRequest } from '../src/index.mjs';

function installCache(t, cache) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: cache } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else delete globalThis.caches;
  });
}

for (const cacheHit of [false, true]) {
  test(`non-GET methods cannot use a ${cacheHit ? 'populated' : 'cold'} cache`, async (t) => {
    let cacheReads = 0;
    installCache(t, {
      async match() {
        cacheReads += 1;
        return cacheHit ? new Response('cached GET response') : undefined;
      },
      put() { assert.fail('a rejected method must not write the cache'); },
    });
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      const response = await handleInstallGatewayRequest(
        new Request('https://install.nimi.ai/runtime/latest.json', { method }),
        {},
        { waitUntil() { assert.fail('a rejected method must not schedule work'); } },
        { fetchImpl() { assert.fail('a rejected method must not query releases'); } },
      );
      assert.equal(response.status, 405, method);
      assert.deepEqual(await response.json(), { error: 'METHOD_NOT_ALLOWED' }, method);
    }
    assert.equal(cacheReads, 0);
  });
}

test('GET returns a cached response without fetching releases', async (t) => {
  const url = 'https://install.nimi.ai/runtime/latest.json';
  installCache(t, {
    async match(key) {
      assert.equal(key, url);
      return new Response('cached GET response');
    },
    put() { assert.fail('a hit must not rewrite the cache'); },
  });
  const response = await handleInstallGatewayRequest(new Request(url), {}, {}, {
    fetchImpl() { assert.fail('a hit must not query releases'); },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'cached GET response');
});

test('a successful GET miss stores a clone and leaves the response readable', async (t) => {
  const url = 'https://install.nimi.ai/healthz';
  const writes = [];
  installCache(t, {
    async match(key) { assert.equal(key, url); },
    async put(key, response) { writes.push([key, await response.json()]); },
  });
  const pending = [];
  const response = await handleInstallGatewayRequest(new Request(url), {}, {
    waitUntil(work) { pending.push(work); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await Promise.all(pending);
  assert.deepEqual(writes, [[url, { ok: true }]]);
});
