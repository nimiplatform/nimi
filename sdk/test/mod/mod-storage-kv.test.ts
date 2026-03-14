import assert from 'node:assert/strict';
import test from 'node:test';

import { createModKvStore } from '../../src/mod/storage/index.js';
import type { HookStorageClient } from '../../src/mod/types/storage.js';

function createStorageHarness() {
  const entries = new Map<string, string>();
  let createTableCalls = 0;

  const storage: HookStorageClient = {
    files: {
      readText: async () => {
        throw new Error('UNEXPECTED_FILES_READ_TEXT');
      },
      writeText: async () => {
        throw new Error('UNEXPECTED_FILES_WRITE_TEXT');
      },
      readBytes: async () => {
        throw new Error('UNEXPECTED_FILES_READ_BYTES');
      },
      writeBytes: async () => {
        throw new Error('UNEXPECTED_FILES_WRITE_BYTES');
      },
      delete: async () => false,
      list: async () => [],
      stat: async () => null,
    },
    sqlite: {
      query: async (input) => {
        const sql = String(input.sql || '').toLowerCase();
        const namespace = String(input.params?.[0] || '');
        const key = String(input.params?.[1] || '');
        if (sql.includes('select value')) {
          const stored = entries.get(`${namespace}:${key}`);
          return stored == null ? [] : [{ value: stored }];
        }
        if (sql.includes('select 1 as found')) {
          return entries.has(`${namespace}:${key}`) ? [{ found: 1 }] : [];
        }
        throw new Error(`UNEXPECTED_SQL_QUERY:${input.sql}`);
      },
      execute: async (input) => {
        const sql = String(input.sql || '').toLowerCase();
        const namespace = String(input.params?.[0] || '');
        const key = String(input.params?.[1] || '');
        if (sql.includes('create table if not exists mod_state_kv')) {
          createTableCalls += 1;
          return { rowsAffected: 0, lastInsertRowid: 0 };
        }
        if (sql.includes('insert into mod_state_kv')) {
          entries.set(`${namespace}:${key}`, String(input.params?.[2] || ''));
          return { rowsAffected: 1, lastInsertRowid: 0 };
        }
        if (sql.includes('delete from mod_state_kv') && sql.includes('where namespace = ?1 and key = ?2')) {
          entries.delete(`${namespace}:${key}`);
          return { rowsAffected: 1, lastInsertRowid: 0 };
        }
        if (sql.includes('delete from mod_state_kv') && sql.includes('where namespace = ?1')) {
          for (const entryKey of [...entries.keys()]) {
            if (entryKey.startsWith(`${namespace}:`)) {
              entries.delete(entryKey);
            }
          }
          return { rowsAffected: 1, lastInsertRowid: 0 };
        }
        throw new Error(`UNEXPECTED_SQL_EXECUTE:${input.sql}`);
      },
      transaction: async () => ({ rowsAffected: 0, lastInsertRowid: 0 }),
    },
  };

  return {
    entries,
    storage,
    getCreateTableCalls: () => createTableCalls,
  };
}

test('createModKvStore supports string and json values with namespace isolation', async () => {
  const harness = createStorageHarness();
  const alphaStore = createModKvStore({
    storage: harness.storage,
    namespace: 'alpha',
  });
  const betaStore = createModKvStore({
    storage: harness.storage,
    namespace: 'beta',
  });

  await alphaStore.set('theme', 'light');
  await betaStore.setJson('theme', { mode: 'dark' });

  assert.equal(await alphaStore.get('theme'), 'light');
  assert.deepEqual(await betaStore.getJson<{ mode: string }>('theme'), { mode: 'dark' });
  assert.equal(await alphaStore.has('theme'), true);
  assert.equal(await betaStore.has('theme'), true);
  assert.equal(await betaStore.get('missing'), null);
});

test('createModKvStore delete and clear only affect the current namespace', async () => {
  const harness = createStorageHarness();
  const alphaStore = createModKvStore({
    storage: harness.storage,
    namespace: 'alpha',
  });
  const betaStore = createModKvStore({
    storage: harness.storage,
    namespace: 'beta',
  });

  await alphaStore.set('one', '1');
  await alphaStore.set('two', '2');
  await betaStore.set('one', 'beta');

  await alphaStore.delete('one');
  assert.equal(await alphaStore.get('one'), null);
  assert.equal(await betaStore.get('one'), 'beta');

  await alphaStore.clear();
  assert.equal(await alphaStore.get('two'), null);
  assert.equal(await betaStore.get('one'), 'beta');
});

test('createModKvStore validates names, tolerates invalid json, and bootstraps table once', async () => {
  const harness = createStorageHarness();
  const store = createModKvStore({
    storage: harness.storage,
    namespace: 'kv.namespace',
  });

  assert.throws(() => createModKvStore({
    storage: harness.storage,
    namespace: '   ',
  }), /requires namespace/);

  await assert.rejects(() => store.get('   '), /requires key/);
  await assert.rejects(() => store.set('   ', 'value'), /requires key/);
  await assert.rejects(() => store.delete('   '), /requires key/);
  await assert.rejects(() => store.has('   '), /requires key/);

  harness.entries.set('kv.namespace:broken', '{not-json');
  assert.equal(await store.getJson('broken'), null);

  await store.set('ready', 'ok');
  await store.get('ready');
  await store.has('ready');
  await store.clear();
  assert.equal(harness.getCreateTableCalls(), 1);
});
