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

test('chat realtime renderer owns neither credentials nor a direct transport', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const connector = readFileSync(connectorPath, 'utf8');
  const combined = `${source}\n${connector}`;
  assert.doesNotMatch(combined, /\b(?:accessToken|refreshToken|authToken)\b|state\.auth\.token/);
  assert.doesNotMatch(combined, /\b(?:Authorization|Bearer|WebSocket)\b|socket\.io|fetch\s*\(/);
});
