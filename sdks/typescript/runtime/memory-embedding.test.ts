import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiMemoryEmbeddingBindingIntentSnapshot,
  createEmptyNimiMemoryEmbeddingConfig,
  createNimiProtectedHostMemoryEmbeddingConfigSurface,
  createNimiProtectedHostMemoryEmbeddingRuntimeSurface,
  nimiMemoryEmbeddingProfileIdentity,
  projectNimiMemoryEmbeddingBindResult,
  projectNimiMemoryEmbeddingConfigFromRuntimeIntent,
  projectNimiMemoryEmbeddingCutoverResult,
  projectNimiMemoryEmbeddingRuntimeState,
  projectNimiMemoryEmbeddingRouteAvailability,
  projectUnavailableNimiMemoryEmbeddingRuntimeState,
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
      remoteModelCatalogId: 'remote-catalog-embedding-1',
      providerModelId: 'embedding-1',
      provider: 'openai',
    },
  };
  assert.deepEqual(buildNimiMemoryEmbeddingBindingIntentSnapshot(cloud), {
    sourceKind: 'cloud',
    cloudBinding: {
      connectorId: 'connector-1',
      remoteModelCatalogId: 'remote-catalog-embedding-1',
      providerModelId: 'embedding-1',
      provider: 'openai',
    },
    revisionToken: cloud.revisionToken,
  });
  assert.deepEqual(projectNimiMemoryEmbeddingRouteAvailability({
    config: cloud,
    routeOptions: {
      capability: 'text.embed',
      selectedTargetRef: null,
      inventory: {
        capability: 'text.embed',
        targets: [{
          targetRef: {
            kind: 'cloud-connector',
            version: 'v2',
            connectorId: 'connector-1',
            remoteModelCatalogId: 'remote-catalog-embedding-1',
            providerModelId: 'embedding-1',
            provider: 'openai',
          },
          display: { label: 'Embedding 1', provider: 'openai', model: 'embedding-1' },
          readiness: { status: 'ready' },
          compatibility: { capabilities: ['text.embed'] },
          evidence: {
            source: 'cloud-connector',
            connectorId: 'connector-1',
            remoteModelCatalogId: 'remote-catalog-embedding-1',
            providerModelId: 'embedding-1',
            provider: 'openai',
          },
        }],
      },
    },
  }), {
    state: 'ready',
    reason: 'cloud_model_available',
    sourceKind: 'cloud',
    bindingRef: cloud.bindingRef,
  });

  const localByProfileBinding: NimiMemoryEmbeddingConfig = {
    ...empty,
    sourceKind: 'local',
    bindingRef: {
      kind: 'local',
      profileBindingId: 'profile-binding:embedding-local',
    },
  };
  assert.deepEqual(buildNimiMemoryEmbeddingBindingIntentSnapshot(localByProfileBinding), {
    sourceKind: 'local',
    localBinding: {
      ref: {
        oneofKind: 'profileBindingId',
        profileBindingId: 'profile-binding:embedding-local',
      },
    },
    revisionToken: localByProfileBinding.revisionToken,
  });

  const localByReadinessRef: NimiMemoryEmbeddingConfig = {
    ...empty,
    sourceKind: 'local',
    bindingRef: {
      kind: 'local',
      readinessRef: 'readiness:embedding-local',
    },
  };
  assert.deepEqual(buildNimiMemoryEmbeddingBindingIntentSnapshot(localByReadinessRef), {
    sourceKind: 'local',
    localBinding: {
      ref: {
        oneofKind: 'readinessRef',
        readinessRef: 'readiness:embedding-local',
      },
    },
    revisionToken: localByReadinessRef.revisionToken,
  });
});

test('Runtime memory embedding projection parses v2 runtime intent without legacy model id fallback', () => {
  const input = { scopeRef };
  const cloud = projectNimiMemoryEmbeddingConfigFromRuntimeIntent(input, {
    bindingIntentPresent: true,
    bindingIntent: {
      sourceKind: 'cloud',
      revisionToken: 'rev-cloud',
      cloudBinding: {
        connectorId: 'connector-1',
        remoteModelCatalogId: 'remote-catalog-embedding-1',
        providerModelId: 'embedding-1',
        provider: 'openai',
      },
    },
  });
  assert.equal(cloud.sourceKind, 'cloud');
  assert.deepEqual(cloud.bindingRef, {
    kind: 'cloud',
    connectorId: 'connector-1',
    remoteModelCatalogId: 'remote-catalog-embedding-1',
    providerModelId: 'embedding-1',
    provider: 'openai',
  });
  assert.equal(cloud.revisionToken, 'rev-cloud');

  const localProfile = projectNimiMemoryEmbeddingConfigFromRuntimeIntent(input, {
    bindingIntentPresent: true,
    bindingIntent: {
      sourceKind: 'local',
      revisionToken: 'rev-local-profile',
      localBinding: {
        ref: {
          oneofKind: 'profileBindingId',
          profileBindingId: 'profile-binding:embedding-local',
        },
      },
    },
  });
  assert.equal(localProfile.sourceKind, 'local');
  assert.deepEqual(localProfile.bindingRef, {
    kind: 'local',
    profileBindingId: 'profile-binding:embedding-local',
  });

  const localReadiness = projectNimiMemoryEmbeddingConfigFromRuntimeIntent(input, {
    bindingIntentPresent: true,
    bindingIntent: {
      sourceKind: 'local',
      revisionToken: 'rev-local-readiness',
      localBinding: {
        ref: {
          oneofKind: 'readinessRef',
          readinessRef: 'readiness:embedding-local',
        },
      },
    },
  });
  assert.deepEqual(localReadiness.bindingRef, {
    kind: 'local',
    readinessRef: 'readiness:embedding-local',
  });

  const missing = projectNimiMemoryEmbeddingConfigFromRuntimeIntent(input, {
    bindingIntentPresent: false,
  });
  assert.equal(missing.sourceKind, null);
  assert.equal(missing.bindingRef, null);

  const legacyLikeCloud = projectNimiMemoryEmbeddingConfigFromRuntimeIntent(input, {
    bindingIntentPresent: true,
    bindingIntent: {
      sourceKind: 'cloud',
      revisionToken: 'rev-legacy-like',
      cloudBinding: {
        connectorId: 'connector-1',
        modelId: 'legacy-model-id',
      } as unknown as {
        connectorId: string;
        remoteModelCatalogId: string;
        providerModelId: string;
        provider: string;
      },
    },
  });
  assert.deepEqual(legacyLikeCloud.bindingRef, {
    kind: 'cloud',
    connectorId: 'connector-1',
    remoteModelCatalogId: '',
    providerModelId: '',
    provider: '',
  });
});

