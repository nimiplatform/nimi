import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRealmBaseUrl } from '../src/runtime/data-sync/api-core';

test('normalizeRealmBaseUrl allows https origins unchanged', () => {
  assert.equal(
    normalizeRealmBaseUrl('https://realm.example.com/api/'),
    'https://realm.example.com/api',
  );
});

test('normalizeRealmBaseUrl assigns default port for loopback http', () => {
  assert.equal(
    normalizeRealmBaseUrl('http://127.0.0.1'),
    'http://127.0.0.1:3002',
  );
  assert.equal(
    normalizeRealmBaseUrl('http://localhost:4010/'),
    'http://localhost:4010',
  );
});

test('normalizeRealmBaseUrl rejects non-loopback http origins', () => {
  assert.throws(
    () => normalizeRealmBaseUrl('http://realm.example.com'),
    /must use https unless the host is loopback/i,
  );
});
