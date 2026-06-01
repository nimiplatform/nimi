import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('external agent runtime bridge no longer parses app-local lifecycle execution requests', () => {
  assert.equal(existsSync(path.join(desktopDir, 'src/runtime/external-agent/index.ts')), false);
  const source = readDesktopFile('src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx');
  assert.doesNotMatch(source, /function parseActionPhase/);
  assert.doesNotMatch(source, /parseExecutionRequest/);
  assert.doesNotMatch(source, /root\.dryRun\s*\?\s*'dry-run'\s*:\s*'commit'/);
  assert.doesNotMatch(source, /phaseRaw === 'commit'[\s\S]*:\s*'commit'/);
});

test('external agent shell bridge forwarding surface stays retired', () => {
  const bridgePath = path.join(desktopDir, 'src/shell/renderer/bridge/runtime-bridge/external-agent.ts');
  assert.equal(existsSync(bridgePath), false);
});
