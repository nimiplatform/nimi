import assert from 'node:assert/strict';
import test from 'node:test';

import { toNimiRuntimeProtoStruct } from '@nimiplatform/sdk/runtime';
import { toLocalAgentListItem } from '../src/shell/renderer/features/agents/local-agent-list-model.js';

const OWNER = 'user-1';

function makeAgentRecord(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Kaelis',
    localAgentRef: 'local-agent:01ABC',
    ownerUserId: OWNER,
    runtimeSourceRef: 'runtime-source:xyz',
    metadata: toNimiRuntimeProtoStruct({
      sourceMaterialization: {
        sourceKind: 'worldCharacter',
        sourceWorldId: 'world-1',
        sourceId: 'char-1',
        sourceContentHash: 'hash-1',
      },
    }),
    ...overrides,
  };
}

test('Characters tab maps a source-materialized runtime agent record', () => {
  const item = toLocalAgentListItem(makeAgentRecord(), OWNER);
  assert.ok(item);
  assert.equal(item.localAgentRef, 'local-agent:01ABC');
  assert.equal(item.displayName, 'Kaelis');
  assert.equal(item.runtimeSourceRef, 'runtime-source:xyz');
  assert.deepEqual(item.sourceRef, {
    kind: 'worldCharacter',
    worldId: 'world-1',
    sourceId: 'char-1',
    sourceContentHash: 'hash-1',
  });
});

test('Characters tab excludes agents owned by another account', () => {
  assert.equal(toLocalAgentListItem(makeAgentRecord({ ownerUserId: 'someone-else' }), OWNER), null);
});

test('Characters tab excludes non local-agent refs', () => {
  assert.equal(toLocalAgentListItem(makeAgentRecord({ localAgentRef: 'agent-42' }), OWNER), null);
});

test('Characters tab fails closed on incomplete materialization metadata', () => {
  const missingHash = makeAgentRecord({
    metadata: toNimiRuntimeProtoStruct({
      sourceMaterialization: {
        sourceKind: 'worldCharacter',
        sourceWorldId: 'world-1',
        sourceId: 'char-1',
      },
    }),
  });
  assert.equal(toLocalAgentListItem(missingHash, OWNER), null);

  const noMaterialization = makeAgentRecord({ metadata: toNimiRuntimeProtoStruct({}) });
  assert.equal(toLocalAgentListItem(noMaterialization, OWNER), null);
});

test('Characters tab requires runtimeSourceRef on the record', () => {
  assert.equal(toLocalAgentListItem(makeAgentRecord({ runtimeSourceRef: '' }), OWNER), null);
});

test('Characters tab falls back to sourceId when displayName is blank', () => {
  const item = toLocalAgentListItem(makeAgentRecord({ displayName: '  ' }), OWNER);
  assert.ok(item);
  assert.equal(item.displayName, 'char-1');
});
