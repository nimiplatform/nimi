import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryBankScope,
  RuntimeReasonCode,
  buildMemoryEmbeddingAgentCoreLocator,
  buildMemoryEmbeddingBindingIntentSnapshot,
  createEmptyMemoryEmbeddingConfig,
  memoryEmbeddingProfileIdentity,
  normalizeMemoryEmbeddingBindOutcome,
  normalizeMemoryEmbeddingCanonicalBankStatus,
  normalizeMemoryEmbeddingCutoverOutcome,
  normalizeMemoryEmbeddingResolutionState,
  normalizeMemoryEmbeddingSourceKind,
  projectMemoryEmbeddingBindResult,
  projectMemoryEmbeddingCutoverResult,
  projectMemoryEmbeddingRuntimeState,
  projectUnavailableMemoryEmbeddingRuntimeState,
} from '../../src/runtime/index.js';

const scopeRef = {
  kind: 'feature',
  ownerId: 'tester',
  surfaceId: 'memory',
};

test('memory embedding runtime helpers project binding intent and agent core locator', () => {
  const cloudConfig = {
    ...createEmptyMemoryEmbeddingConfig(scopeRef),
    sourceKind: 'cloud' as const,
    bindingRef: {
      kind: 'cloud' as const,
      connectorId: 'cloud-connector',
      modelId: 'embedding-model',
    },
    revisionToken: 'rev-cloud',
  };
  const localConfig = {
    ...createEmptyMemoryEmbeddingConfig(scopeRef),
    sourceKind: 'local' as const,
    bindingRef: {
      kind: 'local' as const,
      targetId: 'local-embedding',
    },
    revisionToken: 'rev-local',
  };

  assert.deepEqual(buildMemoryEmbeddingBindingIntentSnapshot(cloudConfig), {
    sourceKind: 'cloud',
    cloudBinding: {
      connectorId: 'cloud-connector',
      modelId: 'embedding-model',
    },
    revisionToken: 'rev-cloud',
  });
  assert.deepEqual(buildMemoryEmbeddingBindingIntentSnapshot(localConfig), {
    sourceKind: 'local',
    localBinding: {
      targetId: 'local-embedding',
    },
    revisionToken: 'rev-local',
  });
  assert.equal(buildMemoryEmbeddingBindingIntentSnapshot(createEmptyMemoryEmbeddingConfig(scopeRef)), undefined);
  assert.deepEqual(buildMemoryEmbeddingAgentCoreLocator({ kind: 'agent-core', agentId: ' agent-1 ' }), {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore',
      agentCore: {
        agentId: 'agent-1',
      },
    },
  });
});

test('memory embedding runtime helpers normalize Runtime response fields fail-closed', () => {
  assert.equal(normalizeMemoryEmbeddingResolutionState('resolved'), 'resolved');
  assert.equal(normalizeMemoryEmbeddingResolutionState('other'), 'unavailable');
  assert.equal(normalizeMemoryEmbeddingSourceKind('cloud'), 'cloud');
  assert.equal(normalizeMemoryEmbeddingSourceKind('sidecar'), null);
  assert.equal(normalizeMemoryEmbeddingCanonicalBankStatus('cutover_ready'), 'cutover_ready');
  assert.equal(normalizeMemoryEmbeddingCanonicalBankStatus('readyish'), 'unbound');
  assert.equal(normalizeMemoryEmbeddingBindOutcome('staged_rebuild'), 'staged_rebuild');
  assert.equal(normalizeMemoryEmbeddingBindOutcome('blocked'), 'rejected');
  assert.equal(normalizeMemoryEmbeddingCutoverOutcome('already_current'), 'already_current');
  assert.equal(normalizeMemoryEmbeddingCutoverOutcome('blocked'), 'rejected');
  assert.equal(memoryEmbeddingProfileIdentity({
    provider: 'tester',
    modelId: 'embedding-model',
    version: 'v1',
    dimension: 768,
    distanceMetric: 1,
    migrationPolicy: 1,
  }), 'tester:embedding-model:v1');
  assert.equal(memoryEmbeddingProfileIdentity(undefined), null);
});

test('memory embedding runtime helpers project Runtime inspect, bind, and cutover responses', () => {
  const state = projectMemoryEmbeddingRuntimeState({
    bindingIntentPresent: true,
    bindingSourceKind: 'cloud',
    resolutionState: 'resolved',
    resolvedProfile: {
      provider: 'tester',
      modelId: 'embedding-model',
      version: 'v1',
      dimension: 768,
      distanceMetric: 1,
      migrationPolicy: 1,
    },
    canonicalBankStatus: 'bound_profile_mismatch',
    blockedReasonCode: RuntimeReasonCode.AI_PROVIDER_TIMEOUT,
    operationReadiness: {
      bindAllowed: true,
      cutoverAllowed: false,
    },
  });
  assert.deepEqual(state, {
    bindingIntentPresent: true,
    bindingSourceKind: 'cloud',
    resolutionState: 'resolved',
    resolvedProfileIdentity: 'tester:embedding-model:v1',
    canonicalBankStatus: 'bound_profile_mismatch',
    blockedReasonCode: 'AI_PROVIDER_TIMEOUT',
    operationReadiness: {
      bindAllowed: true,
      cutoverAllowed: false,
    },
  });
  assert.deepEqual(projectMemoryEmbeddingBindResult({
    outcome: 'staged_rebuild',
    blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    canonicalBankStatusAfter: 'rebuild_pending',
    pendingCutover: true,
  }), {
    outcome: 'staged_rebuild',
    blockedReasonCode: null,
    canonicalBankStatusAfter: 'rebuild_pending',
    pendingCutover: true,
  });
  assert.deepEqual(projectMemoryEmbeddingCutoverResult({
    outcome: 'cutover_committed',
    blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    canonicalBankStatusAfter: 'bound_equivalent',
  }), {
    outcome: 'cutover_committed',
    blockedReasonCode: null,
    canonicalBankStatusAfter: 'bound_equivalent',
  });
});

test('memory embedding runtime unavailable projection preserves host binding intent without owning runtime truth', () => {
  assert.deepEqual(projectUnavailableMemoryEmbeddingRuntimeState({
    config: createEmptyMemoryEmbeddingConfig(scopeRef),
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
  }), {
    bindingIntentPresent: false,
    bindingSourceKind: null,
    resolutionState: 'missing',
    resolvedProfileIdentity: null,
    canonicalBankStatus: 'unbound',
    blockedReasonCode: null,
    operationReadiness: {
      bindAllowed: false,
      cutoverAllowed: false,
    },
  });

  assert.deepEqual(projectUnavailableMemoryEmbeddingRuntimeState({
    config: {
      ...createEmptyMemoryEmbeddingConfig(scopeRef),
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'cloud',
        connectorId: 'cloud-connector',
        modelId: 'embedding-model',
      },
    },
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
  }), {
    bindingIntentPresent: true,
    bindingSourceKind: 'cloud',
    resolutionState: 'unavailable',
    resolvedProfileIdentity: null,
    canonicalBankStatus: 'unbound',
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
    operationReadiness: {
      bindAllowed: false,
      cutoverAllowed: false,
    },
  });
});
