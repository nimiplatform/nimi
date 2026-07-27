import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('Desktop Runtime bridge does not accept a public Runtime endpoint', () => {
  const mainSource = readDesktopFile('src-electron/main.ts');

  assert.doesNotMatch(mainSource, /NIMI_[A-Z_]*RUNTIME_[A-Z_]*(?:ADDR|ENDPOINT)/);
  assert.doesNotMatch(mainSource, /runtimeEndpoint:\s*['"`](?:https?|grpc|tcp):/i);
  assert.doesNotMatch(mainSource, /runtimeEndpoint:\s*(?:process\.env|normalizeText\(process\.env)/);
});
