import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeNimiRealmBaseUrl,
  resolveNimiRealmBaseUrl,
} from './endpoint';

test('Realm endpoint helpers normalize HTTPS and loopback base URLs', () => {
  assert.equal(resolveNimiRealmBaseUrl({ realmBaseUrl: 'https://realm.example/api/' }), 'https://realm.example/api');
  assert.equal(resolveNimiRealmBaseUrl({ realmBaseUrl: 'http://127.0.0.1' }), 'http://127.0.0.1:3002');
  assert.throws(() => normalizeNimiRealmBaseUrl('http://realm.example'), /https unless the host is loopback/);
});
