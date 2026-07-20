import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('Runtime account broker projection refresh', () => {
  test('broker refresh covers chat, selected messages, notifications, and outboxes', () => {
    assert.match(source, /const syncThroughBroker = async \(\) => \{/);
    assert.match(source, /queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\)/);
    assert.match(source, /queryClient\.invalidateQueries\(\{ queryKey: \['messages', selectedChatId\] \}\)/);
    assert.match(source, /invalidateNotificationQueries\(\)/);
    assert.match(source, /flushPendingChatOutbox\(\)/);
    assert.match(source, /realmSocialData\.flushSocialOutbox\(\)/);
  });

  test('broker refresh is serialized and runs immediately, periodically, and on visibility', () => {
    assert.match(source, /if \(cancelled \|\| inFlight\) \{/);
    assert.match(source, /void syncThroughBroker\(\);/);
    assert.match(source, /globalThis\.setInterval\([\s\S]*BROKER_SYNC_INTERVAL_MS/s);
    assert.match(source, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
    assert.match(source, /document\.visibilityState === 'visible'/);
  });

  test('unauthenticated state disables broker refresh and the socket signal remains false', () => {
    assert.match(source, /offlineCoordinator\.markRealmSocketReachability\('unknown'\)/);
    assert.match(source, /if \(authStatus !== 'authenticated'\) \{\s*return undefined;/s);
  });

  test('shared seenEvents LRU helper remains stable for retained cache callers', () => {
    assert.match(
      source,
      /rememberRealmChatSeenEvent/,
      'chat sync must reuse the shared seen-event helper',
    );
  });

  test('renderer does not open a direct Realm socket or resolve raw authorization', () => {
    assert.doesNotMatch(source, /useRealmChatRealtimeController|socket\.io|WebSocket|resolveRealtimeUrl/);
    assert.doesNotMatch(source, /Authorization|Bearer|resolveAuthToken|getAccessToken/);
    assert.doesNotMatch(source, /markRealmRestReachability\('unreachable'\)/);
  });
});
