import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('external agent runtime parser requires an explicit lifecycle phase', () => {
  const source = readDesktopFile('src/runtime/external-agent/index.ts');
  assert.match(source, /function parseActionPhase/);
  assert.match(source, /phase === 'dry-run' \|\| phase === 'verify' \|\| phase === 'commit'/);
  assert.match(source, /ReasonCode\.ACTION_INPUT_INVALID/);
  assert.doesNotMatch(source, /root\.dryRun\s*\?\s*'dry-run'\s*:\s*'commit'/);
  assert.doesNotMatch(source, /phaseRaw === 'commit'[\s\S]*:\s*'commit'/);
});

test('external agent renderer bridge parser does not default invalid phase to commit', () => {
  const source = readDesktopFile('src/shell/renderer/bridge/runtime-bridge/external-agent.ts');
  assert.match(source, /function parseActionPhase/);
  assert.match(source, /phase === 'dry-run' \|\| phase === 'verify' \|\| phase === 'commit'/);
  assert.match(source, /Invalid external action requests fail closed/);
  assert.doesNotMatch(source, /record\.dryRun\s*\?\s*'dry-run'\s*:\s*'commit'/);
  assert.doesNotMatch(source, /phaseRaw === 'commit'[\s\S]*:\s*'commit'/);
});
