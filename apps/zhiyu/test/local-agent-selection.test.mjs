import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

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

function unavailableLocalAgent(reasonCode = 'zhiyu-runtime-source-required') {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode,
    actionHint: 'provide_admitted_runtime_source_projection',
    source: 'renderer',
    message: 'Zhiyu requires an admitted Runtime source projection before LocalAgent discovery.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  };
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
    sourceId: null,
    sourceContentHash: null,
    ...overrides,
  };
}

test('does not promote bare Runtime inventory into the current partner without Realm materialization source', async () => {
  const { resolveZhiyuRuntimeLocalAgentSelection } = await loadSelectionModule();

  const selected = resolveZhiyuRuntimeLocalAgentSelection({
    sourceLocalAgent: unavailableLocalAgent(),
    inventory: inventory([inventoryAgent()]),
  });

  assert.equal(selected.ready, false);
  assert.equal(selected.reasonCode, 'zhiyu-realm-materialized-partner-required');
  assert.equal(selected.source, 'runtime');
  assert.equal(selected.ownerUserId, 'user-1');
  assert.equal(selected.runtimeSourceRef, null);
  assert.equal(selected.localAgentRef, null);
  assert.equal(selected.actionHint, 'open_desktop_explore_character_persona');
  assert.doesNotMatch(selected.actionHint, /materialize|create|select_or_create/);
  assert.match(selected.message, /Runtime-owned partner/);
  assert.match(selected.message, /Desktop Explore/);
});

test('keeps explicit Runtime source discovery result when it is already ready', async () => {
  const { resolveZhiyuRuntimeLocalAgentSelection } = await loadSelectionModule();
  const sourceLocalAgent = {
    ...unavailableLocalAgent('local-agent-discovered'),
    ready: true,
    source: 'runtime',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'opaque-source-ref-2',
    localAgentRef: 'runtime-local-agent:opaque-2',
  };

  const selected = resolveZhiyuRuntimeLocalAgentSelection({
    sourceLocalAgent,
    inventory: inventory([inventoryAgent()]),
  });

  assert.equal(selected.localAgentRef, 'runtime-local-agent:opaque-2');
  assert.equal(selected.reasonCode, 'local-agent-discovered');
});

test('fails closed when Runtime inventory is empty or ambiguous', async () => {
  const { resolveZhiyuRuntimeLocalAgentSelection } = await loadSelectionModule();

  const empty = resolveZhiyuRuntimeLocalAgentSelection({
    sourceLocalAgent: unavailableLocalAgent(),
    inventory: inventory([]),
  });
  assert.equal(empty.ready, false);
  assert.equal(empty.reasonCode, 'zhiyu-runtime-local-agent-inventory-empty');
  assert.equal(empty.actionHint, 'open_desktop_explore_character_persona');
  assert.doesNotMatch(empty.actionHint, /materialize|create|select_or_create/);
  assert.match(empty.message, /Desktop Explore/);

  const ambiguous = resolveZhiyuRuntimeLocalAgentSelection({
    sourceLocalAgent: unavailableLocalAgent(),
    inventory: inventory([
      inventoryAgent({ localAgentRef: 'runtime-local-agent:opaque-1' }),
      inventoryAgent({ localAgentRef: 'runtime-local-agent:opaque-2' }),
    ]),
  });
  assert.equal(ambiguous.ready, false);
  assert.equal(ambiguous.reasonCode, 'zhiyu-runtime-local-agent-selection-required');
});
