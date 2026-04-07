import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('agent effective capability resolution only marks LOCAL + AGENT_LOCAL as ready', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/conversation-capability.ts');

  assert.match(
    source,
    /function isAgentEligibilityReadyForLocalExecution\(/,
    'conversation-capability.ts must centralize agent eligibility execution gating',
  );
  assert.match(
    source,
    /return eligibility\.channel === 'LOCAL' && eligibility\.sessionClass === 'AGENT_LOCAL';/,
    'AgentEffectiveCapabilityResolution must only become ready for LOCAL \\+ AGENT_LOCAL eligibility',
  );
  assert.match(
    source,
    /if \(!isAgentEligibilityReadyForLocalExecution\(eligibility\)\) \{/,
    'buildAgentEffectiveCapabilityResolution must fail-close on non-local or HUMAN_DIRECT eligibility',
  );
});

test('chat ai runtime no longer retains authoritative-health fallback helper', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-runtime.ts');

  assert.equal(
    /resolvePreferredChatLocalModel/.test(source),
    false,
    'chat-ai-runtime.ts must not retain resolvePreferredChatLocalModel',
  );
  assert.equal(
    /Fall back to runtime-config state when authoritative health is unavailable/.test(source),
    false,
    'chat-ai-runtime.ts must not retain runtime-config fallback commentary or logic',
  );
});
