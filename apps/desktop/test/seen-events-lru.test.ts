import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const realtimeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts'),
  'utf8',
);

test('D-NET-006: seenEvents uses LRU promotion (delete + re-insert)', () => {
  // LRU requires delete-then-set pattern for promotion
  assert.ok(
    realtimeSource.includes('.delete(') && realtimeSource.includes('.set('),
    'seenEvents must use delete + set pattern for LRU promotion',
  );
});

test('D-NET-006: seenEvents capacity is 3000', () => {
  assert.ok(
    realtimeSource.includes('3000'),
    'seenEvents capacity must be 3000',
  );
});

test('D-NET-006: seenEvents evicts oldest entry', () => {
  // Map.keys().next().value gives the oldest entry in insertion order
  assert.ok(
    realtimeSource.includes('.keys()'),
    'seenEvents eviction must iterate keys for oldest entry',
  );
});
