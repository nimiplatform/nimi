import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiMemoryEmbeddingBindingIntentSnapshot,
  createEmptyNimiMemoryEmbeddingConfig,
  createNimiProtectedHostMemoryEmbeddingConfigSurface,
  createNimiProtectedHostMemoryEmbeddingRuntimeSurface,
  projectNimiMemoryEmbeddingRouteAvailability,
  type NimiMemoryEmbeddingConfig,
} from './index';
import { ReasonCode } from '../core-generated/runtime-typed-client';

const scopeRef = {
  kind: 'feature',
  ownerId: 'sdk-test',
  surfaceId: 'memory-embedding',
};

const targetRef = {
  kind: 'agent-core' as const,
  localAgentRef: 'agent-1',
};

test('Runtime memory embedding projection builds cloud and local binding intents', () => {
  const empty = createEmptyNimiMemoryEmbeddingConfig(scopeRef);
  assert.equal(empty.sourceKind, null);
  assert.equal(buildNimiMemoryEmbeddingBindingIntentSnapshot(empty), undefined);

  const cloud: NimiMemoryEmbeddingConfig = {
    ...empty,
    sourceKind: 'cloud',
    bindingRef: {
      kind: 'cloud',
      connectorId: 'connector-1',
      modelId: 'embedding-1',
    },
  };
  assert.deepEqual(buildNimiMemoryEmbeddingBindingIntentSnapshot(cloud), {
    sourceKind: 'cloud',
    cloudBinding: { connectorId: 'connector-1', modelId: 'embedding-1' },
    revisionToken: cloud.revisionToken,
  });
  assert.deepEqual(projectNimiMemoryEmbeddingRouteAvailability({
    config: cloud,
    routeOptions: {
      capability: 'text.embed',
      selected: null,
      local: { models: [] },
      connectors: [{
        id: 'connector-1',
        label: 'Connector',
        models: ['embedding-1'],
      }],
    },
  }), {
    state: 'ready',
    reason: 'cloud_model_available',
    sourceKind: 'cloud',
    bindingRef: cloud.bindingRef,
  });
});

test('Runtime memory embedding protected surfaces project config and runtime state', async () => {
  const issuedScopes: string[][] = [];
  let bindingIntent = buildNimiMemoryEmbeddingBindingIntentSnapshot({
    ...createEmptyNimiMemoryEmbeddingConfig(scopeRef),
    sourceKind: 'cloud',
    bindingRef: {
      kind: 'cloud',
      connectorId: 'connector-1',
      modelId: 'embedding-1',
    },
  });
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
          issuedScopeCatalogVersion: 'sdk-vnext',
          canDelegate: false,
        };
      },
    },
    memory: {
      async getMemoryEmbeddingRuntimeIntent() {
        return { bindingIntentPresent: Boolean(bindingIntent), bindingIntent };
      },
      async setMemoryEmbeddingRuntimeIntent(request: { bindingIntent?: typeof bindingIntent }) {
        bindingIntent = request.bindingIntent;
        return { accepted: true, bindingIntentPresent: Boolean(bindingIntent), bindingIntent };
      },
      async inspectMemoryEmbeddingRuntime() {
        return {
          bindingIntentPresent: Boolean(bindingIntent),
          bindingSourceKind: bindingIntent?.sourceKind || '',
          resolutionState: bindingIntent ? 'resolved' : 'missing',
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
  const config = createNimiProtectedHostMemoryEmbeddingConfigSurface({
    runtime: () => runtime,
    getSubjectUserId: () => 'user-1',
  });
  const surface = createNimiProtectedHostMemoryEmbeddingRuntimeSurface({
    runtime: () => runtime,
    getSubjectUserId: () => 'user-1',
  });

  const input = { scopeRef, targetRef };
  const projectedConfig = await config.get(input);
  const state = await surface.inspect(input);
  const bind = await surface.requestBind(input);

  assert.equal(projectedConfig.sourceKind, 'cloud');
  assert.equal(state.resolutionState, 'resolved');
  assert.equal(state.operationReadiness.bindAllowed, true);
  assert.equal(bind.outcome, 'already_bound');
  assert.deepEqual(issuedScopes, [
    ['runtime.memory.read'],
    ['runtime.memory.read'],
    ['runtime.memory.write'],
  ]);
});
