import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('chat send cache helper reuses shared realm merge logic instead of ad hoc local patches', () => {
  const cacheHelperSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/turns/chat-send-cache.ts'),
    'utf8',
  );

  assert.match(cacheHelperSource, /mergeRealmRealtimeMessageIntoMessagesResult/);
  assert.match(cacheHelperSource, /applyRealmRealtimeMessageToChatsResult/);
  assert.match(cacheHelperSource, /setQueryData<RealmListMessagesResultDto>/);
  assert.match(cacheHelperSource, /getQueriesData<RealmListChatsResultDto>/);
});
