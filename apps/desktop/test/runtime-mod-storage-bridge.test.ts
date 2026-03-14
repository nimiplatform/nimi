import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteRuntimeModStoragePath,
  executeRuntimeModStorageSqlite,
  listRuntimeModStorage,
  purgeRuntimeModStorageData,
  queryRuntimeModStorageSqlite,
  readRuntimeModStorageBytes,
  readRuntimeModStorageText,
  statRuntimeModStoragePath,
  transactRuntimeModStorageSqlite,
  writeRuntimeModStorageBytes,
  writeRuntimeModStorageText,
} from '../src/runtime/runtime-store/tauri-bridge';

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

function installTauriInvokeMock(
  handler: (command: string, payload?: unknown) => Promise<unknown> | unknown,
): () => void {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;
  globalRecord.__TAURI__ = {
    core: {
      invoke: handler,
    },
  };
  return () => {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__TAURI__;
    } else {
      globalRecord.__TAURI__ = previousTauri;
    }
  };
}

test('runtime mod storage bridge invokes file commands with normalized payloads', async () => {
  const calls: TauriInvokeCall[] = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    switch (command) {
      case 'runtime_mod_storage_file_read':
        if ((payload as { payload?: { format?: string } })?.payload?.format === 'bytes') {
          return {
            path: 'cache/blob.bin',
            bytes: [1, 2, 3],
            sizeBytes: 3,
            modifiedAt: '2026-03-14T00:00:00Z',
          };
        }
        return {
          path: 'notes/alpha.txt',
          text: 'hello',
          sizeBytes: 5,
          modifiedAt: '2026-03-14T00:00:00Z',
        };
      case 'runtime_mod_storage_file_write':
        return {
          path: ((payload as { payload?: { path?: string } })?.payload?.path) || '',
          sizeBytes: 3,
          modifiedAt: '2026-03-14T00:00:00Z',
        };
      case 'runtime_mod_storage_file_delete':
        return true;
      case 'runtime_mod_storage_file_list':
        return [
          {
            path: 'notes/alpha.txt',
            kind: 'file',
            sizeBytes: 5,
            modifiedAt: '2026-03-14T00:00:00Z',
          },
          {
            path: 'cache',
            kind: 'directory',
            sizeBytes: 0,
          },
        ];
      case 'runtime_mod_storage_file_stat':
        return {
          path: 'notes/alpha.txt',
          kind: 'file',
          sizeBytes: 5,
        };
      default:
        return null;
    }
  });

  try {
    const text = await readRuntimeModStorageText({
      modId: 'mod.alpha',
      path: 'notes/alpha.txt',
    });
    assert.equal(text.text, 'hello');

    const bytes = await readRuntimeModStorageBytes({
      modId: 'mod.alpha',
      path: 'cache/blob.bin',
    });
    assert.deepEqual(Array.from(bytes.bytes || []), [1, 2, 3]);

    await writeRuntimeModStorageText({
      modId: 'mod.alpha',
      path: 'notes/alpha.txt',
      text: 'bye',
    });
    await writeRuntimeModStorageBytes({
      modId: 'mod.alpha',
      path: 'cache/blob.bin',
      bytes: new Uint8Array([9, 8, 7]),
    });
    assert.equal(
      await deleteRuntimeModStoragePath({ modId: 'mod.alpha', path: 'notes/alpha.txt' }),
      true,
    );
    assert.deepEqual(
      await listRuntimeModStorage({ modId: 'mod.alpha', path: 'notes' }),
      [
        {
          path: 'notes/alpha.txt',
          kind: 'file',
          sizeBytes: 5,
          modifiedAt: '2026-03-14T00:00:00Z',
        },
        {
          path: 'cache',
          kind: 'directory',
          sizeBytes: 0,
          modifiedAt: undefined,
        },
      ],
    );
    assert.deepEqual(
      await statRuntimeModStoragePath({ modId: 'mod.alpha', path: 'notes/alpha.txt' }),
      {
        path: 'notes/alpha.txt',
        kind: 'file',
        sizeBytes: 5,
        modifiedAt: undefined,
      },
    );

    assert.deepEqual(calls.map((call) => call.command), [
      'runtime_mod_storage_file_read',
      'runtime_mod_storage_file_read',
      'runtime_mod_storage_file_write',
      'runtime_mod_storage_file_write',
      'runtime_mod_storage_file_delete',
      'runtime_mod_storage_file_list',
      'runtime_mod_storage_file_stat',
    ]);
    assert.deepEqual(calls[0]?.payload, {
      payload: {
        modId: 'mod.alpha',
        path: 'notes/alpha.txt',
        format: 'text',
      },
    });
    assert.deepEqual(calls[1]?.payload, {
      payload: {
        modId: 'mod.alpha',
        path: 'cache/blob.bin',
        format: 'bytes',
      },
    });
    assert.deepEqual(calls[3]?.payload, {
      payload: {
        modId: 'mod.alpha',
        path: 'cache/blob.bin',
        bytes: [9, 8, 7],
      },
    });
  } finally {
    restore();
  }
});

test('runtime mod storage bridge invokes sqlite and purge commands', async () => {
  const calls: TauriInvokeCall[] = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    switch (command) {
      case 'runtime_mod_storage_sqlite_query':
        return { rows: [{ id: 1, title: 'alpha' }] };
      case 'runtime_mod_storage_sqlite_execute':
        return { rowsAffected: 2, lastInsertRowid: 9 };
      case 'runtime_mod_storage_sqlite_transaction':
        return { rowsAffected: 3, lastInsertRowid: 12 };
      case 'runtime_mod_storage_data_purge':
        return true;
      default:
        return null;
    }
  });

  try {
    assert.deepEqual(
      await queryRuntimeModStorageSqlite({
        modId: 'mod.alpha',
        sql: 'select * from notes where id = ?1',
        params: [1],
      }),
      { rows: [{ id: 1, title: 'alpha' }] },
    );
    assert.deepEqual(
      await executeRuntimeModStorageSqlite({
        modId: 'mod.alpha',
        sql: 'delete from notes',
      }),
      { rowsAffected: 2, lastInsertRowid: 9 },
    );
    assert.deepEqual(
      await transactRuntimeModStorageSqlite({
        modId: 'mod.alpha',
        statements: [
          { sql: 'insert into notes(id, title) values (?1, ?2)', params: [1, 'alpha'] },
          { sql: 'update notes set title = ?1 where id = ?2', params: ['beta', 1] },
        ],
      }),
      { rowsAffected: 3, lastInsertRowid: 12 },
    );
    assert.equal(await purgeRuntimeModStorageData({ modId: 'mod.alpha' }), true);

    assert.deepEqual(calls.map((call) => call.command), [
      'runtime_mod_storage_sqlite_query',
      'runtime_mod_storage_sqlite_execute',
      'runtime_mod_storage_sqlite_transaction',
      'runtime_mod_storage_data_purge',
    ]);
    assert.deepEqual(calls[2]?.payload, {
      payload: {
        modId: 'mod.alpha',
        statements: [
          { sql: 'insert into notes(id, title) values (?1, ?2)', params: [1, 'alpha'] },
          { sql: 'update notes set title = ?1 where id = ?2', params: ['beta', 1] },
        ],
      },
    });
  } finally {
    restore();
  }
});
