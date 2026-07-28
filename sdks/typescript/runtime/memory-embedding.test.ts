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
  const receivedMetadata: Array<Record<string, string> | undefined> = [];
  const runtime = {
    appId: 'sdk.test',
    memory: {
      async inspectMemoryEmbeddingRuntime(_request: unknown, options?: { metadata?: Record<string, string> }) {
        receivedMetadata.push(options?.metadata);
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
    withScopes: async (scopes, operation) => {
      issuedScopes.push([...scopes]);
      return operation({ metadata: { 'x-nimi-protected-carrier': 'test-carrier' } });
    },
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
  assert.deepEqual(receivedMetadata, [{ 'x-nimi-protected-carrier': 'test-carrier' }]);
});

test('Runtime memory embedding protected surface rejects calls without a scoped carrier', async () => {
	let registrationCalls = 0;
	const runtime = {
		appId: 'sdk.test',
		auth: {
			async registerApp() {
				registrationCalls += 1;
				return { accepted: true, reasonCode: ReasonCode.REASON_CODE_UNSPECIFIED };
			},
		},
		memory: {
			async inspectMemoryEmbeddingRuntime() {
				return {
					textEmbedIntentPresent: true,
					textEmbedSourceKind: 'cloud',
					configRevision: '1',
					resolutionState: 'resolved',
					canonicalBankStatus: 'bound_equivalent',
					blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
					operationReadiness: { bindAllowed: true, cutoverAllowed: true },
				};
			},
			async requestMemoryEmbeddingRuntimeBind() {
				throw new Error('not reached');
			},
			async requestMemoryEmbeddingRuntimeCutover() {
				throw new Error('not reached');
			},
		},
	};
	const surface = createNimiProtectedHostMemoryEmbeddingRuntimeSurface({
		runtime: () => runtime,
		getSubjectUserId: () => 'user-1',
	});

	await assert.rejects(surface.inspect({ targetRef }), (error: unknown) => {
		assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED');
		return true;
	});
	assert.equal(registrationCalls, 0);
});
