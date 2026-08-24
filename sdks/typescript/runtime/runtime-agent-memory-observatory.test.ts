import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeAgentMemoryObservatory,
  NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION,
  NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_SCHEMA_VERSION,
  projectNimiRuntimeAgentMemoryObservatory,
  toNimiRuntimeTimestamp,
  type NimiHostRuntimeAgentMemoryObservatoryClient,
  type NimiRuntimeAgentMemoryExportEnvelope,
} from './index';
import {
  AgentCanonicalMemoryReviewReadiness,
  AgentExecutionState,
  MemoryBankScope,
  MemoryCanonicalClass,
  MemoryRecordKind,
  type CanonicalMemoryView,
  type GetAgentCanonicalMemoryReviewStatusRequest,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';

const OWNER_USER_ID = 'user-1';
const RUNTIME_SOURCE_REF = 'runtime-source:one';
const AGENT_REF = 'local-agent:one';

const envelope: NimiRuntimeAgentMemoryExportEnvelope = {
  schemaVersion: NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION,
  exportedAt: '2026-07-01T00:00:00.000Z',
  agentId: 'local-agent:one',
  banks: [{
    bankKey: 'agent-core:local-agent:one',
    scope: 'agent-core',
    agentId: 'local-agent:one',
    userId: null,
    worldId: null,
    accountId: null,
    appId: null,
    workspaceId: null,
    recordCount: 1,
  }],
  records: [{
    memoryId: 'memory-1',
    bankKey: 'agent-core:local-agent:one',
    canonicalClass: 'public-shared',
    kind: 'semantic',
    summary: 'Nimi likes concise diagnostics.',
    payload: {
      kind: 'semantic',
      subject: 'Nimi',
      predicate: 'likes',
      object: 'concise diagnostics',
      confidence: 0.82,
    },
    provenance: {
      sourceSystem: 'runtime.agent',
      sourceEventId: 'event-1',
      authorId: 'local-agent:one',
      traceId: 'trace-1',
      committedAt: '2026-06-30T00:00:00.000Z',
    },
    replicationOutcome: 'synced',
    metadata: null,
    extensions: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T01:00:00.000Z',
    policyReason: 'query_agent_memory_history',
    recallScore: 0.5,
  }],
};

test('projects canonical memory export into a ready observatory snapshot', () => {
  const snapshot = projectNimiRuntimeAgentMemoryObservatory(envelope);

  assert.equal(snapshot.schemaVersion, NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_SCHEMA_VERSION);
  assert.equal(snapshot.sourceSchemaVersion, NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION);
  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.reasonCode, 'runtime-agent-memory-observatory-ready');
  assert.equal(snapshot.actionHint, 'inspect_runtime_agent_memory_lineage');
  assert.equal(snapshot.recordCount, 1);
  assert.equal(snapshot.bankCount, 1);
  assert.deepEqual(snapshot.bankReviewStatuses, []);
  assert.equal(snapshot.records[0]?.memoryId, 'memory-1');
  assert.equal(snapshot.records[0]?.authorityClass, 'canonical-agent-memory');
  assert.equal(snapshot.records[0]?.timelineAt, '2026-06-30T00:00:00.000Z');
  assert.deepEqual(snapshot.records[0]?.lineage, {
    sourceSystem: 'runtime.agent',
    sourceEventId: 'event-1',
    traceId: 'trace-1',
    committedAt: '2026-06-30T00:00:00.000Z',
  });
  assert.deepEqual(snapshot.records[0]?.confidence, {
    state: 'available',
    value: 0.82,
    source: 'semantic_payload',
  });
  assert.equal(snapshot.records[0]?.review.state, 'not_projected');
  assert.equal(snapshot.records[0]?.redaction.state, 'not_projected');
  assert.equal(snapshot.records[0]?.forgetIntent.state, 'not_projected');
  assert.deepEqual(snapshot.unsupportedLifecycleFields, ['review', 'redaction', 'forgetIntent']);
});

test('projects empty export as a valid empty observatory snapshot', () => {
  const snapshot = projectNimiRuntimeAgentMemoryObservatory({
    ...envelope,
    banks: [],
    records: [],
  });

  assert.equal(snapshot.state, 'empty');
  assert.equal(snapshot.reasonCode, 'runtime-agent-memory-observatory-empty');
  assert.equal(snapshot.actionHint, 'continue_runtime_agent_interaction');
  assert.equal(snapshot.recordCount, 0);
  assert.deepEqual(snapshot.records, []);
});

