import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentCanonicalMemoryBankMode,
  projectRuntimeAgentCanonicalMemoryBankStatus,
  RuntimeReasonCode,
} from '../src/runtime/index.js';

test('runtime agent memory canonical bank projection formats Runtime-owned status', () => {
  assert.deepEqual(projectRuntimeAgentCanonicalMemoryBankStatus({
    mode: AgentCanonicalMemoryBankMode.STANDARD,
    bankId: 'bank-agent-1',
    embeddingProfile: {
      provider: 'runtime',
      modelId: 'embed-1',
      version: 'v1',
      dimension: 768,
      distanceMetric: 1,
      migrationPolicy: 1,
    },
    bindingSourceKind: 'cloud',
    blockedReasonCode: 0,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: true,
  }), {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'embed-1',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: true,
  });

  assert.deepEqual(projectRuntimeAgentCanonicalMemoryBankStatus({
    mode: AgentCanonicalMemoryBankMode.UNAVAILABLE,
    bankId: '',
    bindingSourceKind: '',
    blockedReasonCode: RuntimeReasonCode.AI_LOCAL_SERVICE_UNAVAILABLE,
    pendingCutover: false,
    canonicalBankStatus: 'unbound',
    bindAllowed: false,
    cutoverAllowed: false,
  }), {
    mode: 'unavailable',
    bankId: undefined,
    embeddingProfileModelId: undefined,
    bindingSourceKind: undefined,
    blockedReasonCode: 'AI_LOCAL_SERVICE_UNAVAILABLE',
    pendingCutover: false,
    canonicalBankStatus: 'unbound',
    bindAllowed: false,
    cutoverAllowed: false,
  });
});

test('runtime agent memory projection fails closed without Runtime status', () => {
  assert.throws(
    () => projectRuntimeAgentCanonicalMemoryBankStatus(undefined),
    /RUNTIME_AGENT_CANONICAL_MEMORY_STATUS_REQUIRED/,
  );
  assert.throws(
    () => projectRuntimeAgentCanonicalMemoryBankStatus({
      mode: AgentCanonicalMemoryBankMode.UNSPECIFIED,
      bankId: '',
      bindingSourceKind: '',
      blockedReasonCode: 0,
      pendingCutover: false,
      canonicalBankStatus: '',
      bindAllowed: false,
      cutoverAllowed: false,
    }),
    /RUNTIME_AGENT_CANONICAL_MEMORY_MODE_REQUIRED/,
  );
});
