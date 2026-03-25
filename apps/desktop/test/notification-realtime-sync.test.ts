import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('notification realtime sync wiring', () => {
  test('realtime controller wiring invalidates notification queries', () => {
    assert.match(source, /invalidateNotifications:\s*\(\)\s*=>\s*invalidateNotificationQueries\(\)/);
  });

  test('chat realtime sync wires the shared realm realtime controller instead of bespoke socket handlers', () => {
    assert.match(source, /useRealmChatRealtimeController\(\{/);
    assert.doesNotMatch(source, /socket\.on\('notif:new'/);
  });
});
