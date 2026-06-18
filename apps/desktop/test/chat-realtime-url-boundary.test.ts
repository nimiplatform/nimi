import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const realtimeSyncSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts'),
  'utf8',
);

test('Desktop chat realtime consumes SDK Realm realtime projection', () => {
  assert.match(realtimeSyncSource, /resolveNimiRealmRealtimeUrl/);
  assert.match(realtimeSyncSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.doesNotMatch(realtimeSyncSource, /projectRealmRealtimeUrl/);
  assert.doesNotMatch(realtimeSyncSource, /resolveRealtimeUrl/);
});
