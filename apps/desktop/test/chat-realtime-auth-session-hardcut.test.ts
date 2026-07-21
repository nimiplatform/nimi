import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const connectorPath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/infra/realtime/production-chat-realtime-sync.ts',
);

test('chat sync uses Runtime-mediated projections without resolving a bearer token', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const connector = readFileSync(connectorPath, 'utf8');
  const combined = `${source}\n${connector}`;
  assert.match(source, /bindings\.app\.events\.connectChatRealtimeSync/);
  assert.match(connector, /syncThroughBroker/);
  assert.match(connector, /queryClient\.invalidateQueries/);
  assert.match(connector, /flushPendingChatOutbox/);
  assert.doesNotMatch(combined, /resolveAuthToken|getDesktopRuntimeAccessToken|authToken,/);
  assert.doesNotMatch(combined, /state\.auth\.token|fallbackToken:\s*runtimeDefaults\?\.realm\.accessToken/);
  assert.doesNotMatch(combined, /runtimeDefaults\?\.realm\.accessToken/);
  assert.doesNotMatch(combined, /Authorization|Bearer|socket\.io|WebSocket/);
});
