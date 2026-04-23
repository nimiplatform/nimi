import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('D-NET-007: polling/realtime coordination', () => {
  test('D-NET-007: shared group invalidation helper refreshes group chat list and message queries', () => {
    assert.match(source, /function invalidateGroupChatQueries\(chatId: string\): void \{\s*void queryClient\.invalidateQueries\(\{ queryKey: \['group-chats'\] \}\);\s*void queryClient\.invalidateQueries\(\{ queryKey: \['group-messages', chatId\] \}\);\s*\}/s);
  });

  test('D-NET-007: controller wiring invalidates chat list queries', () => {
    assert.match(source, /invalidateChats:\s*\(\)\s*=>\s*queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\)/);
  });

  test('D-NET-007: controller wiring flushes chat outbox on reconnect path', () => {
    assert.match(source, /flushChatOutbox:\s*\(\)\s*=>\s*dataSync\.flushChatOutbox\(\)/);
  });

  test('D-NET-007: controller wiring exposes syncChatEvents and message invalidation', () => {
    assert.match(source, /syncChatEvents:\s*\(chatId,\s*afterSeq,\s*limit\)\s*=>\s*dataSync\.syncChatEvents\(chatId,\s*afterSeq,\s*limit\)/);
    assert.match(source, /invalidateMessages:\s*\(chatId\)\s*=>\s*queryClient\.invalidateQueries\(\{ queryKey: \['messages', chatId\] \}\)/);
  });

  test('D-NET-007: shared seenEvents LRU has 3000 capacity', () => {
    assert.match(
      source,
      /rememberRealmChatSeenEvent/,
      'chat realtime sync must reuse the shared seen-event helper',
    );
  });

  test('D-NET-007: chat events and sync snapshots are delegated to the shared controller', () => {
    assert.match(source, /applyChatEvent:\s*\(\{ event,\s*selectedChatId: activeChatId,\s*currentUserId: activeUserId \}\)\s*=>/);
    assert.match(source, /applySyncSnapshot:\s*\(chatId,\s*snapshot\)\s*=>/);
  });

  test('D-NET-007: group fallback invalidation covers created, updated, and read events', () => {
    assert.match(source, /if \(!chatMerge\.found\) \{\s*void queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\);\s*[\s\S]*?invalidateGroupChatQueries\(input\.event\.chatId\);[\s\S]*?\}/s);
    assert.match(source, /if \(!found\) \{\s*void queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\);\s*invalidateGroupChatQueries\(input\.event\.chatId\);\s*\}/s);
    assert.match(source, /if \(input\.event\.kind === 'chat\.read'\) \{\s*void queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\);\s*invalidateGroupChatQueries\(input\.event\.chatId\);\s*\}/s);
  });
});

describe('D-OFFLINE-001: realm reachability via socket lifecycle', () => {
  test('D-OFFLINE-001: controller wiring updates socket reachability signal', () => {
    assert.match(source, /onSocketReachableChange:\s*\(reachable\)\s*=>\s*\{\s*offlineCoordinator\.markRealmSocketReachable\(reachable\);?\s*\}/s);
  });

  test('D-OFFLINE-001: socket lifecycle does not directly mark REST reachability false', () => {
    assert.ok(
      !source.includes('markRealmRestReachable(false)'),
      'realtime sync must not mark REST reachability false directly',
    );
  });

  test('D-OFFLINE-004: socket reconnect backoff is explicitly configured', () => {
    assert.ok(
      source.includes('reconnectionDelay: 1000'),
      'socket must configure reconnectionDelay: 1000',
    );
    assert.ok(
      source.includes('reconnectionDelayMax: 30_000'),
      'socket must configure reconnectionDelayMax: 30_000',
    );
    assert.ok(
      source.includes('reconnectionAttempts: Infinity'),
      'socket must configure reconnectionAttempts: Infinity',
    );
  });
});
