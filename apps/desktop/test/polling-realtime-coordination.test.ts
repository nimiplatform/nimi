import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');
const connectorSource = readFileSync(resolve(
  import.meta.dirname,
  '../src/shell/renderer/infra/realtime/production-chat-realtime-sync.ts',
), 'utf-8');

describe('Runtime account broker projection refresh', () => {
  test('broker refresh covers chat, selected messages, notifications, and outboxes', () => {
    assert.match(connectorSource, /const syncThroughBroker = async \(\) => \{/);
    assert.match(connectorSource, /input\.queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\)/);
    assert.match(connectorSource, /queryKey: \['messages', input\.selectedChatId\]/);
    assert.match(connectorSource, /invalidateNotificationQueries\(input\.queryClient\)/);
    assert.match(connectorSource, /flushPendingChatOutbox\(undefined, createDesktopRealmChatService\(callRealmApi\)\)/);
    assert.match(connectorSource, /flushPendingSocialMutations\(callRealmApi, emitRealmDataError\)/);
  });

  test('broker refresh is serialized and runs immediately, periodically, and on visibility', () => {
    assert.match(connectorSource, /if \(!active \|\| inFlight\) return;/);
    assert.match(connectorSource, /void syncThroughBroker\(\);/);
    assert.match(connectorSource, /globalThis\.setInterval\([\s\S]*BROKER_SYNC_INTERVAL_MS/s);
    assert.match(connectorSource, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
    assert.match(connectorSource, /document\.visibilityState === 'visible'/);
  });

  test('unauthenticated state disables broker refresh and the socket signal remains false', () => {
    assert.match(connectorSource, /offlineCoordinator\.markRealmSocketReachability\('unknown'\)/);
    assert.match(source, /if \(authStatus !== 'authenticated'\) return undefined;/);
    assert.match(source, /bindings\.app\.events\.connectChatRealtimeSync/);
  });

  test('shared seenEvents LRU helper remains stable for retained cache callers', () => {
    assert.match(
      source,
      /rememberRealmChatSeenEvent/,
      'chat sync must reuse the shared seen-event helper',
    );
  });

  test('renderer does not open a direct Realm socket or resolve raw authorization', () => {
    const combined = `${source}\n${connectorSource}`;
    assert.doesNotMatch(combined, /useRealmChatRealtimeController|socket\.io|WebSocket|resolveRealtimeUrl/);
    assert.doesNotMatch(combined, /Authorization|Bearer|resolveAuthToken|getAccessToken/);
    assert.doesNotMatch(combined, /markRealmRestReachability\('unreachable'\)/);
  });
});
