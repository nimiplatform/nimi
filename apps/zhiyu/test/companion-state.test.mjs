import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/agent/companion-state.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function localAgentReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'local-agent-discovered',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was discovered.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  };
}

function localAgentUnavailable() {
  return {
    ...localAgentReady(),
    ready: false,
    reasonCode: 'zhiyu-runtime-source-required',
    actionHint: 'provide_admitted_runtime_source_projection',
    source: 'renderer',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  };
}

function localAgentNotRuntimeOwned() {
  return {
    ...localAgentReady(),
    source: 'fixture',
  };
}

function runtimeStateSnapshot() {
  return {
    executionState: 'chat-active',
    statusText: '正在整理本轮上下文',
    activeWorldId: 'world-1',
    activeUserId: 'user-1',
    updatedAt: '2026-07-02T00:00:01.000Z',
    currentEmotion: 'focused',
  };
}

test('projects Runtime Agent state into companion state evidence without inventing relationship truth', async () => {
  const { probeZhiyuRuntimeCompanionState } = await loadModule();
  const calls = [];
  const companion = await probeZhiyuRuntimeCompanionState(localAgentReady(), {
    observedAt: '2026-07-02T00:00:00.000Z',
    readAgentState: async (input) => {
      calls.push(input);
      return runtimeStateSnapshot();
    },
  });

  assert.deepEqual(calls, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  }]);
  assert.equal(companion.ready, true);
  assert.equal(companion.state, 'projected');
  assert.equal(companion.reasonCode, 'runtime-agent-state-projected');
  assert.equal(companion.executionState, 'chat-active');
  assert.equal(companion.statusText, '正在整理本轮上下文');
  assert.equal(companion.activeWorldId, 'world-1');
  assert.equal(companion.activeUserId, 'user-1');
  assert.equal(companion.observedAt, '2026-07-02T00:00:00.000Z');
  assert.equal(companion.stateUpdatedAt, '2026-07-02T00:00:01.000Z');
  assert.equal(companion.currentEmotion, 'focused');
  assert.equal(companion.participationMode, 'world');
  assert.equal(companion.participationSource, 'world-1');
  assert.deepEqual(companion.projectedFields, [
    'executionState',
    'statusText',
    'activeWorldId',
    'activeUserId',
    'stateUpdatedAt',
    'currentEmotion',
    'participationMode',
    'participationSource',
  ]);
  assert.deepEqual(companion.unsupportedExplainabilityFields, [
    'posture',
    'postureSource',
    'stateConfidence',
    'whyThisState',
    'relationshipContext',
    'diaryReflection',
    'stateChangeHistory',
  ]);
  assert.equal(companion.proactiveInterruptibility.ready, false);
  assert.equal(companion.proactiveInterruptibility.state, 'blocked');
  assert.equal(companion.proactiveInterruptibility.reasonCode, 'runtime-agent-proactive-interruptibility-not-projected');
});

test('fails closed before companion state read when LocalAgent is unavailable', async () => {
  const { probeZhiyuRuntimeCompanionState } = await loadModule();
  let called = false;
  const companion = await probeZhiyuRuntimeCompanionState(localAgentUnavailable(), {
    readAgentState: async () => {
      called = true;
      throw new Error('not expected');
    },
  });

  assert.equal(called, false);
  assert.equal(companion.ready, false);
  assert.equal(companion.state, 'blocked');
  assert.equal(companion.reasonCode, 'zhiyu-local-agent-required');
  assert.equal(companion.actionHint, 'materialize_runtime_owned_local_agent');
  assert.equal(companion.executionState, null);
  assert.equal(companion.statusText, null);
  assert.equal(companion.proactiveInterruptibility.ready, false);
  assert.equal(companion.proactiveInterruptibility.state, 'blocked');
});

test('fails closed before companion state read when LocalAgent source is not Runtime', async () => {
  const { probeZhiyuRuntimeCompanionState } = await loadModule();
  let called = false;
  const companion = await probeZhiyuRuntimeCompanionState(localAgentNotRuntimeOwned(), {
    readAgentState: async () => {
      called = true;
      throw new Error('not expected');
    },
  });

  assert.equal(called, false);
  assert.equal(companion.ready, false);
  assert.equal(companion.state, 'blocked');
  assert.equal(companion.reasonCode, 'zhiyu-runtime-owned-local-agent-required');
  assert.equal(companion.actionHint, 'materialize_runtime_owned_local_agent');
  assert.equal(companion.stateUpdatedAt, null);
  assert.equal(companion.currentEmotion, null);
  assert.equal(companion.participationMode, 'not_projected');
  assert.equal(companion.proactiveInterruptibility.ready, false);
  assert.equal(companion.proactiveInterruptibility.state, 'blocked');
});

test('fails closed when Runtime Agent state timestamp is missing', async () => {
  const { probeZhiyuRuntimeCompanionState } = await loadModule();
  const companion = await probeZhiyuRuntimeCompanionState(localAgentReady(), {
    readAgentState: async () => ({
      ...runtimeStateSnapshot(),
      updatedAt: null,
    }),
  });

  assert.equal(companion.ready, false);
  assert.equal(companion.state, 'blocked');
  assert.equal(companion.reasonCode, 'runtime-agent-state-timestamp-required');
  assert.equal(companion.actionHint, 'check_runtime_agent_state_projection');
  assert.equal(companion.stateUpdatedAt, null);
  assert.equal(companion.currentEmotion, null);
  assert.deepEqual(companion.projectedFields, []);
});

test('normalizes Runtime Agent state read failures without pseudo companion state', async () => {
  const { probeZhiyuRuntimeCompanionState } = await loadModule();
  const error = Object.assign(new Error('Runtime Agent state read failed.'), {
    reasonCode: 'SDK_RUNTIME_AGENT_STATE_READ_FAILED',
    actionHint: 'check_runtime_agent_state_projection',
    source: 'sdk',
  });
  const companion = await probeZhiyuRuntimeCompanionState(localAgentReady(), {
    readAgentState: async () => {
      throw error;
    },
  });

  assert.equal(companion.ready, false);
  assert.equal(companion.state, 'blocked');
  assert.equal(companion.reasonCode, 'SDK_RUNTIME_AGENT_STATE_READ_FAILED');
  assert.equal(companion.actionHint, 'check_runtime_agent_state_projection');
  assert.equal(companion.source, 'sdk');
  assert.equal(companion.ownerUserId, 'user-1');
  assert.equal(companion.localAgentRef, 'local-agent:opaque');
});

test('companion state probe does not own app-local emotion, provider, Desktop, or memory truth', () => {
  const source = readFileSync(path.join(root, 'src/shell/agent/companion-state.ts'), 'utf8');
  assert.doesNotMatch(source, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(source, /SourceMaterializationPacket|nimi-guide-archivist|local-agent\.identity/);
  assert.doesNotMatch(source, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
  assert.doesNotMatch(source, /relationshipStage|relationshipScore|moodScore|trustScore|affection|intimacy|therapy|proactiveScheduler|diaryWriter/);
});
