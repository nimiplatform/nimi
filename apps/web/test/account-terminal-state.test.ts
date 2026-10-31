import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiError } from '@nimiplatform/sdk/types';
import { getAccountTerminationIntent, recoverAccountTerminationReceipt } from '../src/auth/account-terminal-state.js';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; } };
}

test('a deletion retry preserves one intent per Realm and displayed account', () => {
  const store = storage(); let allocated = 0;
  const id = () => `deletion_operation_${++allocated}`;
  const first = getAccountTerminationIntent(store, 'https://realm-a.test', 'alice', id);
  assert.deepEqual(getAccountTerminationIntent(store, 'https://realm-a.test', 'alice', id), first);
  assert.notDeepEqual(getAccountTerminationIntent(store, 'https://realm-a.test', 'bob', id), first);
  assert.notDeepEqual(getAccountTerminationIntent(store, 'https://realm-b.test', 'alice', id), first);
  assert.equal(allocated, 3);
});

test('a stored intent and an ordinary authentication failure never confirm deletion', () => {
  const store = storage();
  const intent = getAccountTerminationIntent(store, 'https://realm.test', 'alice', () => 'deletion_operation_001');
  for (const reasonCode of ['AUTH_REQUIRED', 'AUTH_TOKEN_EXPIRED', 'AUTH_SESSION_REVOKED', 'AUTH_ACCOUNT_RESTRICTED']) {
    assert.equal(recoverAccountTerminationReceipt(store, 'https://realm.test', createNimiError({ reasonCode, source: 'realm', message: 'Authentication failed',
      details: { payload: { operation_id: intent.operation_id, deleted_at: '2026-10-30T00:00:00Z' } } })), null);
  }
  assert.equal(store.length, 1);
});

test('only the same owner operation and Realm can recover a response lost before reload', () => {
  const store = storage();
  const intent = getAccountTerminationIntent(store, 'https://realm.test', 'alice', () => 'deletion_operation_001');
  const reply = (operation: string) => createNimiError({ reasonCode: 'ACCOUNT_DELETED', source: 'realm', message: 'Account deleted',
    details: { payload: { operation_id: operation, deleted_at: '2026-10-30T00:00:00Z' } } });
  assert.equal(recoverAccountTerminationReceipt(store, 'https://other-realm.test', reply(intent.operation_id)), null);
  assert.equal(recoverAccountTerminationReceipt(store, 'https://realm.test', reply('deletion_other_0001')), null);
  assert.deepEqual(recoverAccountTerminationReceipt(store, 'https://realm.test', reply(intent.operation_id)),
    { operation_id: intent.operation_id, deleted_at: '2026-10-30T00:00:00Z' });
  assert.equal(store.length, 0);
});
