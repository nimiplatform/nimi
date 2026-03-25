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

test('turn input routes text sends through cache merge and composer submitting state', () => {
  const turnInputSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/turns/turn-input.tsx'),
    'utf8',
  );

  assert.match(turnInputSource, /mergeSentRealmChatMessageIntoCache/);
  assert.match(turnInputSource, /onResponse:\s*async\s*\(message\)\s*=>\s*\{/);
  assert.match(turnInputSource, /mergeSentMessageIntoCache\(message\);/);
  assert.match(turnInputSource, /composer\.isSubmitting/);
  assert.doesNotMatch(turnInputSource, /\bsendMutation\b/);
});
