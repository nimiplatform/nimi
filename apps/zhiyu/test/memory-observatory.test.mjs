import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/agent/memory-observatory.ts');
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
    localAgentRef: 'runtime-local-agent:opaque',
  };
}

function localAgentUnavailable() {
  return {
    ...localAgentReady(),
    ready: false,
    reasonCode: 'zhiyu-runtime-source-required',
    actionHint: 'provide_admitted_runtime_source_projection',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  };
}

function observatorySnapshot() {
  return {
    schemaVersion: 1,
    sourceSchemaVersion: 1,
    observedAt: '2026-07-01T00:00:00.000Z',
    agentId: 'runtime-local-agent:opaque',
    state: 'ready',
    reasonCode: 'runtime-agent-memory-observatory-ready',
    actionHint: 'inspect_runtime_agent_memory_lineage',
    recordCount: 1,
    bankCount: 1,
    banks: [{
      bankKey: 'agent-core:runtime-local-agent:opaque',
      scope: 'agent-core',
      agentId: 'runtime-local-agent:opaque',
      userId: null,
      worldId: null,
      accountId: null,
      appId: null,
      workspaceId: null,
      recordCount: 1,
    }],
    bankReviewStatuses: [{
      bankKey: 'agent-core:runtime-local-agent:opaque',
      readiness: 'waiting_for_window',
      eligibleNow: false,
      reviewExecutorAvailable: true,
      lastReviewRunId: 'review-run-1',
      checkpointBasis: 'memory-checkpoint-1',
      lastCompletedAt: '2026-06-30T02:00:00.000Z',
      nextEligibleAt: '2026-07-01T02:00:00.000Z',
      recoverableReviewRunId: null,
      source: 'runtime-agent-review-status',
    }],
    unsupportedLifecycleFields: ['review', 'redaction', 'forgetIntent'],
    records: [{
      memoryId: 'memory-1',
      bankKey: 'agent-core:runtime-local-agent:opaque',
      authorityClass: 'canonical-agent-memory',
      canonicalClass: 'public-shared',
      kind: 'semantic',
      payloadKind: 'semantic',
      summary: 'User prefers precise diagnostics.',
      timelineAt: '2026-06-30T00:00:00.000Z',
      lineage: {
        sourceSystem: 'runtime.agent',
        sourceEventId: 'event-1',
        traceId: 'trace-1',
        committedAt: '2026-06-30T00:00:00.000Z',
      },
      confidence: {
        state: 'available',
        value: 0.91,
        source: 'semantic_payload',
      },
      review: {
        state: 'not_projected',
        reasonCode: 'runtime-agent-memory-lifecycle-projection-not-admitted',
      },
      redaction: {
        state: 'not_projected',
        reasonCode: 'runtime-agent-memory-lifecycle-projection-not-admitted',
      },
      forgetIntent: {
        state: 'not_projected',
        reasonCode: 'runtime-agent-memory-lifecycle-projection-not-admitted',
      },
      replicationOutcome: 'synced',
      policyReason: 'query_agent_memory_history',
      recallScore: 0.4,
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T01:00:00.000Z',
    }],
  };
}

test('projects SDK Memory Observatory snapshot into Zhiyu evidence', async () => {
  const { probeZhiyuRuntimeMemoryObservatory } = await loadModule();
  const readCalls = [];
  const memory = await probeZhiyuRuntimeMemoryObservatory(localAgentReady(), {
    exportedAt: '2026-07-01T00:00:00.000Z',
    maxRecords: 25,
    readMemoryObservatory: async (input) => {
      readCalls.push(input);
      return observatorySnapshot();
    },
  });

  assert.deepEqual(readCalls, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'runtime-local-agent:opaque',
    exportedAt: '2026-07-01T00:00:00.000Z',
    maxRecords: 25,
  }]);
  assert.equal(memory.ready, true);
  assert.equal(memory.state, 'ready');
  assert.equal(memory.reasonCode, 'runtime-agent-memory-observatory-ready');
  assert.equal(memory.actionHint, 'inspect_runtime_agent_memory_lineage');
  assert.equal(memory.recordCount, 1);
  assert.equal(memory.bankCount, 1);
  assert.equal(memory.bankReviewStatuses[0]?.bankKey, 'agent-core:runtime-local-agent:opaque');
  assert.equal(memory.bankReviewStatuses[0]?.readiness, 'waiting_for_window');
  assert.equal(memory.bankReviewStatuses[0]?.eligibleNow, false);
  assert.equal(memory.bankReviewStatuses[0]?.reviewExecutorAvailable, true);
  assert.equal(memory.bankReviewStatuses[0]?.lastReviewRunId, 'review-run-1');
  assert.equal(memory.bankReviewStatuses[0]?.checkpointBasis, 'memory-checkpoint-1');
  assert.equal(memory.records[0]?.authorityClass, 'canonical-agent-memory');
  assert.equal(memory.records[0]?.lineage.sourceEventId, 'event-1');
  assert.equal(memory.records[0]?.confidence.state, 'available');
  assert.equal(memory.records[0]?.reviewState, 'not_projected');
  assert.equal(memory.records[0]?.redactionState, 'not_projected');
  assert.equal(memory.records[0]?.forgetIntentState, 'not_projected');
  assert.deepEqual(memory.unsupportedLifecycleFields, ['review', 'redaction', 'forgetIntent']);
});

