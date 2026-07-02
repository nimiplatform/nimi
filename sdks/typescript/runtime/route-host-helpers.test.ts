import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiRuntimeRouteOptionsProjection,
  buildNimiRuntimeRouteRequestMetadata,
  buildNimiRuntimeRouteTargetCallOptions,
  createNimiHostRuntimeRouteAccessSurface,
  createNimiRuntimeRouteLocalWarmCache,
  createNimiRuntimeRouteOptionsHostDeps,
  listNimiRuntimeRouteOptionsWithHost,
  normalizeNimiRuntimeRouteOptionsSnapshot,
  resetNimiRuntimeRouteLocalWarmCache,
  type NimiRuntimeResolvedBinding,
} from './index';
import {
  ConnectorKind,
  ConnectorStatus,
  LocalAssetKind,
  LocalAssetStatus,
} from '../core-generated/runtime-typed-client';

function localAssetRecord(overrides: Partial<{
  localAssetId: string;
  assetId: string;
  kind: LocalAssetKind;
  engine: string;
  endpoint: string;
  status: LocalAssetStatus;
  capabilities: string[];
  artifactRoles: string[];
}> = {}) {
  return {
    localAssetId: overrides.localAssetId ?? 'asset-local-1',
    assetId: overrides.assetId ?? 'llama/tester',
    kind: overrides.kind ?? LocalAssetKind.CHAT,
    engine: overrides.engine ?? 'llama',
    entry: '',
    files: [],
    license: '',
    hashes: {},
    status: overrides.status ?? LocalAssetStatus.ACTIVE,
    installedAt: '',
    updatedAt: '',
    healthDetail: '',
    capabilities: overrides.capabilities ?? ['text.generate'],
    logicalModelId: '',
    family: '',
    artifactRoles: overrides.artifactRoles ?? [],
    preferredEngine: '',
    fallbackEngines: [],
    bundleState: 0,
    warmState: 0,
    localInvokeProfileId: '',
    endpoint: overrides.endpoint ?? 'http://127.0.0.1:11434',
    reasonCode: 0,
  };
}

test('Runtime host route options project generated Runtime enums to SDK route strings', async () => {
  const selectedTargetRef = {
    kind: 'local-runtime' as const,
    version: 'v2' as const,
    profileBindingId: 'local-runtime:asset-local-1',
  };
  const snapshot = await listNimiRuntimeRouteOptionsWithHost({
    capability: 'text.generate',
    selectedTargetRef,
  }, {
    listConnectors: async () => [{
      id: 'cloud-1',
      label: 'Cloud',
      provider: 'tester',
    }],
    listConnectorModelDescriptors: async () => [{
      modelId: 'cloud-model',
      modelLabel: 'Cloud Model',
      remoteModelCatalogId: 'remote-catalog:cloud-model',
      providerModelId: 'cloud-model',
      provider: 'tester',
      capabilities: ['text.generate'],
    }],
    loadLocalRouteMetadata: async () => ({
      snapshotAssets: [{
        localAssetId: 'asset-local-1',
        assetId: 'llama/tester',
        engine: 'llama',
        endpoint: 'http://127.0.0.1:11434',
        status: LocalAssetStatus.ACTIVE,
      }],
      runtimeLocalModels: [{
        localAssetId: 'asset-local-1',
        assetId: 'llama/tester',
        kind: LocalAssetKind.CHAT,
        engine: 'llama',
        endpoint: 'http://127.0.0.1:11434',
        status: LocalAssetStatus.ACTIVE,
      }],
    }),
  });

  assert.deepEqual(snapshot.selectedTargetRef, selectedTargetRef);
  const localTarget = snapshot.inventory.targets.find((item) => item.evidence.source === 'local-runtime');
  const cloudTarget = snapshot.inventory.targets.find((item) => item.evidence.source === 'cloud-connector');
  assert.equal(localTarget?.readiness.status, 'active');
  assert.equal(localTarget?.compatibility.capabilities[0], 'text.generate');
  assert.equal(cloudTarget?.targetRef.kind, 'cloud-connector');
  assert.equal(cloudTarget?.targetRef.kind === 'cloud-connector' ? cloudTarget.targetRef.remoteModelCatalogId : '', 'remote-catalog:cloud-model');
});