test('reads Runtime bank-level review status without projecting per-record review truth', async () => {
  const reviewCalls: GetAgentCanonicalMemoryReviewStatusRequest[] = [];
  const bank = {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore' as const,
      agentCore: { agentId: AGENT_REF },
    },
  };
  const view: CanonicalMemoryView = {
    canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
    sourceBank: bank,
    recallScore: 0.4,
    policyReason: 'query_agent_memory_history',
    record: {
      memoryId: 'memory-review-1',
      bank,
      kind: MemoryRecordKind.SEMANTIC,
      canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
      provenance: {
        sourceSystem: 'runtime.agent',
        sourceEventId: 'event-review-1',
        authorId: AGENT_REF,
        traceId: 'trace-review-1',
        committedAt: toNimiRuntimeTimestamp('2026-06-30T00:00:00.000Z'),
      },
      payload: {
        oneofKind: 'semantic',
        semantic: {
          subject: 'Nimi',
          predicate: 'tracks',
          object: 'review readiness',
          confidence: 0.9,
        },
      },
      createdAt: toNimiRuntimeTimestamp('2026-06-30T00:00:00.000Z'),
      updatedAt: toNimiRuntimeTimestamp('2026-06-30T01:00:00.000Z'),
    },
  };
  const client: NimiHostRuntimeAgentMemoryObservatoryClient = {
    appId: 'sdk.test',
    auth: {},
    agent: {
      async getAgentState() {
        return {
          state: {
            executionState: AgentExecutionState.IDLE,
            statusText: 'ready',
            activeWorldId: '',
            activeUserId: '',
            currentEmotion: 'calm',
            attributes: {},
          },
        };
      },
      async queryAgentMemory() {
        return { memories: [view], narratives: [] };
      },
      async getAgentCanonicalMemoryReviewStatus(request: GetAgentCanonicalMemoryReviewStatusRequest) {
        reviewCalls.push(request);
        return {
          status: {
            bank: request.bank,
            readiness: AgentCanonicalMemoryReviewReadiness.WAITING_FOR_WINDOW,
            eligibleNow: false,
            reviewExecutorAvailable: true,
            lastReviewRunId: 'review-run-1',
            checkpointBasis: 'memory-checkpoint-1',
            lastCompletedAt: toNimiRuntimeTimestamp('2026-06-30T02:00:00.000Z'),
            nextEligibleAt: toNimiRuntimeTimestamp('2026-07-01T02:00:00.000Z'),
            recoverableReviewRunId: '',
          },
        };
      },
    },
  };
  const passthroughScopes = async <T>(
    _scopes: readonly string[],
    operation: (options: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> => operation({});

  const snapshot = await createNimiRuntimeAgentMemoryObservatory(client, {
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: AGENT_REF,
    exportedAt: '2026-07-01T00:00:00.000Z',
    maxRecords: 5,
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: passthroughScopes,
  });

  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0]?.agentId, AGENT_REF);
  assert.equal(reviewCalls[0]?.context?.localAgentRef, AGENT_REF);
  assert.deepEqual(reviewCalls[0]?.bank, bank);
  assert.equal(snapshot.bankReviewStatuses[0]?.bankKey, `agent-core:${AGENT_REF}`);
  assert.equal(snapshot.bankReviewStatuses[0]?.readiness, 'waiting_for_window');
  assert.equal(snapshot.bankReviewStatuses[0]?.eligibleNow, false);
  assert.equal(snapshot.bankReviewStatuses[0]?.reviewExecutorAvailable, true);
  assert.equal(snapshot.bankReviewStatuses[0]?.lastReviewRunId, 'review-run-1');
  assert.equal(snapshot.bankReviewStatuses[0]?.checkpointBasis, 'memory-checkpoint-1');
  assert.equal(snapshot.bankReviewStatuses[0]?.lastCompletedAt, '2026-06-30T02:00:00.000Z');
  assert.equal(snapshot.bankReviewStatuses[0]?.nextEligibleAt, '2026-07-01T02:00:00.000Z');
  assert.equal(snapshot.records[0]?.review.state, 'not_projected');
  assert.deepEqual(snapshot.unsupportedLifecycleFields, ['review', 'redaction', 'forgetIntent']);
});

test('fails closed when Runtime bank-level review status points at a different bank', async () => {
  const bank = {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore' as const,
      agentCore: { agentId: AGENT_REF },
    },
  };
  const view: CanonicalMemoryView = {
    canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
    sourceBank: bank,
    recallScore: 0.4,
    policyReason: 'query_agent_memory_history',
    record: {
      memoryId: 'memory-review-mismatch',
      bank,
      kind: MemoryRecordKind.SEMANTIC,
      canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
      provenance: {
        sourceSystem: 'runtime.agent',
        sourceEventId: 'event-review-mismatch',
        authorId: AGENT_REF,
        traceId: 'trace-review-mismatch',
        committedAt: toNimiRuntimeTimestamp('2026-06-30T00:00:00.000Z'),
      },
      payload: {
        oneofKind: 'semantic',
        semantic: {
          subject: 'Nimi',
          predicate: 'rejects',
          object: 'mismatched review status bank',
          confidence: 0.9,
        },
      },
      createdAt: toNimiRuntimeTimestamp('2026-06-30T00:00:00.000Z'),
      updatedAt: toNimiRuntimeTimestamp('2026-06-30T01:00:00.000Z'),
    },
  };
  const client: NimiHostRuntimeAgentMemoryObservatoryClient = {
    appId: 'sdk.test',
    auth: {},
    agent: {
      async getAgentState() {
        return {
          state: {
            executionState: AgentExecutionState.IDLE,
            statusText: 'ready',
            activeWorldId: '',
            activeUserId: '',
            currentEmotion: 'calm',
            attributes: {},
          },
        };
      },
      async queryAgentMemory() {
        return { memories: [view], narratives: [] };
      },
      async getAgentCanonicalMemoryReviewStatus(request: GetAgentCanonicalMemoryReviewStatusRequest) {
        return {
          status: {
            bank: {
              scope: MemoryBankScope.AGENT_CORE,
              owner: {
                oneofKind: 'agentCore',
                agentCore: { agentId: 'local-agent:other' },
              },
            },
            readiness: AgentCanonicalMemoryReviewReadiness.ELIGIBLE,
            eligibleNow: true,
            reviewExecutorAvailable: true,
            lastReviewRunId: '',
            checkpointBasis: '',
            recoverableReviewRunId: '',
          },
        };
      },
    },
  };
  const passthroughScopes = async <T>(
    _scopes: readonly string[],
    operation: (options: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> => operation({});

  await assert.rejects(
    () => createNimiRuntimeAgentMemoryObservatory(client, {
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      localAgentRef: AGENT_REF,
      exportedAt: '2026-07-01T00:00:00.000Z',
      maxRecords: 5,
      getSubjectUserId: () => OWNER_USER_ID,
      withScopes: passthroughScopes,
    }),
    /review status bank does not match/,
  );
});
