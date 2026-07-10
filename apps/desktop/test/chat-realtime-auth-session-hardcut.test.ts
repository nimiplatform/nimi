import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);

test('chat sync uses Runtime-mediated projections without resolving a bearer token', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /syncThroughBroker/);
  assert.match(source, /queryClient\.invalidateQueries/);
  assert.match(source, /flushPendingChatOutbox/);
  assert.doesNotMatch(source, /resolveAuthToken/);
  assert.doesNotMatch(source, /getDesktopRuntimeAccessToken/);
  assert.doesNotMatch(source, /authToken,/);
  assert.doesNotMatch(source, /state\.auth\.token/);
  assert.doesNotMatch(source, /fallbackToken:\s*runtimeDefaults\?\.realm\.accessToken/);
  assert.doesNotMatch(source, /runtimeDefaults\?\.realm\.accessToken/);
  assert.doesNotMatch(source, /Authorization|Bearer|socket\.io|WebSocket/);
});