test('Runtime memory embedding route availability is driven by v2 target inventory', () => {
  const base = createEmptyNimiMemoryEmbeddingConfig(scopeRef);
  assert.deepEqual(projectNimiMemoryEmbeddingRouteAvailability({ config: base }), {
    state: 'unconfigured',
    reason: 'binding_missing',
    sourceKind: null,
    bindingRef: null,
  });

  const cloud: NimiMemoryEmbeddingConfig = {
    ...base,
    sourceKind: 'cloud',
    bindingRef: {
      kind: 'cloud',
      connectorId: 'connector-1',
      remoteModelCatalogId: 'remote-catalog-embedding-1',
      providerModelId: 'embedding-1',
    },
  };
  assert.equal(projectNimiMemoryEmbeddingRouteAvailability({
    config: cloud,
    routeOptions: {
      capability: 'text.generate',
      selectedTargetRef: null,
      inventory: { capability: 'text.generate', targets: [] },
    },
  }).reason, 'route_options_capability_mismatch');
  assert.equal(projectNimiMemoryEmbeddingRouteAvailability({
    config: cloud,
    routeOptions: {
      capability: 'text.embed',
      selectedTargetRef: null,
      inventory: { capability: 'text.embed', targets: [] },
    },
  }).reason, 'cloud_model_unavailable');

  const local: NimiMemoryEmbeddingConfig = {
    ...base,
    sourceKind: 'local',
    bindingRef: {
      kind: 'local',
      profileBindingId: 'profile-binding:embedding-local',
    },
  };
  const readyLocal = projectNimiMemoryEmbeddingRouteAvailability({
    config: local,
    routeOptions: {
      capability: 'text.embed',
      selectedTargetRef: null,
      inventory: {
        capability: 'text.embed',
        targets: [{
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'profile-binding:embedding-local',
          },
          display: { label: 'Local embedding' },
          readiness: { status: 'active' },
          compatibility: { capabilities: ['text.embed'] },
          evidence: {
            source: 'local-runtime',
            localAssetId: 'local-embedding-asset',
            resolvedModelId: 'embedding-local',
            engine: 'runtime-engine',
          },
        }],
      },
    },
  });
  assert.equal(readyLocal.state, 'ready');
  assert.equal(readyLocal.reason, 'local_model_active');

  assert.equal(projectNimiMemoryEmbeddingRouteAvailability({
    config: {
      ...base,
      sourceKind: 'local',
      bindingRef: {
        kind: 'local',
        readinessRef: 'readiness:missing',
      },
    },
    routeOptions: {
      capability: 'text.embed',
      selectedTargetRef: null,
      inventory: { capability: 'text.embed', targets: [] },
    },
  }).reason, 'local_model_unavailable');

  assert.equal(projectNimiMemoryEmbeddingRouteAvailability({
    config: {
      ...base,
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'local',
        profileBindingId: 'profile-binding:embedding-local',
      },
    },
    routeOptions: null,
  }).reason, 'source_binding_mismatch');
});

test('Runtime memory embedding runtime state helpers normalize fail-closed states', () => {
  assert.equal(nimiMemoryEmbeddingProfileIdentity(undefined), null);
  assert.equal(nimiMemoryEmbeddingProfileIdentity({
    provider: 'openai',
    modelId: 'text-embedding-3-large',
    version: '2026-06',
  }), 'openai:text-embedding-3-large:2026-06');

  assert.deepEqual(projectNimiMemoryEmbeddingRuntimeState({
    bindingIntentPresent: true,
    bindingSourceKind: 'cloud',
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
    bindingIntentPresent: true,
    bindingSourceKind: 'cloud',
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
    bindingIntentPresent: false,
    bindingSourceKind: null,
    resolutionState: 'unavailable',
    resolvedProfileIdentity: null,
    canonicalBankStatus: 'unbound',
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
    operationReadiness: { bindAllowed: false, cutoverAllowed: false },
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
      remoteModelCatalogId: 'remote-catalog-embedding-1',
      providerModelId: 'embedding-1',
      provider: 'openai',
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
          issuedScopeCatalogVersion: 'sdk-v2',
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
