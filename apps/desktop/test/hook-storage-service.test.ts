import assert from 'node:assert/strict';
import test from 'node:test';

import { HookAuditTrail } from '../src/runtime/hook/audit/hook-audit';
import type { PermissionInput } from '../src/runtime/hook/services/utils';
import { HookRuntimeStorageService } from '../src/runtime/hook/services/storage-service';

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

function installTauriInvokeMock(
  handler: (command: string, payload?: unknown) => Promise<unknown> | unknown,
): () => void {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousHook = globalRecord.__NIMI_TAURI_TEST__;
  globalRecord.__NIMI_TAURI_TEST__ = {
    invoke: handler,
    listen: async () => () => {},
  };
  return () => {
    if (typeof previousHook === 'undefined') {
      delete globalRecord.__NIMI_TAURI_TEST__;
    } else {
      globalRecord.__NIMI_TAURI_TEST__ = previousHook;
    }
  };
}

test('hook storage service evaluates storage capability and appends audit entries', async () => {
  const calls: TauriInvokeCall[] = [];
  const permissionInputs: PermissionInput[] = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'runtime_mod_storage_file_read') {
      return {
        path: 'notes/alpha.txt',
        text: 'hello',
        sizeBytes: 5,
      };
    }
    if (command === 'runtime_mod_storage_sqlite_transaction') {
      return {
        rowsAffected: 2,
        lastInsertRowid: 4,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  try {
    const audit = new HookAuditTrail();
    const service = new HookRuntimeStorageService({
      audit,
      evaluatePermission: (input) => {
        permissionInputs.push(input);
        return {
          sourceType: input.sourceType || 'sideload',
          reasonCodes: ['SOURCE_DEFAULT_ALLOW'],
        };
      },
    });

    const textResult = await service.readText({
      modId: 'mod.alpha',
      sourceType: 'sideload',
      path: 'notes/alpha.txt',
    });
    const txResult = await service.transaction({
      modId: 'mod.alpha',
      sourceType: 'sideload',
      statements: [
        { sql: 'insert into kv(key, value) values (?1, ?2)', params: ['a', '1'] },
      ],
    });

    assert.equal(textResult.text, 'hello');
    assert.deepEqual(txResult, {
      rowsAffected: 2,
      lastInsertRowid: 4,
    });

    assert.deepEqual(
      permissionInputs.map((entry) => ({
        capabilityKey: entry.capabilityKey,
        target: entry.target,
      })),
      [
        {
          capabilityKey: 'storage.files.read',
          target: 'files.read:notes/alpha.txt',
        },
        {
          capabilityKey: 'storage.sqlite.transaction',
          target: 'sqlite.transaction:1',
        },
      ],
    );

    const records = audit.query({ modId: 'mod.alpha', hookType: 'storage' });
    assert.equal(records.length, 2);
    assert.equal(records[0]?.decision, 'ALLOW');
    assert.equal(records[0]?.target, 'files.read:notes/alpha.txt');
    assert.equal(records[1]?.target, 'sqlite.transaction:1');

    assert.deepEqual(calls.map((call) => call.command), [
      'runtime_mod_storage_file_read',
      'runtime_mod_storage_sqlite_transaction',
    ]);
  } finally {
    restore();
  }
});

test('hook storage service does not invoke Tauri when permission evaluation fails', async () => {
  const calls: TauriInvokeCall[] = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    return null;
  });

  try {
    const service = new HookRuntimeStorageService({
      audit: new HookAuditTrail(),
      evaluatePermission: () => {
        throw new Error('HOOK_PERMISSION_DENIED: test');
      },
    });

    await assert.rejects(
      service.writeText({
        modId: 'mod.alpha',
        sourceType: 'codegen',
        path: 'notes/alpha.txt',
        content: 'blocked',
      }),
      /HOOK_PERMISSION_DENIED/,
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});
