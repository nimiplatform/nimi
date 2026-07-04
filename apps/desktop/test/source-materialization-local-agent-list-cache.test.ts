import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  toLocalAgentSourceDiscoveryProjections,
  type LocalAgentListItem,
} from '../src/shell/renderer/features/agents/local-agent-list-model.js';
import {
  resolveRealmPersonaSourceState,
} from '../src/shell/renderer/features/explore/realm-persona-source-materialization.js';

const repoRoot = path.join(import.meta.dirname, '../../..');

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('source materialization launch paths refresh Runtime localAgent list before opening chat', () => {
  const launchSources = [
    readRepo('apps/desktop/src/shell/renderer/features/explore/explore-panel.tsx'),
    readRepo('apps/desktop/src/shell/renderer/features/source-detail/source-detail-panel.tsx'),
  ];

  for (const source of launchSources) {
    assert.match(source, /localAgentListQueryKey/);
    assert.match(source, /ensureRuntimeAgentExists\(target\)/);
    assert.match(
      source,
      /invalidateQueries\(\{\s*queryKey:\s*localAgentListQueryKey\(ownerUserId\),\s*exact:\s*true\s*\}\)/,
    );
    assert.match(source, /launchAgentConversationFromDisplay/);
  }
});

test('Source Detail can derive local_agent_available from Runtime ListAgents projection', () => {
  const sourceRef = {
    kind: 'realmPersona' as const,
    worldId: 'world-1',
    sourceId: 'persona-1',
    sourceContentHash: 'hash-1',
  };
  const [projection] = toLocalAgentSourceDiscoveryProjections([{
    localAgentRef: 'local-agent:runtime-0123456789abcdef0123456789abcdef',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:realmPersona:world-1:persona-1:hash-1',
    displayName: 'Persona One',
    sourceRef,
    sourceKey: 'realmPersona:world-1:persona-1:hash-1',
  } satisfies LocalAgentListItem], sourceRef);

  assert.deepEqual(projection, {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:realmPersona:world-1:persona-1:hash-1',
    localAgentRef: 'local-agent:runtime-0123456789abcdef0123456789abcdef',
    sourceKind: 'realmPersona',
    sourceWorldId: 'world-1',
    sourceId: 'persona-1',
    sourceContentHash: 'hash-1',
  });
  assert.equal(
    resolveRealmPersonaSourceState({
      id: 'persona-1',
      sourceRef,
      sourceKind: sourceRef.kind,
      sourceWorldId: sourceRef.worldId,
      sourceId: sourceRef.sourceId,
      sourceContentHash: sourceRef.sourceContentHash,
      runtimeSourceRef: null,
    }, projection ? [projection] : []),
    'local_agent_available',
  );
});
