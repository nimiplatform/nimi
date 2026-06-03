import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const humanChatDataSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/data/realm-human-chat-data.ts'),
  'utf8',
);

describe('D-OFFLINE-004: Desktop delegates realtime conflict handling to Kit Realm chat helpers', () => {
  test('Desktop no longer owns the message identity algorithm', () => {
    assert.match(humanChatDataSource, /@nimiplatform\/kit\/features\/chat\/realm/);
    assert.doesNotMatch(humanChatDataSource, /function sameMessageIdentity/);
  });
});
