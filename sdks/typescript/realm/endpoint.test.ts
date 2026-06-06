import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeNimiRealmBaseUrl,
  projectNimiRealmBaseUrl,
  projectNimiRealmRealtimeUrl,
} from './endpoint';

test('Realm endpoint helpers normalize HTTPS and loopback base URLs', () => {
  assert.equal(projectNimiRealmBaseUrl({ realmBaseUrl: 'https://realm.example/api/' }), 'https://realm.example/api');
  assert.equal(projectNimiRealmBaseUrl({ realmBaseUrl: 'http://127.0.0.1' }), 'http://127.0.0.1:3002');
  assert.throws(() => normalizeNimiRealmBaseUrl('http://realm.example'), /https unless the host is loopback/);
});

test('Realm realtime helper prefers explicit realtime origin and derives local socket origin', () => {
  assert.equal(
    projectNimiRealmRealtimeUrl({
      realmBaseUrl: 'https://realm.example/api',
      realtimeUrl: 'https://socket.example/socket.io/',
    }),
    'https://socket.example',
  );
  assert.equal(projectNimiRealmRealtimeUrl({ realmBaseUrl: 'http://localhost:3002/api' }), 'http://localhost:3003');
  assert.equal(projectNimiRealmRealtimeUrl({ realmBaseUrl: 'https://realm.example/api' }), 'https://realm.example');
  assert.equal(projectNimiRealmRealtimeUrl({ realmBaseUrl: 'not a url' }), '');
});