test('Runtime host route options default deps page through generated Runtime modules', async () => {
  const calls: string[] = [];
  const deps = createNimiRuntimeRouteOptionsHostDeps({
    connectors: {
      async listConnectors(request) {
        calls.push(`connectors:${request.kindFilter}:${request.statusFilter}`);
        return {
          connectors: [{
            connectorId: 'cloud-1',
            kind: ConnectorKind.REMOTE_MANAGED,
            ownerType: 0,
            ownerId: '',
            provider: 'tester',
            endpoint: '',
            label: 'Cloud',
            status: ConnectorStatus.ACTIVE,
            localCategory: 0,
            hasCredential: true,
            authKind: 0,
            providerAuthProfile: '',
          }],
          nextPageToken: '',
        };
      },
      async listConnectorModels(request) {
        calls.push(`models:${request.connectorId}`);
        return {
          models: [{
            modelId: 'cloud-model',
            modelLabel: 'Cloud Model',
            available: true,
            capabilities: ['text.generate'],
            remoteModelCatalogId: 'remote-catalog:cloud-model',
            providerModelId: 'cloud-model',
            provider: 'tester',
          }],
          nextPageToken: '',
        };
      },
    },
    local: {
      async listLocalAssets(request) {
        calls.push(`local:${request.kindFilter}:${request.statusFilter}`);
        return {
          assets: [localAssetRecord()],
          nextPageToken: '',
        };
      },
    },
  });

  const snapshot = await listNimiRuntimeRouteOptionsWithHost({ capability: 'chat' }, deps);
  assert.equal(snapshot.capability, 'text.generate');
  assert.equal(snapshot.inventory.targets.find((item) => item.evidence.source === 'local-runtime')?.readiness.status, 'active');
  assert.deepEqual(calls, ['connectors:2:1', 'local:0:0', 'models:cloud-1']);
});

test('Runtime host route options preserve saved cloud selections across provider model id canonicalization', () => {
  const snapshot = buildNimiRuntimeRouteOptionsProjection({
    capability: 'text.generate',
    selectedTargetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: 'volcengine-1',
      remoteModelCatalogId: 'remote-model-catalog:volcengine-1:doubao-seed-2.0-pro',
      providerModelId: 'doubao-seed-2.0-pro',
      provider: 'volcengine',
    },
    connectors: [{
      descriptor: { id: 'volcengine-1', label: 'Volcengine', vendor: 'Volcengine', provider: 'volcengine' },
      modelDescriptors: [{
        modelId: 'doubao-seed-2.0-pro',
        modelLabel: 'doubao-seed-2.0-pro',
        remoteModelCatalogId: 'remote-model-catalog:volcengine-1:doubao-seed-2.0-pro',
        providerModelId: 'doubao-seed-2-0-pro-260215',
        provider: 'volcengine',
        capabilities: ['text.generate'],
      }],
    }],
    runtimeLocalModels: [],
  });

  assert.equal(snapshot.selectedTargetRef?.kind, 'cloud-connector');
  assert.equal(
    snapshot.selectedTargetRef?.kind === 'cloud-connector' ? snapshot.selectedTargetRef.providerModelId : '',
    'doubao-seed-2-0-pro-260215',
  );
  assert.equal(snapshot.inventory.targets[0]?.display.label, 'doubao-seed-2.0-pro');
});

test('Runtime host route options preserve cloud connector display names separately from model labels', () => {
  const snapshot = buildNimiRuntimeRouteOptionsProjection({
    capability: 'text.generate',
    connectors: [{
      descriptor: {
        id: 'volcengine-seedance',
        label: 'Seedance2',
        vendor: 'Volcengine',
        provider: 'volcengine',
      },
      modelDescriptors: [{
        modelId: 'doubao-seed-2.0-pro',
        modelLabel: 'doubao-seed-2.0-pro',
        remoteModelCatalogId: 'remote-model-catalog:volcengine-seedance:doubao-seed-2.0-pro',
        providerModelId: 'doubao-seed-2.0-pro',
        provider: 'volcengine',
        capabilities: ['text.generate'],
      }],
    }],
    runtimeLocalModels: [],
  });

  const target = snapshot.inventory.targets[0];
  assert.equal(target?.display.label, 'doubao-seed-2.0-pro');
  assert.equal(
    (target?.display as { connectorLabel?: string }).connectorLabel,
    'Seedance2',
  );
  assert.equal(
    (target?.display as { connectorProviderLabel?: string }).connectorProviderLabel,
    'Volcengine',
  );
});

