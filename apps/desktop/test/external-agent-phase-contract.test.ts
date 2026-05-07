import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('external agent runtime bridge no longer parses app-local lifecycle execution requests', () => {
  const source = readDesktopFile('src/runtime/external-agent/index.ts');
  assert.doesNotMatch(source, /function parseActionPhase/);
  assert.doesNotMatch(source, /parseExecutionRequest/);
  assert.doesNotMatch(source, /root\.dryRun\s*\?\s*'dry-run'\s*:\s*'commit'/);
  assert.doesNotMatch(source, /phaseRaw === 'commit'[\s\S]*:\s*'commit'/);
});

test('external agent renderer bridge no longer subscribes to app-local execution requests', () => {
  const source = readDesktopFile('src/shell/renderer/bridge/runtime-bridge/external-agent.ts');
  assert.doesNotMatch(source, /function parseActionPhase/);
  assert.doesNotMatch(source, /parseExecutionRequest/);
  assert.match(source, /return \(\) => \{\};/);
  assert.doesNotMatch(source, /record\.dryRun\s*\?\s*'dry-run'\s*:\s*'commit'/);
  assert.doesNotMatch(source, /phaseRaw === 'commit'[\s\S]*:\s*'commit'/);
});
