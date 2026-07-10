import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('notification broker sync wiring', () => {
  test('broker projection refresh invalidates notification queries', () => {
    assert.match(source, /syncThroughBroker/);
    assert.match(source, /invalidateNotificationQueries\(\),/);
  });

  test('chat sync polls mediated projections instead of opening a renderer socket', () => {
    assert.match(source, /BROKER_SYNC_INTERVAL_MS/);
    assert.match(source, /globalThis\.setInterval/);
    assert.doesNotMatch(source, /useRealmChatRealtimeController\(\{/);
    assert.doesNotMatch(source, /socket\.on\('notif:new'/);
    assert.doesNotMatch(source, /Authorization|Bearer|resolveAuthToken/);
  });
});
