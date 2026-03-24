import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRelayExternalUrl,
  normalizeRelayRealtimeUrl,
} from '../src/main/url-guards.js';

test('normalizeRelayExternalUrl allows absolute http/https URLs only', () => {
  assert.equal(
    normalizeRelayExternalUrl('https://example.com/path?q=1'),
    'https://example.com/path?q=1',
  );
  assert.equal(
    normalizeRelayExternalUrl('http://127.0.0.1:3000/callback'),
    'http://127.0.0.1:3000/callback',
  );
  assert.throws(() => normalizeRelayExternalUrl('file:///tmp/secret'), /http or https/i);
  assert.throws(() => normalizeRelayExternalUrl('javascript:alert(1)'), /http or https/i);
  assert.throws(() => normalizeRelayExternalUrl('/relative/path'), /absolute url/i);
});

test('normalizeRelayRealtimeUrl requires HTTPS outside development', () => {
  assert.equal(
    normalizeRelayRealtimeUrl('https://realm.example.com/socket'),
    'https://realm.example.com/socket',
  );
  assert.throws(
    () => normalizeRelayRealtimeUrl('http://realm.example.com/socket'),
    /requires https outside development/i,
  );
  assert.equal(
    normalizeRelayRealtimeUrl('http://127.0.0.1:3000/socket', { allowInsecureHttp: true }),
    'http://127.0.0.1:3000/socket',
  );
});
