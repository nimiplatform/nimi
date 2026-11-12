import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../public/_worker.js';

test('all portal account aliases preserve the complete OAuth query on the official account origin', async () => {
  for (const host of ['www.nimi.ai', 'web.nimi.ai', 'nimi.xyz', 'www.nimi.xyz']) {
    for (const path of ['/login', '/register', '/account', '/account/runtime', '/account/recovery']) {
      const suffix = '?oauth_next=https%3A%2F%2Frealm.nimi.ai%2Fapi%2Fauth%2Foauth%2Fauthorize%3Fstate%3Dtest&lang=zh';
      const response = await worker.fetch(new Request(`https://${host}${path}${suffix}`), {});
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), `https://nimi.ai${path}${suffix}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
});

test('public pages converge on the portal without redirecting near-matching account names', async () => {
  for (const host of ['www.nimi.ai', 'web.nimi.ai']) {
    for (const path of ['/', '/apps/zhiyu', '/privacy', '/accounting']) {
      const response = await worker.fetch(new Request(`https://${host}${path}`), {});
      assert.equal(response.headers.get('location'), `https://nimi.ai${path}`);
    }
  }
});

test('the canonical host serves account deep links with security headers and no credential proxy', async () => {
  let fetched = 0;
  const env = { ASSETS: { fetch: async (request) => {
    fetched += 1;
    assert.equal(new URL(request.url).pathname, '/account/runtime');
    return new Response('<html>static test asset</html>', { headers: { 'Content-Type': 'text/html' } });
  } } };
  const response = await worker.fetch(new Request('https://nimi.ai/account/runtime'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(fetched, 1);
  const api = await worker.fetch(new Request('https://nimi.ai/api/auth/login'), env);
  assert.equal(api.status, 404);
  const post = await worker.fetch(new Request('https://nimi.ai/login', { method: 'POST' }), env);
  assert.equal(post.status, 405);
  assert.equal(fetched, 1);
});

test('preview pages do not redirect into production or gain production connect permission', async () => {
  const response = await worker.fetch(new Request('https://candidate.nimi-6jb.pages.dev/login'), {
    ASSETS: { fetch: async () => new Response('preview') },
  });
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'; form-action 'self'/u);
});
