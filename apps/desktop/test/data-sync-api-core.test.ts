import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import path from 'node:path';
import { normalizeRealmBaseUrl } from '@nimiplatform/sdk/realm';

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

test('Desktop data-sync consumes SDK Realm endpoint projection instead of owning it', () => {
  const apiCoreSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/runtime/data-sync/api-core.ts'),
    'utf8',
  );
  const facadeSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
    'utf8',
  );
  const hotStateSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/runtime/data-sync/facade-hot-state.ts'),
    'utf8',
  );

  assert.doesNotMatch(apiCoreSource, /function normalizeRealmBaseUrl/);
  assert.match(facadeSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(hotStateSource, /from '@nimiplatform\/sdk\/realm'/);
});
