import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeNimiRealmBaseUrl,
  resolveNimiRealmBaseUrl,
  resolveNimiRealmRealtimeUrl,
} from './endpoint';

test('Realm endpoint helpers normalize HTTPS and loopback base URLs', () => {
  assert.equal(resolveNimiRealmBaseUrl({ realmBaseUrl: 'https://realm.example/api/' }), 'https://realm.example/api');
  assert.equal(resolveNimiRealmBaseUrl({ realmBaseUrl: 'http://127.0.0.1' }), 'http://127.0.0.1:3002');
  assert.throws(() => normalizeNimiRealmBaseUrl('http://realm.example'), /https unless the host is loopback/);
});

test('Realm realtime helper prefers explicit realtime origin and derives local socket origin', () => {
  assert.equal(
    resolveNimiRealmRealtimeUrl({
      realmBaseUrl: 'https://realm.example/api',
      realtimeUrl: 'https://socket.example/socket.io/',
    }),
    'https://socket.example',
  );
  assert.equal(resolveNimiRealmRealtimeUrl({ realmBaseUrl: 'http://localhost:3002/api' }), 'http://localhost:3003');
  assert.equal(resolveNimiRealmRealtimeUrl({ realmBaseUrl: 'https://realm.example/api' }), 'https://realm.example');
  assert.equal(resolveNimiRealmRealtimeUrl({ realmBaseUrl: 'not a url' }), '');
});
