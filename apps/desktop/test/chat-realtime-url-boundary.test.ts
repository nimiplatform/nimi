import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const realtimeSyncSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts'),
  'utf8',
);
const productionConnectorSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/infra/realtime/production-chat-realtime-sync.ts'),
  'utf8',
);

test('Desktop chat sync stays on Runtime-mediated projections without a direct Realm realtime URL', () => {
  const combined = `${realtimeSyncSource}\n${productionConnectorSource}`;
  assert.match(realtimeSyncSource, /bindings\.app\.events\.connectChatRealtimeSync/);
  assert.match(productionConnectorSource, /syncThroughBroker/);
  assert.match(productionConnectorSource, /queryClient\.invalidateQueries/);
  assert.doesNotMatch(combined, /from '@nimiplatform\/sdk\/realm'/);
  assert.doesNotMatch(combined, /resolveNimiRealmRealtimeUrl|projectRealmRealtimeUrl|resolveRealtimeUrl/);
  assert.doesNotMatch(combined, /\/socket\.io|WebSocket/);
});
