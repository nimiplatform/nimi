import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSync, transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadSelectionModule() {
  const sourcePath = path.join(root, 'src/shell/agent/local-agent-selection.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

async function loadSourceProjectionModule() {
  const output = buildSync({
    entryPoints: [path.join(root, 'src/shell/agent/source-projection.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
  }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function inventory(localAgents) {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-local-agent-inventory-ready',
    actionHint: 'select_runtime_local_agent',
    source: 'runtime',
    message: 'Runtime LocalAgent inventory was listed through SDK.',
    ownerUserId: 'user-1',
    count: localAgents.length,
    localAgents,
  };
}

function inventoryAgent(overrides = {}) {
  return {
    localAgentRef: 'runtime-local-agent:opaque-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'opaque-source-ref-1',
    displayName: 'Runtime LocalAgent',
    sourceKind: null,
    sourceWorldId: null,
    sourceWorldName: null,
    sourceId: null,
    sourceContentHash: null,
    sourceContextStatus: null,
    ...overrides,
  };
}

test('does not promote bare Runtime inventory without bounded materialization status', async () => {
  const { resolveZhiyuRuntimeLocalAgentSelection } = await loadSelectionModule();

  const selected = resolveZhiyuRuntimeLocalAgentSelection({
    inventory: inventory([inventoryAgent()]),
  });

  assert.equal(selected.ready, false);
  assert.equal(selected.reasonCode, 'zhiyu-runtime-local-agent-source-not-ready');
  assert.equal(selected.source, 'runtime');
  assert.equal(selected.ownerUserId, 'user-1');
  assert.equal(selected.runtimeSourceRef, 'opaque-source-ref-1');
  assert.equal(selected.localAgentRef, null);
  assert.equal(selected.actionHint, 'refresh_runtime_local_agent_inventory');
  assert.match(selected.message, /source snapshot is not ready/);
});

test('auto-selects the only inventory item only when bounded source status is ready', async () => {
  const { resolveZhiyuRuntimeLocalAgentSelection } = await loadSelectionModule();

  const selected = resolveZhiyuRuntimeLocalAgentSelection({
    inventory: inventory([inventoryAgent({
      localAgentRef: 'runtime-local-agent:opaque-2',
      runtimeSourceRef: 'opaque-source-ref-2',
      sourceContextStatus: { ready: true },
    })]),
  });

  assert.equal(selected.localAgentRef, 'runtime-local-agent:opaque-2');
  assert.equal(selected.reasonCode, 'runtime-local-agent-selected');
});

test('promotes an explicitly selected Runtime inventory partner projection without creating identity truth', async () => {
  const { resolveZhiyuRuntimeLocalAgentSelection } = await loadSelectionModule();

  const selected = resolveZhiyuRuntimeLocalAgentSelection({
    inventory: inventory([
      inventoryAgent({
        localAgentRef: 'runtime-local-agent:yan-zhenqing',
        runtimeSourceRef: 'runtime-source:yan-zhenqing',
        displayName: '颜真卿',
        sourceContextStatus: { ready: true },
      }),
      inventoryAgent({
        localAgentRef: 'runtime-local-agent:second',
        runtimeSourceRef: 'runtime-source:second',
        displayName: 'Second Partner',
      }),
    ]),
    selectedLocalAgentRef: 'runtime-local-agent:yan-zhenqing',
  });

  assert.equal(selected.ready, true);
  assert.equal(selected.reasonCode, 'runtime-local-agent-selected');
  assert.equal(selected.source, 'runtime');
  assert.equal(selected.ownerUserId, 'user-1');
  assert.equal(selected.runtimeSourceRef, 'runtime-source:yan-zhenqing');
  assert.equal(selected.localAgentRef, 'runtime-local-agent:yan-zhenqing');
  assert.equal(selected.actionHint, 'open_runtime_agent_home');
  assert.doesNotMatch(selected.message, /create|materialize|profile/i);
});

test('fails closed when Runtime inventory is empty or ambiguous', async () => {
  const { resolveZhiyuRuntimeLocalAgentSelection } = await loadSelectionModule();

  const empty = resolveZhiyuRuntimeLocalAgentSelection({
    inventory: inventory([]),
  });
  assert.equal(empty.ready, false);
  assert.equal(empty.reasonCode, 'zhiyu-runtime-local-agent-inventory-empty');
  assert.equal(empty.actionHint, 'desktop_open_select_partner');
  assert.doesNotMatch(empty.actionHint, /materialize|create|select_or_create/);
  assert.match(empty.message, /Desktop Explore/);

  const ambiguous = resolveZhiyuRuntimeLocalAgentSelection({
    inventory: inventory([
      inventoryAgent({ localAgentRef: 'runtime-local-agent:opaque-1' }),
      inventoryAgent({ localAgentRef: 'runtime-local-agent:opaque-2' }),
    ]),
  });
  assert.equal(ambiguous.ready, false);
  assert.equal(ambiguous.reasonCode, 'zhiyu-runtime-local-agent-selection-required');
});

const boundedLocalAgentRef = 'local-agent:zhiyu-source-context';
const boundedSourceRef = {
  kind: 'worldCharacter',
  worldId: 'world-1',
  sourceId: 'character-1',
  sourceContentHash: 'a'.repeat(64),
};
const boundedCoverage = [
  'identity', 'presentation', 'placement', 'biography', 'psychology', 'knowledge',
  'relationships', 'capabilities', 'interaction_profile', 'assets', 'authoring',
  'world_core', 'bound_entity', 'dependency_closure',
].map((section) => ({ section, state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 }));

function boundedReadySource(overrides = {}) {
  return {
    schemaVersion: 'v1', ready: true, state: 'ready', reasonCode: 'none', localAgentRef: boundedLocalAgentRef,
    sourceRef: boundedSourceRef, sourceSchemaVersion: 'realm.world-character-core/v1', snapshotSchemaVersion: 'v1',
    snapshotHash: 'b'.repeat(64), capturedAt: '2026-07-10T05:00:00.123Z',
    worldContentHash: 'c'.repeat(64), materializationContextHash: 'd'.repeat(64),
    coverageSections: boundedCoverage,
    ...overrides,
  };
}

function boundedTurnSummary(overrides = {}) {
  const laneIds = [
    'runtime_policy', 'output_contract', 'source_identity', 'source_behavior', 'world_context',
    'relationship_context', 'source_knowledge', 'canonical_memory', 'conversation_history',
    'capability_context', 'current_user_turn',
  ];
  return {
    schemaVersion: 'v1', ready: true, state: 'ready', reasonCode: 'none',
    manifestSchemaVersion: 'v1', compilerSchemaVersion: 'v1',
    manifestInstanceHash: '1'.repeat(64), contextContentHash: '2'.repeat(64), promptHash: '3'.repeat(64),
    sourceSnapshotHash: 'b'.repeat(64), sourceRef: boundedSourceRef, worldContentHash: 'c'.repeat(64),
    materializationContextHash: 'd'.repeat(64),
    lanes: laneIds.map((laneId) => ({ laneId, state: 'included', includedItemCount: 1, omittedItemCount: 0, truncatedItemCount: 0, allocatedTokens: '100', usedTokens: '10' })),
    budget: { contextWindowTokens: '4096', reservedOutputTokens: '512', reservedSafetyTokens: '256', reservedAdapterTokens: '256', inputBudgetTokens: '3072', usedTokens: '110' },
    truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
    transcriptTurnCount: 2, memoryItemCount: 1, mediaCount: 0, toolCount: 0,
    routeDigest: '4'.repeat(64), catalogRevisionDigest: '5'.repeat(64),
    localAgentRef: boundedLocalAgentRef, conversationAnchorId: 'anchor-1', turnId: 'turn-1',
    ...overrides,
  };
}

test('projects SDK/Kit bounded ready, truncated, blocked, failed and unknown states', async () => {
  const { projectZhiyuRuntimeSourceProjection } = await loadSourceProjectionModule();
  const base = { ownerUserId: 'user-1', runtimeSourceRef: 'runtime-source:1', localAgentRef: boundedLocalAgentRef };
  const ready = projectZhiyuRuntimeSourceProjection({ ...base, sourceContextStatus: boundedReadySource(), turnContextSummary: boundedTurnSummary() });
  const truncatedSummary = boundedTurnSummary();
  const truncated = projectZhiyuRuntimeSourceProjection({ ...base, sourceContextStatus: boundedReadySource(), turnContextSummary: {
    ...truncatedSummary,
    lanes: truncatedSummary.lanes.map((lane, index) => index === 6 ? { ...lane, state: 'omitted', includedItemCount: 0, omittedItemCount: 1, usedTokens: '0' } : lane),
    truncation: [{ reason: 'optional_content_omitted', omittedItemCount: 1, truncatedItemCount: 0 }],
  } });
  const blocked = projectZhiyuRuntimeSourceProjection({ ...base, sourceContextStatus: { ...boundedReadySource(), ready: false, state: 'validating', reasonCode: 'source_validation_pending', sourceRef: null, sourceSchemaVersion: null, snapshotSchemaVersion: null, snapshotHash: null, capturedAt: null, worldContentHash: null, materializationContextHash: null, coverageSections: [] } });
  const failed = projectZhiyuRuntimeSourceProjection({ ...base, sourceContextStatus: boundedReadySource({ localAgentRef: 'local-agent:forged' }) });
  const unknown = projectZhiyuRuntimeSourceProjection({ ...base, sourceContextStatus: boundedReadySource() });
  assert.deepEqual([ready.projectionState, truncated.projectionState, blocked.projectionState, failed.projectionState, unknown.projectionState], ['ready', 'truncated', 'blocked', 'failed', 'unknown']);
  assert.equal(ready.sourceRef.kind, 'worldCharacter');
  assert.equal(failed.ready, false);
});

test('source/context product path has no renderer fixture projection hook or private truth', () => {
  const combined = [
    readFileSync(path.join(root, 'src/shell/agent/source-projection.ts'), 'utf8'),
    readFileSync(path.join(root, 'src/shell/app/App.tsx'), 'utf8'),
  ].join('\n');
  for (const forbidden of [
    ['acceptance', 'source', 'projection'].join('.'),
    ['realm', 'Profile', 'Context'].join(''),
    ['system', 'Prompt'].join(''),
    ['provider', 'Id'].join(''),
    ['model', 'Id'].join(''),
  ]) {
    assert.equal(combined.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  assert.match(combined, /createNimiRuntimeAgentConsumeClient/);
  assert.match(combined, /anchorSnapshot\.turnContextSummary/);
});
