import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiProtectedHostMemoryEmbeddingRuntimeSurface,
  nimiMemoryEmbeddingProfileIdentity,
  projectNimiMemoryEmbeddingBindResult,
  projectNimiMemoryEmbeddingCutoverResult,
  projectNimiMemoryEmbeddingRuntimeState,
  projectUnavailableNimiMemoryEmbeddingRuntimeState,
} from './index';
import { ReasonCode } from '../core-generated/runtime-typed-client';

const targetRef = {
  kind: 'agent-core' as const,
  localAgentRef: 'agent-1',
};

test('Runtime memory embedding runtime state helpers consume text.embed AI config projection', () => {
  assert.equal(nimiMemoryEmbeddingProfileIdentity(undefined), null);
  assert.equal(nimiMemoryEmbeddingProfileIdentity({
    provider: 'openai',
    modelId: 'text-embedding-3-large',
    version: '2026-06',
  }), 'openai:text-embedding-3-large:2026-06');

  assert.deepEqual(projectNimiMemoryEmbeddingRuntimeState({
    textEmbedIntentPresent: true,
    textEmbedSourceKind: 'cloud',
    configRevision: '7',
    resolutionState: 'resolved',
    resolvedProfile: {
      provider: 'openai',
      modelId: 'text-embedding-3-large',
      version: '2026-06',
    },
    canonicalBankStatus: 'cutover_ready',
    blockedReasonCode: ReasonCode.AI_MEMORY_EMBEDDING_TARGET_REF_INVALID,
    operationReadiness: { bindAllowed: true, cutoverAllowed: true },
  }), {
    textEmbedIntentPresent: true,
    textEmbedSourceKind: 'cloud',
    configRevision: 7,
    resolutionState: 'resolved',
    resolvedProfileIdentity: 'openai:text-embedding-3-large:2026-06',
    canonicalBankStatus: 'cutover_ready',
    blockedReasonCode: 'AI_MEMORY_EMBEDDING_TARGET_REF_INVALID',
    operationReadiness: { bindAllowed: true, cutoverAllowed: true },
  });

  assert.equal(projectNimiMemoryEmbeddingBindResult({
    outcome: 'staged_rebuild',
    blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
    canonicalBankStatusAfter: 'rebuild_pending',
    pendingCutover: true,
  }).canonicalBankStatusAfter, 'rebuild_pending');
  assert.equal(projectNimiMemoryEmbeddingCutoverResult({
    outcome: 'not_ready',
    blockedReasonCode: ReasonCode.AI_MEMORY_EMBEDDING_TARGET_REF_INVALID,
    canonicalBankStatusAfter: 'rebuild_pending',
  }).outcome, 'not_ready');
  assert.deepEqual(projectUnavailableNimiMemoryEmbeddingRuntimeState(), {
    textEmbedIntentPresent: false,
    textEmbedSourceKind: null,
    configRevision: 0,
    resolutionState: 'unavailable',
    resolvedProfileIdentity: null,
    canonicalBankStatus: 'unbound',
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
    operationReadiness: { bindAllowed: false, cutoverAllowed: false },
  });
});

test('Runtime memory embedding protected surface is runtime-only and inspect driven', async () => {
  const issuedScopes: string[][] = [];
  const runtime = {
    appId: 'sdk.test',
    auth: {
      async registerApp() {
        return {
          appInstanceId: 'sdk.test.memory-embedding',
          accepted: true,
          reasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
        };
      },
    },
    appAuth: {
      async authorizeExternalPrincipal(request: { scopes: string[] }) {
        issuedScopes.push(request.scopes);
        return {
          tokenId: 'token-1',
          secret: 'secret-1',
          appId: 'sdk.test',
          subjectUserId: 'user-1',
          externalPrincipalId: 'sdk.test',
          effectiveScopes: request.scopes,
          policyVersion: 'memory-embedding-v1',
          issuedScopeCatalogVersion: 'sdk-v2',
          canDelegate: false,
        };
      },
    },
    memory: {
      async inspectMemoryEmbeddingRuntime() {
        return {
          textEmbedIntentPresent: true,
          textEmbedSourceKind: 'cloud',
          configRevision: '7',
          resolutionState: 'resolved',
          canonicalBankStatus: 'bound_equivalent',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          operationReadiness: { bindAllowed: true, cutoverAllowed: false },
        };
      },
      async requestMemoryEmbeddingRuntimeBind() {
        return {
          outcome: 'already_bound',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
          pendingCutover: false,
        };
      },
      async requestMemoryEmbeddingRuntimeCutover() {
        return {
          outcome: 'already_current',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
        };
      },
    },
  };
  const surface = createNimiProtectedHostMemoryEmbeddingRuntimeSurface({
    runtime: () => runtime,
    getSubjectUserId: () => 'user-1',
  });

  const state = await surface.inspect({ targetRef });
  const bind = await surface.requestBind({ targetRef });

  assert.equal(state.textEmbedIntentPresent, true);
  assert.equal(state.textEmbedSourceKind, 'cloud');
  assert.equal(state.configRevision, 7);
  assert.equal(state.operationReadiness.bindAllowed, true);
  assert.equal(bind.outcome, 'already_bound');
  assert.deepEqual(issuedScopes, [
    ['runtime.memory.read'],
    ['runtime.memory.write'],
  ]);
});
