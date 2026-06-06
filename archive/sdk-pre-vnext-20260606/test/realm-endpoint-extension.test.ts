import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { normalizeRealmBaseUrl, projectRealmBaseUrl, projectRealmRealtimeUrl } from '../src/realm/index.js';
import { ReasonCode } from '../src/types/index.js';

describe('normalizeRealmBaseUrl', () => {
  test('allows https origins and trims trailing slashes', () => {
    assert.equal(
      normalizeRealmBaseUrl('https://realm.example.com/api/'),
      'https://realm.example.com/api',
    );
  });

  test('assigns default port for loopback http without an explicit port', () => {
    assert.equal(
      normalizeRealmBaseUrl('http://127.0.0.1'),
      'http://127.0.0.1:3002',
    );
    assert.equal(
      normalizeRealmBaseUrl('http://localhost:4010/'),
      'http://localhost:4010',
    );
  });

  test('rejects non-loopback http origins with a structured SDK reason', () => {
    assert.throws(
      () => normalizeRealmBaseUrl('http://realm.example.com'),
      (error: unknown) => {
        assert.match(error instanceof Error ? error.message : String(error), /must use https unless the host is loopback/i);
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.CONFIG_INVALID);
        return true;
      },
    );
  });

  test('rejects unsupported protocols', () => {
    assert.throws(
      () => normalizeRealmBaseUrl('file:///tmp/realm'),
      /Unsupported Realm base URL protocol: file:/,
    );
  });

  test('projects optional app-facing endpoint config without requiring a configured Realm', () => {
    assert.equal(projectRealmBaseUrl({ realmBaseUrl: 'https://realm.example/' }), 'https://realm.example');
    assert.equal(projectRealmBaseUrl({ realmBaseUrl: '' }), '');
    assert.equal(projectRealmBaseUrl(null), '');
  });

  test('projects explicit Realm realtime origins without preserving paths', () => {
    assert.equal(
      projectRealmRealtimeUrl({
        realmBaseUrl: 'https://realm.example/api',
        realtimeUrl: 'https://socket.example/socket.io',
      }),
      'https://socket.example',
    );
  });

  test('projects loopback REST default port to the local realtime port', () => {
    assert.equal(
      projectRealmRealtimeUrl({
        realmBaseUrl: 'http://localhost:3002/api',
        realtimeUrl: '',
      }),
      'http://localhost:3003',
    );
    assert.equal(
      projectRealmRealtimeUrl({
        realmBaseUrl: 'http://127.0.0.1:3002',
      }),
      'http://127.0.0.1:3003',
    );
  });

  test('falls back to the Realm REST origin for non-loopback endpoints', () => {
    assert.equal(
      projectRealmRealtimeUrl({
        realmBaseUrl: 'https://realm.example/api',
      }),
      'https://realm.example',
    );
  });

  test('fails closed for missing or invalid realtime projection inputs', () => {
    assert.equal(projectRealmRealtimeUrl({ realmBaseUrl: '', realtimeUrl: '' }), '');
    assert.equal(projectRealmRealtimeUrl({ realmBaseUrl: 'not a url' }), '');
    assert.equal(projectRealmRealtimeUrl(null), '');
  });
});
