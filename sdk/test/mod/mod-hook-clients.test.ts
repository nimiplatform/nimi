import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuditClient, createMetaClient } from '../../src/mod/hook/meta-client.js';
import { createStorageClient } from '../../src/mod/hook/storage-client.js';
import { ReasonCode } from '../../src/types/index.js';

const runtimeStub = {
  getAudit: async () => ({ items: [] }),
  getAuditStats: async () => ({ total: 0 }),
  listRegistrations: async () => [],
  listModCapabilities: async () => [],
  getPermissionDeclaration: async () => null,
  storage: {
    files: {
      readText: async () => ({ text: '' }),
      writeText: async () => undefined,
      readBytes: async () => ({ bytes: new Uint8Array() }),
      writeBytes: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ entries: [] }),
      stat: async () => null,
    },
    sqlite: {
      query: async () => ({ rows: [] }),
      execute: async () => ({ rowsAffected: 0 }),
      transaction: async () => ({ ok: true }),
    },
  },
};

test('mod hook metadata client rejects cross-mod access with structured error', () => {
  const auditClient = createAuditClient({
    modId: 'mod.self',
    runtime: runtimeStub as never,
  });
  const metaClient = createMetaClient({
    modId: 'mod.self',
    runtime: runtimeStub as never,
  });

  assert.throws(
    () => auditClient.stats('mod.other'),
    (error: Error & { reasonCode?: string; actionHint?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.ACTION_PERMISSION_DENIED);
      assert.equal(error.actionHint, 'use_current_mod_id_only');
      return true;
    },
  );
  assert.throws(
    () => metaClient.getPermissions('mod.other'),
    (error: Error & { reasonCode?: string; actionHint?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.ACTION_PERMISSION_DENIED);
      assert.equal(error.actionHint, 'use_current_mod_id_only');
      return true;
    },
  );
});

test('mod hook storage client rejects absolute and traversal paths with structured errors', async () => {
  const storageClient = createStorageClient({
    modId: 'mod.self',
    runtime: runtimeStub as never,
  });

  await assert.rejects(
    Promise.resolve().then(() => storageClient.files.readText('/etc/passwd')),
    (error: Error & { reasonCode?: string; actionHint?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal(error.actionHint, 'use_relative_mod_storage_path');
      return true;
    },
  );
  await assert.rejects(
    Promise.resolve().then(() => storageClient.files.writeText('../secret.txt', 'nope')),
    (error: Error & { reasonCode?: string; actionHint?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal(error.actionHint, 'remove_traversal_segments');
      return true;
    },
  );
});
