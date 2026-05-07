import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);

test('chat realtime sync does not use runtime defaults accessToken as bearer fallback', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /authToken,/);
  assert.doesNotMatch(source, /fallbackToken:\s*runtimeDefaults\?\.realm\.accessToken/);
  assert.doesNotMatch(source, /runtimeDefaults\?\.realm\.accessToken/);
});
