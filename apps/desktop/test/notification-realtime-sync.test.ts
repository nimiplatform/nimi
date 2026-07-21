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

describe('notification broker sync wiring', () => {
  test('broker projection refresh invalidates notification queries', () => {
    assert.match(source, /bindings\.app\.events\.connectChatRealtimeSync/);
    assert.match(connectorSource, /syncThroughBroker/);
    assert.match(connectorSource, /invalidateNotificationQueries\(input\.queryClient\),/);
  });

  test('chat sync polls mediated projections instead of opening a renderer socket', () => {
    const combined = `${source}\n${connectorSource}`;
    assert.match(connectorSource, /BROKER_SYNC_INTERVAL_MS/);
    assert.match(connectorSource, /globalThis\.setInterval/);
    assert.doesNotMatch(combined, /useRealmChatRealtimeController\(\{/);
    assert.doesNotMatch(combined, /socket\.on\('notif:new'/);
    assert.doesNotMatch(combined, /Authorization|Bearer|resolveAuthToken/);
  });
});
