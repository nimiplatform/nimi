import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudflareStore } from '../publish.mjs';

test('the publisher signs R2 object uploads with its bucket-scoped account token', async (t) => {
  const account = 'a'.repeat(32);
  const id = 'b'.repeat(32);
  const bytes = Buffer.from('reviewed asset');
  const store = cloudflareStore({
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_HOSTED_WEB_DATABASE_ID: 'database',
    CLOUDFLARE_HOSTED_WEB_BUCKET: 'hosted-assets',
    CLOUDFLARE_HOSTED_WEB_API_TOKEN: 'test-credential',
  });
  let lookups = 0;
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (typeof input === 'string') {
      assert.equal(input, 'https://api.cloudflare.com/client/v4/accounts/' + account + '/tokens/verify');
      assert.equal(init.headers.Authorization, 'Bearer test-credential');
      lookups++;
      return Response.json({ success: true, result: { id, status: 'active' } });
    }
    assert.equal(input.method, 'PUT');
    assert.equal(input.url, 'https://' + account + '.r2.cloudflarestorage.com/hosted-assets/test.app/a%20b%2Bc.js');
    assert.equal(init.redirect, 'error');
    const authorization = input.headers.get('Authorization');
    assert.ok(authorization.startsWith('AWS4-HMAC-SHA256 Credential=' + id + '/'));
    assert.ok(authorization.includes('/auto/s3/aws4_request'));
    assert.deepEqual(Buffer.from(await input.arrayBuffer()), bytes);
    writes++;
    return new Response(null, { status: writes === 1 ? 200 : 403 });
  });
  await store.put('test.app/a b+c.js', bytes);
  await assert.rejects(store.put('test.app/a b+c.js', bytes), /R2 S3 upload failed: HTTP 403/);
  assert.equal(lookups, 1);
  assert.equal(writes, 2);
});
