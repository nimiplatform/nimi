import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hostActionsSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-nimi-shell-host-actions.ts'),
  'utf8',
);

test('chat ai host actions contract: submit self-heals missing persisted thread before writing messages', () => {
  assert.match(
    hostActionsSource,
    /export\s+async\s+function\s+ensureChatAiThreadRecordPersisted/,
    'AI host actions must export a thread persistence helper',
  );
  assert.match(
    hostActionsSource,
    /chatAiStoreClient\.getThreadBundle\(input\.thread\.id\)/,
    'AI host actions must probe the persisted thread bundle before assuming an existing thread is still stored',
  );
  assert.match(
    hostActionsSource,
    /recoveredMissingThread\s*=\s*persistence\.recoveredMissingThread/,
    'AI submit must track when it recovered a missing persisted thread',
  );
  assert.match(
    hostActionsSource,
    /messages:\s*\[userMessage,\s*assistantPlaceholder\]/,
    'AI submit must reset stale bundle state to the optimistic user and assistant placeholder messages after recovering a missing thread',
  );
  assert.match(
    hostActionsSource,
    /recoveredMissingThread\s*\?\s*\[\]\s*:\s*\(input\.bundleMessages\s*\|\|\s*\[\]\)/,
    'AI submit must avoid replaying stale history from a thread that had to be recreated in the store',
  );
});