test('Runtime route options normalization preserves cloud connector display names', () => {
  const snapshot = buildNimiRuntimeRouteOptionsProjection({
    capability: 'text.generate',
    connectors: [{
      descriptor: {
        id: 'volcengine-seedance',
        label: 'Seedance2',
        vendor: 'Volcengine',
        provider: 'volcengine',
      },
      modelDescriptors: [{
        modelId: 'doubao-seed-2.0-pro',
        modelLabel: 'doubao-seed-2.0-pro',
        remoteModelCatalogId: 'remote-model-catalog:volcengine-seedance:doubao-seed-2.0-pro',
        providerModelId: 'doubao-seed-2.0-pro',
        provider: 'volcengine',
        capabilities: ['text.generate'],
      }],
    }],
    runtimeLocalModels: [],
  });

  const normalized = normalizeNimiRuntimeRouteOptionsSnapshot(snapshot);
  const target = normalized.inventory.targets[0];
  assert.equal(
    (target?.display as { connectorLabel?: string }).connectorLabel,
    'Seedance2',
  );
  assert.equal(
    (target?.display as { connectorProviderLabel?: string }).connectorProviderLabel,
    'Volcengine',
  );
});

test('Runtime host route access builds call options and checks Runtime health sources', async () => {
  const resolved: NimiRuntimeResolvedBinding = {
    capability: 'text.generate',
    source: 'local-runtime',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:asset-local-1',
    },
    resolvedBindingRef: 'local:text.generate:local-runtime%3Aasset-local-1',
    model: 'llama/tester',
    modelId: 'llama/tester',
    provider: 'llama',
    engine: 'llama',
    localAssetId: 'asset-local-1',
  };
  const surface = createNimiHostRuntimeRouteAccessSurface({
    appId: 'nimi.test',
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    getRuntime: () => ({
      connectors: {
        async testConnector() {
          return { ack: { ok: true, reasonCode: 0, actionHint: '' } };
        },
      },
      local: {
        async checkLocalAssetHealth() {
          return {
            assets: [{
              localAssetId: 'asset-local-1',
              status: LocalAssetStatus.ACTIVE,
              detail: '',
              endpoint: 'http://127.0.0.1:11434',
              reasonCode: 0,
            }],
          };
        },
        async listLocalAssets() {
          return {
            assets: [localAssetRecord()],
            nextPageToken: '',
          };
        },
        async warmLocalAsset() {
          return {};
        },
      },
    }),
  });

  const health = await surface.checkLocalHealth({
    provider: 'llama',
    capability: 'text.generate',
    localAssetId: 'asset-local-1',
  });
  assert.equal(health.status, 'healthy');

  const options = await surface.buildCallOptions({
    source: 'local-runtime',
    targetId: 'core.chat.agent',
    timeoutMs: 120000,
  });
  assert.equal(options.timeoutMs, 120000);
  assert.equal(options.metadata?.callerKind, 'desktop-core');
  assert.equal(options.metadata?.surfaceId, 'desktop.test');
  const hostIdentityOptions = buildNimiRuntimeRouteTargetCallOptions({
    targetId: 'core.chat.agent',
    timeoutMs: 120000,
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    callerIdPrefix: 'route',
    identityMetadataMode: 'host',
  });
  assert.equal(hostIdentityOptions.metadata?.callerKind, undefined);
  assert.equal(hostIdentityOptions.metadata?.callerId, undefined);
  assert.equal(hostIdentityOptions.metadata?.surfaceId, 'desktop.test');
  assert.ok(hostIdentityOptions.metadata?.traceId);
  const hostIdentitySurface = createNimiHostRuntimeRouteAccessSurface({
    appId: 'nimi.test',
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    identityMetadataMode: 'host',
    getRuntime: () => surface.getRuntimeClient(),
  });
  const hostSurfaceOptions = await hostIdentitySurface.buildCallOptions({
    source: 'local-runtime',
    targetId: 'core.chat.agent',
    timeoutMs: 120000,
  });
  assert.equal(hostSurfaceOptions.metadata?.callerKind, undefined);
  assert.equal(hostSurfaceOptions.metadata?.callerId, undefined);
  assert.equal(hostSurfaceOptions.metadata?.surfaceId, 'desktop.test');
  await surface.ensureLocalModelWarm({
    targetId: 'core.chat.agent',
    resolvedBinding: resolved,
  });
});

