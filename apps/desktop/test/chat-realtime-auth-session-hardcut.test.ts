import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);

test('chat realtime sync resolves bearer token from Runtime account provider', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /resolveAuthToken,/);
  assert.match(source, /getDesktopRuntimeAccessToken/);
  assert.doesNotMatch(source, /authToken,/);
  assert.doesNotMatch(source, /state\.auth\.token/);
  assert.doesNotMatch(source, /fallbackToken:\s*runtimeDefaults\?\.realm\.accessToken/);
  assert.doesNotMatch(source, /runtimeDefaults\?\.realm\.accessToken/);
});
