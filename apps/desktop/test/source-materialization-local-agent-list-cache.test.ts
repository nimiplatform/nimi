import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toLocalAgentSourceDiscoveryProjections,
  type LocalAgentListItem,
} from '../src/shell/renderer/features/agents/local-agent-list-model.js';
import {
  resolveCharacterSourceState,
} from '../src/shell/renderer/features/explore/character-source-materialization.js';

test('Source Detail can derive local_agent_available from Runtime ListAgents projection', () => {
  const sourceRef = {
    kind: 'personaCharacter' as const,
    id: 'persona-1',
    worldId: 'world-1',
    ownerAccountId: 'account-1',
    sourceHash: 'a'.repeat(64),
  };
  const [projection] = toLocalAgentSourceDiscoveryProjections([{
    localAgentRef: 'local-agent:runtime-0123456789abcdef0123456789abcdef',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:personaCharacter:world-1:persona-1',
    displayName: 'Persona One',
    sourceRef,
    sourceKey: `personaCharacter:world-1:persona-1:account-1:${'a'.repeat(64)}`,
  } satisfies LocalAgentListItem], sourceRef);

  assert.deepEqual(projection, {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:personaCharacter:world-1:persona-1',
    localAgentRef: 'local-agent:runtime-0123456789abcdef0123456789abcdef',
    sourceKind: 'personaCharacter',
    sourceWorldId: 'world-1',
    sourceId: 'persona-1',
    sourceHash: 'a'.repeat(64),
  });
  assert.equal(
    resolveCharacterSourceState({
      id: 'persona-1',
      sourceRef,
      sourceKind: sourceRef.kind,
      sourceWorldId: sourceRef.worldId,
      sourceId: sourceRef.id,
      sourceHash: sourceRef.sourceHash,
      runtimeSourceRef: null,
    }, projection ? [projection] : []),
    'local_agent_available',
  );
});