test('Runtime host route options fail closed instead of promoting degraded local metadata fallbacks', async () => {
  const calls: string[] = [];
  const mismatches: unknown[] = [];
  const scope = {};
  const selectedTargetRef = {
    kind: 'local-runtime' as const,
    version: 'v2' as const,
    profileBindingId: 'local-runtime:missing-local',
  };
  const deps = {
    scope,
    async listConnectors() {
      calls.push('connectors');
      return [
        { id: 'cloud-1', label: 'Cloud', provider: 'tester' },
        { id: '', label: 'Ignored', provider: 'ignored' },
      ];
    },
    async listConnectorModelDescriptors(connectorId: string) {
      calls.push(`models:${connectorId}`);
      return [
        {
          modelId: 'cloud-text',
          remoteModelCatalogId: 'remote-catalog:cloud-text',
          providerModelId: 'cloud-text',
          provider: 'tester',
          capabilities: ['text.generate'],
        },
        {
          modelId: 'cloud-image',
          remoteModelCatalogId: 'remote-catalog:cloud-image',
          providerModelId: 'cloud-image',
          provider: 'tester',
          capabilities: ['image.generate'],
        },
      ];
    },
    async loadLocalRouteMetadata() {
      calls.push('local');
      throw new Error('local route metadata unavailable');
    },
    async onLocalRouteMetadataError() {
      return {
        localMetadataDegraded: true,
        metadata: {
          snapshotAssets: [{
            localAssetId: 'snapshot-local-1',
            assetId: 'llama/tester',
            kind: LocalAssetKind.CHAT,
            engine: 'llama',
            endpoint: 'http://127.0.0.1:11434',
            status: LocalAssetStatus.ACTIVE,
          }],
          runtimeLocalModels: [{
            localAssetId: 'runtime-local-1',
            assetId: 'llama/tester',
            kind: LocalAssetKind.CHAT,
            engine: 'llama',
            endpoint: 'http://127.0.0.1:11435',
            status: LocalAssetStatus.UNHEALTHY,
            capabilities: ['text.generate'],
          }],
        },
      };
    },
    onLocalStatusMismatch(mismatch: unknown) {
      mismatches.push(mismatch);
    },
  };

  const [first, second] = await Promise.all([
    listNimiRuntimeRouteOptionsWithHost({
      capability: 'chat',
      targetId: 'route-options',
      selectedTargetRef,
    }, deps),
    listNimiRuntimeRouteOptionsWithHost({
      capability: 'chat',
      targetId: 'route-options',
      selectedTargetRef,
    }, deps),
  ]);

  assert.deepEqual(first, second);
  assert.deepEqual(calls.sort(), ['connectors', 'local', 'models:cloud-1'].sort());
  assert.equal(first.capability, 'text.generate');
  assert.equal(first.selectedTargetRef, null);
  assert.equal(first.inventory.targets.some((item) => item.evidence.source === 'local-runtime'), false);
  assert.deepEqual(first.inventory.targets.map((item) => item.targetRef.kind === 'cloud-connector' ? item.targetRef.providerModelId : '').filter(Boolean), ['cloud-text']);
  assert.equal(mismatches.length, 0);

  const directProjection = buildNimiRuntimeRouteOptionsProjection({
    capability: 'image.generate',
    selectedTargetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: 'cloud-1',
      remoteModelCatalogId: 'remote-catalog:cloud-image',
      providerModelId: 'cloud-image',
      provider: 'tester',
    },
    connectors: [{
      descriptor: { id: 'cloud-1', label: 'Cloud', vendor: 'Nimi', provider: 'tester' },
      modelDescriptors: [
        {
          modelId: 'cloud-text',
          remoteModelCatalogId: 'remote-catalog:cloud-text',
          providerModelId: 'cloud-text',
          provider: 'tester',
          capabilities: ['text.generate'],
        },
        {
          modelId: 'cloud-image',
          remoteModelCatalogId: 'remote-catalog:cloud-image',
          providerModelId: 'cloud-image',
          provider: 'tester',
          capabilities: ['image.generate'],
        },
      ],
    }],
    runtimeLocalModels: [{
      localAssetId: 'removed-local',
      assetId: 'media/old-image',
      kind: LocalAssetKind.IMAGE,
      engine: 'diffusers',
      status: LocalAssetStatus.REMOVED,
      capabilities: ['image.generate'],
    }],
  });
  assert.equal(directProjection.selectedTargetRef?.kind, 'cloud-connector');
  assert.equal(directProjection.inventory.targets.some((item) => item.evidence.source === 'local-runtime'), false);
  assert.deepEqual(directProjection.inventory.targets.map((item) => item.compatibility.capabilities), [
    ['image.generate'],
  ]);
});

