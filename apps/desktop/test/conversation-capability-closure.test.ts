import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('agent effective capability resolution checks textProjection + resolvedBinding', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/conversation-capability.ts');

  assert.match(
    source,
    /function buildAgentEffectiveCapabilityResolution\(/,
    'conversation-capability.ts must export buildAgentEffectiveCapabilityResolution',
  );
  assert.match(
    source,
    /textProjection: ConversationCapabilityProjection \| null;/,
    'buildAgentEffectiveCapabilityResolution input must accept textProjection',
  );
  assert.match(
    source,
    /reason:\s*\n?\s*\| 'ok'\s*\n?\s*\| 'projection_unavailable'\s*\n?\s*\| 'route_unresolved'/,
    'AgentEffectiveCapabilityResolution reason must be ok | projection_unavailable | route_unresolved',
  );
  assert.doesNotMatch(
    source,
    /AgentCapabilityEligibility/,
    'AgentCapabilityEligibility type must not exist',
  );
  assert.doesNotMatch(
    source,
    /\beligibility\b/,
    'eligibility field must not exist in AgentEffectiveCapabilityResolution',
  );
});

test('chat ai runtime no longer retains authoritative-health fallback helper', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-runtime.ts');

  assert.equal(
    /resolvePreferredChatLocalModel/.test(source),
    false,
    'chat-nimi-runtime.ts must not retain resolvePreferredChatLocalModel',
  );
  assert.equal(
    /Fall back to runtime-config state when authoritative health is unavailable/.test(source),
    false,
    'chat-nimi-runtime.ts must not retain runtime-config fallback commentary or logic',
  );
});
