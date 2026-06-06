import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuthorizeExternalPrincipalResponse,
  MemoryBankScope,
  RegisterAppResponse,
  RuntimeReasonCode,
  buildMemoryEmbeddingAgentCoreLocator,
  buildMemoryEmbeddingBindingIntentSnapshot,
  createHostMemoryEmbeddingConfigSurface,
  createEmptyMemoryEmbeddingConfig,
  createHostMemoryEmbeddingRuntimeSurface,
  createProtectedHostMemoryEmbeddingConfigSurface,
  createProtectedHostMemoryEmbeddingRuntimeSurface,
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
  assert.deepEqual(buildMemoryEmbeddingAgentCoreLocator({
    kind: 'agent-core',
    localAgentRef: ' local-agent:user-1:agent-1 ',
  }), {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore',
      agentCore: {
        agentId: 'local-agent:user-1:agent-1',
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

test('memory embedding runtime unavailable projection fails closed without host binding intent', () => {
  assert.deepEqual(projectUnavailableMemoryEmbeddingRuntimeState({
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
  }), {
    bindingIntentPresent: false,
    bindingSourceKind: null,
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

test('host memory embedding config surface composes Runtime intent calls without owning memory truth', async () => {
  const config = {
    ...createEmptyMemoryEmbeddingConfig(scopeRef),
    sourceKind: 'cloud' as const,
    bindingRef: {
      kind: 'cloud' as const,
      connectorId: 'cloud-connector',
      modelId: 'embedding-model',
    },
    revisionToken: 'rev-runtime',
  };
  const calls: Array<{ method: string; request: unknown; scopes?: readonly string[] }> = [];
  const surface = createHostMemoryEmbeddingConfigSurface({
    runtime: () => ({
      appId: 'dev.nimi.consumer',
      memory: {
        async getMemoryEmbeddingRuntimeIntent(request) {
          calls.push({ method: 'get', request });
          return {
            bindingIntentPresent: true,
            bindingIntent: buildMemoryEmbeddingBindingIntentSnapshot(config),
          };
        },
        async setMemoryEmbeddingRuntimeIntent(request) {
          calls.push({ method: 'set', request });
          return {
            bindingIntentPresent: Boolean(request.bindingIntent),
            bindingIntent: request.bindingIntent,
          };
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => {
      const result = await operation({ metadata: { caller: 'test' } });
      calls[calls.length - 1].scopes = scopes;
      return result;
    },
  });

  const request = { scopeRef, targetRef: { kind: 'agent-core' as const, localAgentRef: 'local-agent:user-1:agent-1' } };
  assert.equal((await surface.get(request)).sourceKind, 'cloud');
  assert.equal((await surface.update(request, config)).sourceKind, 'cloud');
  assert.deepEqual(calls.map((call) => call.method), ['get', 'set']);
  assert.deepEqual(calls.map((call) => call.scopes), [
    ['runtime.memory.read'],
    ['runtime.memory.write'],
  ]);
  assert.deepEqual(
    (calls[0].request as { context: unknown; bindingIntent: unknown }).context,
    { appId: 'dev.nimi.consumer', subjectUserId: 'user-1' },
  );
  assert.deepEqual(
    (calls[1].request as { bindingIntent: unknown }).bindingIntent,
    buildMemoryEmbeddingBindingIntentSnapshot(config),
  );
});

test('host memory embedding runtime surface composes Runtime operations without owning intent truth', async () => {
  const calls: Array<{ method: string; request: unknown; scopes?: readonly string[] }> = [];
  const surface = createHostMemoryEmbeddingRuntimeSurface({
    runtime: () => ({
      appId: 'dev.nimi.consumer',
      memory: {
        async inspectMemoryEmbeddingRuntime(request) {
          calls.push({ method: 'inspect', request });
          return {
            bindingIntentPresent: true,
            bindingSourceKind: 'cloud',
            resolutionState: 'resolved',
            canonicalBankStatus: 'bound_equivalent',
            blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
            operationReadiness: { bindAllowed: false, cutoverAllowed: false },
          };
        },
        async requestMemoryEmbeddingRuntimeBind(request) {
          calls.push({ method: 'bind', request });
          return {
            outcome: 'already_bound',
            blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
            canonicalBankStatusAfter: 'bound_equivalent',
            pendingCutover: false,
          };
        },
        async requestMemoryEmbeddingRuntimeCutover(request) {
          calls.push({ method: 'cutover', request });
          return {
            outcome: 'already_current',
            blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
            canonicalBankStatusAfter: 'bound_equivalent',
          };
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => {
      const result = await operation({ metadata: { caller: 'test' } });
      calls[calls.length - 1].scopes = scopes;
      return result;
    },
  });

  const request = { scopeRef, targetRef: { kind: 'agent-core' as const, localAgentRef: 'local-agent:user-1:agent-1' } };
  assert.equal((await surface.inspect(request)).resolutionState, 'resolved');
  assert.equal((await surface.requestBind(request)).outcome, 'already_bound');
  assert.equal((await surface.requestCutover(request)).outcome, 'already_current');
  assert.deepEqual(calls.map((call) => call.method), ['inspect', 'bind', 'cutover']);
  assert.deepEqual(calls.map((call) => call.scopes), [
    ['runtime.memory.read'],
    ['runtime.memory.write'],
    ['runtime.memory.write'],
  ]);
  assert.deepEqual(
    (calls[0].request as { context: unknown; bindingIntent?: unknown }).context,
    { appId: 'dev.nimi.consumer', subjectUserId: 'user-1' },
  );
  assert.equal('bindingIntentSnapshot' in (calls[0].request as Record<string, unknown>), false);
});

test('protected host memory embedding surfaces own protected access composition', async () => {
  const calls: Array<{ method: string; tokenId?: string; scopes?: readonly string[] }> = [];
  const runtime = {
    appId: 'dev.nimi.consumer',
    auth: {
      registerApp: async () => RegisterAppResponse.create({ accepted: true }),
    },
    appAuth: {
      authorizeExternalPrincipal: async (request) => AuthorizeExternalPrincipalResponse.create({
        tokenId: `token-${request.scopes.join('-')}`,
        secret: 'secret',
        appId: request.appId,
        subjectUserId: request.subjectUserId,
        externalPrincipalId: request.externalPrincipalId,
        effectiveScopes: request.scopes,
        policyVersion: request.policyVersion,
        issuedScopeCatalogVersion: request.scopeCatalogVersion,
        canDelegate: false,
      }),
    },
    memory: {
      async getMemoryEmbeddingRuntimeIntent(_request, options) {
        calls.push({
          method: 'get',
          tokenId: options?.protectedAccessToken?.tokenId,
        });
        return { bindingIntentPresent: false };
      },
      async setMemoryEmbeddingRuntimeIntent(_request, options) {
        calls.push({
          method: 'set',
          tokenId: options?.protectedAccessToken?.tokenId,
        });
        return { bindingIntentPresent: false };
      },
      async inspectMemoryEmbeddingRuntime(_request, options) {
        calls.push({
          method: 'inspect',
          tokenId: options?.protectedAccessToken?.tokenId,
        });
        return {
          bindingIntentPresent: true,
          bindingSourceKind: 'cloud',
          resolutionState: 'resolved',
          canonicalBankStatus: 'bound_equivalent',
          blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
          operationReadiness: { bindAllowed: false, cutoverAllowed: false },
        };
      },
      async requestMemoryEmbeddingRuntimeBind(_request, options) {
        calls.push({
          method: 'bind',
          tokenId: options?.protectedAccessToken?.tokenId,
        });
        return {
          outcome: 'already_bound',
          blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
          pendingCutover: false,
        };
      },
      async requestMemoryEmbeddingRuntimeCutover(_request, options) {
        calls.push({
          method: 'cutover',
          tokenId: options?.protectedAccessToken?.tokenId,
        });
        return {
          outcome: 'already_current',
          blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
        };
      },
    },
  };
  const configSurface = createProtectedHostMemoryEmbeddingConfigSurface({
    runtime: () => ({
      ...runtime,
      memory: {
        getMemoryEmbeddingRuntimeIntent: runtime.memory.getMemoryEmbeddingRuntimeIntent,
        setMemoryEmbeddingRuntimeIntent: runtime.memory.setMemoryEmbeddingRuntimeIntent,
      },
    }),
    getSubjectUserId: () => 'user-1',
  });
  const runtimeSurface = createProtectedHostMemoryEmbeddingRuntimeSurface({
    runtime: () => ({
      ...runtime,
      memory: {
        inspectMemoryEmbeddingRuntime: runtime.memory.inspectMemoryEmbeddingRuntime,
        requestMemoryEmbeddingRuntimeBind: runtime.memory.requestMemoryEmbeddingRuntimeBind,
        requestMemoryEmbeddingRuntimeCutover: runtime.memory.requestMemoryEmbeddingRuntimeCutover,
      },
    }),
    getSubjectUserId: () => 'user-1',
  });

  const request = { scopeRef, targetRef: { kind: 'agent-core' as const, localAgentRef: 'local-agent:user-1:agent-1' } };
  await configSurface.get(request);
  await configSurface.update(request, createEmptyMemoryEmbeddingConfig(scopeRef));
  await runtimeSurface.inspect(request);
  await runtimeSurface.requestBind(request);
  await runtimeSurface.requestCutover(request);

  assert.deepEqual(calls.map((call) => call.method), ['get', 'set', 'inspect', 'bind', 'cutover']);
  assert.deepEqual(calls.map((call) => call.tokenId), [
    'token-runtime.memory.read',
    'token-runtime.memory.write',
    'token-runtime.memory.read',
    'token-runtime.memory.write',
    'token-runtime.memory.write',
  ]);
});

test('host memory embedding runtime surface fails closed without subject user id', async () => {
  const config = {
    ...createEmptyMemoryEmbeddingConfig(scopeRef),
    sourceKind: 'local' as const,
    bindingRef: {
      kind: 'local' as const,
      targetId: 'local-embedding',
    },
  };
  const surface = createHostMemoryEmbeddingRuntimeSurface({
    runtime: () => {
      throw new Error('runtime should not be called');
    },
    getSubjectUserId: () => '',
    unavailableReasonCode: 'RUNTIME_UNAVAILABLE',
  });
  const request = { scopeRef, targetRef: { kind: 'agent-core' as const, localAgentRef: 'local-agent:user-1:agent-1' } };

  assert.equal((await surface.inspect(request)).resolutionState, 'unavailable');
  assert.deepEqual(await surface.requestBind(request), {
    outcome: 'rejected',
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
    canonicalBankStatusAfter: 'unbound',
    pendingCutover: false,
  });
  assert.deepEqual(await surface.requestCutover(request), {
    outcome: 'not_ready',
    blockedReasonCode: 'RUNTIME_UNAVAILABLE',
    canonicalBankStatusAfter: 'unbound',
  });
});
