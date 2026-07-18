import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiRuntimeAgentSourceContextStatus } from '@nimiplatform/sdk/runtime';
import { toLocalAgentListItem } from '../src/shell/renderer/features/agents/local-agent-list-model.js';

const OWNER = 'user-1';
const READY_SOURCE_STATUS: NimiRuntimeAgentSourceContextStatus = {
  schemaVersion: 'v2',
  ready: true,
  state: 'ready',
  reasonCode: 'none',
  localAgentRef: 'local-agent:01ABC',
  sourceRef: {
    kind: 'worldCharacter',
    id: 'char-1',
    worldId: 'world-1',
    worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' },
    sourceHash: 'a'.repeat(64),
  },
  sourceSchemaVersion: 'realm.world-character-core/v1',
  snapshotSchemaVersion: 'v2',
  snapshotHash: 'a'.repeat(64),
  capturedAt: '2026-07-11T00:00:00.000Z',
  worldContentHash: 'b'.repeat(64),
  materializationContextHash: 'c'.repeat(64),
  coverageSections: [],
};

function makeAgentRecord(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Kaelis',
    localAgentRef: 'local-agent:01ABC',
    ownerUserId: OWNER,
    runtimeSourceRef: 'runtime-source:xyz',
    sourceContextStatus: READY_SOURCE_STATUS,
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
    id: 'char-1',
    worldId: 'world-1',
    worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' },
    sourceHash: 'a'.repeat(64),
  });
});

test('Characters tab excludes agents owned by another account', () => {
  assert.equal(toLocalAgentListItem(makeAgentRecord({ ownerUserId: 'someone-else' }), OWNER), null);
});

test('Characters tab excludes non local-agent refs', () => {
  assert.equal(toLocalAgentListItem(makeAgentRecord({ localAgentRef: 'agent-42' }), OWNER), null);
});

test('Characters tab fails closed on incomplete bounded source status', () => {
  const missingHash = makeAgentRecord({
    sourceContextStatus: { ready: false, state: 'invalid', reasonCode: 'source_snapshot_invalid' },
  });
  assert.equal(toLocalAgentListItem(missingHash, OWNER), null);

  const noMaterialization = makeAgentRecord({ sourceContextStatus: null });
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
