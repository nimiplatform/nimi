import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { resolveRealmMediaUrl } from '../src/realm/index.js';

describe('resolveRealmMediaUrl', () => {
  test('expands Realm-relative media urls against the configured Realm base url', () => {
    assert.equal(
      resolveRealmMediaUrl({
        realmBaseUrl: 'https://realm.example/',
        mediaUrl: '/api/resources/images/example',
      }),
      'https://realm.example/api/resources/images/example',
    );
  });

  test('keeps absolute media urls unchanged', () => {
    assert.equal(
      resolveRealmMediaUrl({
        realmBaseUrl: 'https://realm.example',
        mediaUrl: 'https://cdn.example/video.m3u8',
      }),
      'https://cdn.example/video.m3u8',
    );
  });

  test('keeps non-slash relative media urls unchanged', () => {
    assert.equal(
      resolveRealmMediaUrl({
        realmBaseUrl: 'https://realm.example',
        mediaUrl: 'local-preview.png',
      }),
      'local-preview.png',
    );
  });

  test('fails closed for Realm-relative media urls without a Realm base url', () => {
    assert.equal(
      resolveRealmMediaUrl({
        realmBaseUrl: '',
        mediaUrl: '/api/resources/images/example',
      }),
      undefined,
    );
  });

  test('returns undefined for empty media urls', () => {
    assert.equal(
      resolveRealmMediaUrl({
        realmBaseUrl: 'https://realm.example',
        mediaUrl: '   ',
      }),
      undefined,
    );
  });

  test('returns undefined for missing projection input', () => {
    assert.equal(resolveRealmMediaUrl(null), undefined);
    assert.equal(resolveRealmMediaUrl(undefined), undefined);
  });
});