test('projects empty Memory Observatory snapshot without inventing records', async () => {
  const { probeZhiyuRuntimeMemoryObservatory } = await loadModule();
  const memory = await probeZhiyuRuntimeMemoryObservatory(localAgentReady(), {
    exportedAt: '2026-07-01T00:00:00.000Z',
    readMemoryObservatory: async () => ({
      ...observatorySnapshot(),
      state: 'empty',
      reasonCode: 'runtime-agent-memory-observatory-empty',
      actionHint: 'continue_runtime_agent_interaction',
      recordCount: 0,
      bankCount: 0,
      banks: [],
      bankReviewStatuses: [],
      records: [],
    }),
  });

  assert.equal(memory.ready, true);
  assert.equal(memory.state, 'empty');
  assert.equal(memory.reasonCode, 'runtime-agent-memory-observatory-empty');
  assert.equal(memory.recordCount, 0);
  assert.equal(memory.bankCount, 0);
  assert.deepEqual(memory.records, []);
});

test('fails closed before Memory Observatory read when LocalAgent is unavailable', async () => {
  const { probeZhiyuRuntimeMemoryObservatory } = await loadModule();
  let called = false;
  const memory = await probeZhiyuRuntimeMemoryObservatory(localAgentUnavailable(), {
    readMemoryObservatory: async () => {
      called = true;
      throw new Error('not expected');
    },
  });

  assert.equal(called, false);
  assert.equal(memory.ready, false);
  assert.equal(memory.state, 'blocked');
  assert.equal(memory.reasonCode, 'zhiyu-local-agent-required');
  assert.equal(memory.actionHint, 'select_runtime_owned_partner');
  assert.equal(memory.recordCount, 0);
  assert.deepEqual(memory.records, []);
});

test('normalizes SDK Memory Observatory failures without pseudo-success', async () => {
  const { probeZhiyuRuntimeMemoryObservatory } = await loadModule();
  const error = Object.assign(new Error('Runtime Agent memory export failed.'), {
    reasonCode: 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_READ_FAILED',
    actionHint: 'check_runtime_agent_memory_status',
    source: 'sdk',
  });
  const memory = await probeZhiyuRuntimeMemoryObservatory(localAgentReady(), {
    readMemoryObservatory: async () => {
      throw error;
    },
  });

  assert.equal(memory.ready, false);
  assert.equal(memory.state, 'blocked');
  assert.equal(memory.reasonCode, 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_READ_FAILED');
  assert.equal(memory.actionHint, 'check_runtime_agent_memory_status');
  assert.equal(memory.source, 'sdk');
  assert.equal(memory.ownerUserId, 'user-1');
  assert.equal(memory.localAgentRef, 'runtime-local-agent:opaque');
});

test('classifies Memory Observatory blocked states without pseudo records', async () => {
  const { probeZhiyuRuntimeMemoryObservatory } = await loadModule();
  const cases = [
    {
      name: 'denied',
      reasonCode: 'runtime-agent-memory-access-denied',
      actionHint: 'request_runtime_memory_access',
      source: 'runtime',
      expectedState: 'denied',
    },
    {
      name: 'missing grant',
      reasonCode: 'apmem_no_active_grant',
      actionHint: 'request_runtime_memory_grant',
      source: 'runtime',
      expectedState: 'grant-missing',
    },
    {
      name: 'runtime unavailable',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      actionHint: 'start_external_runtime_daemon',
      source: 'electron',
      expectedState: 'runtime-unavailable',
    },
    {
      name: 'no provider',
      reasonCode: 'runtime-memory-provider-unavailable',
      actionHint: 'install_or_attach_memory_provider',
      source: 'runtime',
      expectedState: 'no-provider',
    },
    {
      name: 'partial',
      reasonCode: 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_MAX_RECORDS_EXCEEDED',
      actionHint: 'raise_export_max_records',
      source: 'sdk',
      expectedState: 'partial',
    },
  ];

  for (const item of cases) {
    const error = Object.assign(new Error(`Memory Observatory ${item.name}`), {
      reasonCode: item.reasonCode,
      actionHint: item.actionHint,
      source: item.source,
    });
    const memory = await probeZhiyuRuntimeMemoryObservatory(localAgentReady(), {
      readMemoryObservatory: async () => {
        throw error;
      },
    });

    assert.equal(memory.ready, false, item.name);
    assert.equal(memory.state, item.expectedState, item.name);
    assert.equal(memory.reasonCode, item.reasonCode, item.name);
    assert.equal(memory.actionHint, item.actionHint, item.name);
    assert.equal(memory.recordCount, 0, item.name);
    assert.deepEqual(memory.records, [], item.name);
  }
});

test('memory observatory keeps explainability in evidence without a retired graph-lite UI section', () => {
  const source = [
    readFileSync(path.join(root, 'src/shell/app/App.tsx'), 'utf8'),
    readFileSync(path.join(root, 'src/shell/app/evidence.ts'), 'utf8'),
    readFileSync(path.join(root, 'src/shell/agent/memory-observatory.ts'), 'utf8'),
  ].join('\n');

  assert.match(source, /probeZhiyuRuntimeMemoryObservatory/);
  assert.match(source, /timelineAt/);
  assert.match(source, /lineage/);
  assert.match(source, /confidence/);
  assert.match(source, /reviewState/);
  assert.match(source, /redactionState/);
  assert.match(source, /forgetIntentState/);
  assert.match(source, /unsupportedLifecycleFields/);
  assert.doesNotMatch(source, /data-zhiyu-memory-record-|data-zhiyu-memory-graph-state/);
  assert.doesNotMatch(source, /runtime-agent-memory-graph-relations-not-admitted/);
  assert.doesNotMatch(source, /writeMemory|DeleteMemory|RetainRequest|queryMemory/);
});

test('memory observatory probe does not own provider, Desktop, source, or memory mutation truth', () => {
  const source = readFileSync(path.join(root, 'src/shell/agent/memory-observatory.ts'), 'utf8');
  assert.doesNotMatch(source, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(source, /SourceMaterializationPacket|nimi-guide-archivist|local-agent\.identity/);
  assert.doesNotMatch(source, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
});