test('Runtime host route options do not promote companion-only image assets as primary targets', async () => {
  const deps = createNimiRuntimeRouteOptionsHostDeps({
    connectors: {
      async listConnectors() {
        return { connectors: [], nextPageToken: '' };
      },
      async listConnectorModels() {
        return { models: [], nextPageToken: '' };
      },
    },
    local: {
      async listLocalAssets() {
        return {
          assets: [localAssetRecord({
            localAssetId: 'local-ideogram4-uncond',
            assetId: 'local-import/ideogram4_uncond-Q4_0',
            kind: LocalAssetKind.IMAGE,
            engine: 'media',
            status: LocalAssetStatus.INSTALLED,
            capabilities: ['image.generate'],
            artifactRoles: ['uncond_diffusion_model'],
          })],
          nextPageToken: '',
        };
      },
    },
  });

  const snapshot = await listNimiRuntimeRouteOptionsWithHost({ capability: 'image.generate' }, deps);

  assert.equal(snapshot.inventory.targets.some((item) => item.evidence.source === 'local-runtime'), false);
});

test('Runtime route host access fails closed and caches local warmups', async () => {
  assert.deepEqual(buildNimiRuntimeRouteRequestMetadata({
    connectorId: 'cloud-1',
    traceId: 'trace-1',
  }), {
    traceId: 'trace-1',
    'x-nimi-trace-id': 'trace-1',
    keySource: 'managed',
  });
  const signal = new AbortController().signal;
  const callOptions = buildNimiRuntimeRouteTargetCallOptions({
    targetId: 'core.chat.agent',
    timeoutMs: 1000,
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    callerIdPrefix: 'route',
    connectorId: 'cloud-1',
    signal,
  });
  assert.equal(callOptions.signal, signal);
  assert.equal(callOptions.metadata?.callerId, 'route:core.chat.agent');
  assert.equal(callOptions.metadata?.keySource, 'managed');

  const unavailable = createNimiHostRuntimeRouteAccessSurface({
    appId: 'nimi.test',
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    getRuntime: () => null,
  });
  assert.throws(
    () => unavailable.getRuntimeClient(),
    (error: unknown) => {
      const record = error as { readonly reasonCode?: string; readonly source?: string };
      assert.equal(record.reasonCode, 'RUNTIME_UNAVAILABLE');
      assert.equal(record.source, 'runtime');
      return true;
    },
  );

  const warmCache = createNimiRuntimeRouteLocalWarmCache();
  const warmCalls: unknown[] = [];
  const stateChanges: string[] = [];
  const metrics: unknown[] = [];
  const surface = createNimiHostRuntimeRouteAccessSurface({
    appId: 'nimi.test',
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    warmCache,
    emitWarmMetric(metric) {
      metrics.push(metric);
    },
    getRuntime: () => ({
      connectors: {
        async testConnector() {
          throw new Error('connector offline');
        },
      },
      local: {
        async checkLocalAssetHealth(request) {
          if (request.localAssetId === 'throws-local') {
            throw new Error('local health failed');
          }
          return {
            assets: [{
              localAssetId: 'asset-local-1',
              status: LocalAssetStatus.UNHEALTHY,
              detail: 'provider missing',
              endpoint: 'http://127.0.0.1:11434',
              reasonCode: 0,
            }],
          };
        },
        async listLocalAssets() {
          return {
            assets: [localAssetRecord({ status: LocalAssetStatus.ACTIVE })],
            nextPageToken: '',
          };
        },
        async warmLocalAsset(request, options) {
          warmCalls.push({ request, options });
          return {};
        },
      },
    }),
  });

  const cloudHealth = await surface.checkLocalHealth({
    provider: 'tester',
    capability: 'text.generate',
    connectorId: 'cloud-1',
    localProviderModel: 'tester-model',
  });
  assert.equal(cloudHealth.status, 'unreachable');
  assert.equal(cloudHealth.detail, 'connector offline');

  const missingAckSurface = createNimiHostRuntimeRouteAccessSurface({
    appId: 'nimi.test',
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    getRuntime: () => ({
      connectors: {
        async testConnector() {
          return {};
        },
      },
      local: {
        async checkLocalAssetHealth() {
          return { assets: [] };
        },
        async listLocalAssets() {
          return { assets: [], nextPageToken: '' };
        },
        async warmLocalAsset() {
          return {};
        },
      },
    }),
  });
  const missingAckHealth = await missingAckSurface.checkLocalHealth({
    provider: 'tester',
    capability: 'text.generate',
    connectorId: 'cloud-1',
    localProviderModel: 'tester-model',
  });
  assert.equal(missingAckHealth.status, 'degraded');
  assert.equal(missingAckHealth.actionHint, 'verify_connector_health_ack');

  const unsupportedLocal = await surface.checkLocalHealth({
    provider: 'llama',
    capability: 'text.generate',
    localProviderModel: 'llama/tester',
  });
  assert.equal(unsupportedLocal.status, 'unsupported');
  assert.equal(unsupportedLocal.actionHint, 'resolve_runtime_route_binding');

  const unreachableLocal = await surface.checkLocalHealth({
    provider: 'llama',
    capability: 'text.generate',
    localProviderModel: 'llama/tester',
    localAssetId: 'throws-local',
  });
  assert.equal(unreachableLocal.status, 'unreachable');
  assert.equal(unreachableLocal.detail, 'local health failed');

  const resolved: NimiRuntimeResolvedBinding = {
    capability: 'text.generate',
    source: 'local-runtime',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:asset-local-1',
    },
    resolvedBindingRef: 'local:text.generate:local-runtime%3Aasset-local-1',
    model: 'llama/tester',
    modelId: 'llama/tester',
    provider: 'llama',
    engine: 'llama',
    localAssetId: 'asset-local-1',
  };
  await surface.ensureLocalModelWarm({
    targetId: 'core.chat.agent',
    resolvedBinding: resolved,
    onStateChange(state) {
      stateChanges.push(state);
    },
  });
  await surface.ensureLocalModelWarm({
    targetId: 'core.chat.agent',
    resolvedBinding: resolved,
  });
  assert.equal(warmCalls.length, 1);
  assert.deepEqual(stateChanges, ['warming', 'ready']);
  assert.equal(metrics.length, 1);

  resetNimiRuntimeRouteLocalWarmCache(warmCache);
  assert.equal(warmCache.warmedLocalModelKeys.size, 0);

  const noCandidateSurface = createNimiHostRuntimeRouteAccessSurface({
    appId: 'nimi.test',
    callerKind: 'desktop-core',
    surfaceId: 'desktop.test',
    getRuntime: () => ({
      connectors: {
        async testConnector() {
          return { ack: { ok: true } };
        },
      },
      local: {
        async checkLocalAssetHealth() {
          return { assets: [] };
        },
        async listLocalAssets() {
          return {
            assets: [localAssetRecord({ status: LocalAssetStatus.REMOVED })],
            nextPageToken: '',
          };
        },
        async warmLocalAsset() {
          throw new Error('should not warm');
        },
      },
    }),
  });
  await assert.rejects(
    () => noCandidateSurface.ensureLocalModelWarm({
      targetId: 'core.chat.agent',
      resolvedBinding: resolved,
    }),
    (error: unknown) => {
      const record = error as { readonly reasonCode?: string; readonly source?: string };
      assert.equal(record.reasonCode, 'AI_LOCAL_MODEL_UNAVAILABLE');
      assert.equal(record.source, 'runtime');
      return true;
    },
  );

  await noCandidateSurface.ensureLocalModelWarm({
    targetId: 'core.chat.agent',
    resolvedBinding: {
      ...resolved,
      source: 'cloud-connector',
      targetRef: {
        kind: 'cloud-connector',
        version: 'v2',
        connectorId: 'cloud-1',
        remoteModelCatalogId: 'remote-catalog:cloud-1',
        providerModelId: 'cloud-model',
        provider: 'tester',
      },
      connectorId: 'cloud-1',
      remoteModelCatalogId: 'remote-catalog:cloud-1',
      providerModelId: 'cloud-model',
      localAssetId: undefined,
    },
  });
});
