import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeExecutionNotificationPreferences,
  EXECUTION_NOTIFICATION_PAUSE_MS,
  parseExecutionNotificationPreferences,
  readExecutionNotificationPreferences,
  type ExecutionNotificationStorage,
} from '../src/shell/renderer/features/home/execution-notification-preferences.js';

test('notification schema keeps the existing document and admits only a valid optional pause', () => {
  assert.deepEqual(parseExecutionNotificationPreferences({ version: 1, systemEnabled: false }), { systemEnabled: false });
  assert.deepEqual(parseExecutionNotificationPreferences({ version: 1, systemEnabled: true, pausedUntil: 1000 }), { systemEnabled: true, pausedUntil: 1000 });
  for (const pausedUntil of [null, '1000', -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => parseExecutionNotificationPreferences({ version: 1, systemEnabled: true, pausedUntil }));
  }
});

test('pause and resume preserve permanent disable; missing alone admits defaults', async () => {
  let document: unknown = { version: 1, systemEnabled: false };
  const storage = {
    readJson: async () => ({ value: document }),
    writeJson: async (_path: string, value: unknown) => { document = value; },
  } as unknown as ExecutionNotificationStorage;
  await changeExecutionNotificationPreferences(storage, { kind: 'pause' }, () => {}, () => 1000);
  assert.deepEqual(document, { version: 1, systemEnabled: false, pausedUntil: 1000 + EXECUTION_NOTIFICATION_PAUSE_MS });
  await changeExecutionNotificationPreferences(storage, { kind: 'resume' }, () => {});
  assert.deepEqual(document, { version: 1, systemEnabled: false });
  const unavailable = { ...storage, readJson: async () => { throw { reasonCode: 'RUNTIME_UNAVAILABLE' }; } };
  await assert.rejects(readExecutionNotificationPreferences(unavailable), { reasonCode: 'RUNTIME_UNAVAILABLE' });
  const missing = { ...storage, readJson: async () => { throw { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' }; } };
  assert.deepEqual(await readExecutionNotificationPreferences(missing), { systemEnabled: true });
});

test('a scope invalidated while reading does not issue a preference write', async () => {
  let release!: (value: { value: unknown }) => void;
  let current = true, writes = 0;
  const storage = {
    readJson: () => new Promise(resolve => { release = resolve; }),
    writeJson: async () => { writes += 1; },
  } as unknown as ExecutionNotificationStorage;
  const pending = changeExecutionNotificationPreferences(storage, { kind: 'pause' }, () => {
    if (!current) throw new Error('scope changed');
  });
  current = false;
  release({ value: { version: 1, systemEnabled: true } });
  await assert.rejects(pending, /scope changed/);
  assert.equal(writes, 0);
});
