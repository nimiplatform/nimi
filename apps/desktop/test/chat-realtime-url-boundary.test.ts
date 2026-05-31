import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { projectRealmRealtimeUrl } from '@nimiplatform/sdk/realm';

const realtimeSyncSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts'),
  'utf8',
);

test('Desktop chat realtime consumes SDK Realm realtime projection', () => {
  assert.match(realtimeSyncSource, /projectRealmRealtimeUrl/);
  assert.match(realtimeSyncSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.doesNotMatch(realtimeSyncSource, /resolveRealtimeUrl/);
});

test('SDK realtime projection preserves Desktop local development port behavior', () => {
  assert.equal(
    projectRealmRealtimeUrl({
      realmBaseUrl: 'http://localhost:3002/api',
      realtimeUrl: '',
    }),
    'http://localhost:3003',
  );
  assert.equal(
    projectRealmRealtimeUrl({
      realmBaseUrl: 'https://realm.example/api',
      realtimeUrl: 'https://socket.example/socket.io',
    }),
    'https://socket.example',
  );
});
