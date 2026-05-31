import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeAgentCoreMemoryBankLocator,
  buildRuntimeMemoryRequestContext,
  createNimiError,
  isRuntimeMemoryNotFoundError,
  isRuntimeMemoryUnavailableError,
  MemoryBankScope,
  projectRuntimeAgentCanonicalMemoryBankStatus,
  projectRuntimeLocalAgentIdentityFromRef,
  runtimeMemoryEmbeddingConfigHasBindingIntent,
  type MemoryBank,
} from '../src/runtime/index.js';
import { ReasonCode } from '../src/types/index.js';
import type { MemoryEmbeddingConfig } from '../src/ai/index.js';

const CONFIG: MemoryEmbeddingConfig = {
  scopeRef: { kind: 'feature', ownerId: 'desktop', surfaceId: 'memory-embedding' },
  sourceKind: 'cloud',
  bindingRef: { kind: 'cloud', connectorId: 'conn-1', modelId: 'embed-1' },
  revisionToken: 'rev',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BANK: MemoryBank = {
  bankId: 'bank-agent-1',
  locator: buildRuntimeAgentCoreMemoryBankLocator('local-agent:user-1:agent-1'),
  embeddingProfile: {
    provider: 'runtime',
    modelId: 'embed-1',
    version: 'v1',
    dimension: 768,
    distanceMetric: 1,
    migrationPolicy: 1,
  },
  displayName: 'Agent Memory',
  canonicalAgentScope: true,
  publicApiWritable: false,
};

test('runtime agent memory helpers project local agent ref and request shapes', () => {
  assert.deepEqual(projectRuntimeLocalAgentIdentityFromRef('local-agent:user-1:agent-1'), {
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
  });
  assert.deepEqual(buildRuntimeMemoryRequestContext({
    runtimeAppId: 'desktop',
    subjectUserId: 'user-1',
  }), {
    appId: 'desktop',
    subjectUserId: 'user-1',
  });
  assert.deepEqual(buildRuntimeAgentCoreMemoryBankLocator('local-agent:user-1:agent-1'), {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore',
      agentCore: { agentId: 'local-agent:user-1:agent-1' },
    },
  });
  assert.throws(() => projectRuntimeLocalAgentIdentityFromRef('agent-1'));
});

test('runtime agent memory canonical bank projection is non-authoritative over runtime evidence', () => {
  assert.equal(runtimeMemoryEmbeddingConfigHasBindingIntent(CONFIG), true);
  assert.deepEqual(projectRuntimeAgentCanonicalMemoryBankStatus({
    config: CONFIG,
    bank: BANK,
    state: {
      bindingIntentPresent: true,
      bindingSourceKind: 'cloud',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'runtime:embed-1:v1',
      canonicalBankStatus: 'rebuild_pending',
      blockedReasonCode: null,
      operationReadiness: { bindAllowed: false, cutoverAllowed: true },
    },
  }), {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'embed-1',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
  });
  assert.deepEqual(projectRuntimeAgentCanonicalMemoryBankStatus({
    config: CONFIG,
    bank: null,
    state: {
      bindingIntentPresent: true,
      bindingSourceKind: 'cloud',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'runtime:embed-1:v1',
      canonicalBankStatus: 'unbound',
      blockedReasonCode: null,
      operationReadiness: { bindAllowed: true, cutoverAllowed: false },
    },
  }), {
    mode: 'baseline',
    bankId: undefined,
    bindingSourceKind: 'cloud',
  });
  assert.deepEqual(projectRuntimeAgentCanonicalMemoryBankStatus({
    config: { ...CONFIG, sourceKind: null, bindingRef: null },
    bank: null,
    state: {
      bindingIntentPresent: false,
      bindingSourceKind: null,
      resolutionState: 'missing',
      resolvedProfileIdentity: null,
      canonicalBankStatus: 'unbound',
      blockedReasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      operationReadiness: { bindAllowed: false, cutoverAllowed: false },
    },
  }), {
    mode: 'unavailable',
    bankId: undefined,
    bindingSourceKind: undefined,
    blockedReasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
  });
});

test('runtime agent memory error classifiers keep Runtime reason handling shared', () => {
  assert.equal(isRuntimeMemoryUnavailableError(createNimiError({
    message: 'runtime unavailable',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    source: 'runtime',
  })), true);
  assert.equal(isRuntimeMemoryUnavailableError(new Error('local memory substrate is not configured')), true);
  assert.equal(isRuntimeMemoryNotFoundError(createNimiError({
    message: 'not found',
    reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
    source: 'runtime',
  })), true);
  assert.equal(isRuntimeMemoryNotFoundError(new Error('permission denied')), false);
});
