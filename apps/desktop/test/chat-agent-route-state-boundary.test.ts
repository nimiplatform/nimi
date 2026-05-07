import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('agent conversation launcher keeps route identity out of runtimeFields', () => {
  const source = readSource('apps/desktop/src/shell/renderer/features/chat/agent-conversation-launcher.ts');
  assert.match(source, /setAgentConversationSelection\(\{/);
  assert.doesNotMatch(source, /setRuntimeFields\(\s*\{/);
  assert.doesNotMatch(source, /runtimeFields[^]*targetAccountId:\s*agentId/);
  assert.doesNotMatch(source, /runtimeFields[^]*targetId:\s*agentId/);
  assert.doesNotMatch(source, /worldId:\s*input\.target\.worldId/);
});
