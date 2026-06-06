import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asJsonObject,
  isJsonObject,
  parseJsonObjectResponse,
  tryParseJsonLike,
} from '../src/types/index.js';

test('SDK JSON helpers parse only object responses', async () => {
  assert.deepEqual(await parseJsonObjectResponse(new Response('{"ok":true}')), { ok: true });
  assert.equal(await parseJsonObjectResponse(new Response('[1,2]')), null);
  assert.equal(await parseJsonObjectResponse(new Response('')), null);
});

test('SDK JSON helpers expose non-authoritative app parsing ergonomics', () => {
  assert.equal(isJsonObject({ ok: true }), true);
  assert.equal(isJsonObject([]), false);
  assert.deepEqual(asJsonObject({ value: 1 }), { value: 1 });
  assert.deepEqual(asJsonObject(null), {});
  assert.deepEqual(tryParseJsonLike('{"kind":"tester"}'), { kind: 'tester' });
  assert.deepEqual(tryParseJsonLike('[1,2]'), [1, 2]);
  assert.equal(tryParseJsonLike('not json'), 'not json');
});
