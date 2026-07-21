import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { setRuntimeLogger } from '@nimiplatform/kit/telemetry';
import { productionAppStore } from '../src/shell/renderer/app-shell/providers/production-app-store.js';
import {
  loadLocalRouteMetadata,
  loadRuntimeRouteOptions,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-options';
import type {
  NimiRuntimeRouteOptionsHostRuntime,
  NimiRuntimeRouteOptionsSnapshot,
  NimiRuntimeRouteTargetRef,
} from '@nimiplatform/sdk/runtime';

const __dirname = dirname(fileURLToPath(import.meta.url));
const initialRuntimeFields = { ...productionAppStore.getState().runtimeFields };
const initialAIConfig = productionAppStore.getState().aiConfig;
const routeOptionsRuntimeStub: NimiRuntimeRouteOptionsHostRuntime = {
  connectors: {
    listConnectors: async () => ({ connectors: [], nextPageToken: '' }),
    listConnectorModels: async () => ({ models: [], nextPageToken: '' }),
  },
  local: {
    listLocalAssets: async () => ({ assets: [], nextPageToken: '' }),
  },
};

function withRouteOptionsRuntime<T extends object>(
  deps: T,
): T & { readonly runtime: NimiRuntimeRouteOptionsHostRuntime } {
  return {
    runtime: routeOptionsRuntimeStub,
    ...deps,
  };
}

function localTargetRefFor(localAssetId: string): NimiRuntimeRouteTargetRef {
  return {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: `local-runtime:${localAssetId}`,
  };
}

function targetsBySource(
  options: NimiRuntimeRouteOptionsSnapshot,
  source: 'local-runtime' | 'cloud-connector',
) {
  return options.inventory.targets.filter((target) => target.evidence.source === source);
}

test.afterEach(() => {
  setRuntimeLogger(null);
  productionAppStore.setState({
    runtimeFields: { ...initialRuntimeFields },
    aiConfig: initialAIConfig,
  });
});

test('D-ERR-009: loadLocalRouteMetadata logs and rejects when local asset listing fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  await assert.rejects(
    () => loadLocalRouteMetadata('text.generate', {
      pollLocalSnapshotWithTimeout: async () => ({
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      }),
      listRuntimeLocalAssets: async () => {
        throw new Error('local runtime offline');
      },
    }),
    (error: unknown) => {
      const record = error as { reasonCode?: string; actionHint?: string };
      assert.equal(record.reasonCode, 'RUNTIME_UNAVAILABLE');
      assert.equal(record.actionHint, 'check_runtime_daemon_health');
      return true;
    },
  );

  const failedLog = logs.find((entry) => entry.message === 'action:list-runtime-local-models:failed');
  assert.ok(failedLog, 'list-runtime-local-models failure must emit a warn log');
  assert.equal(failedLog?.level, 'warn');
  assert.equal(failedLog?.area, 'route-options');
  assert.equal((failedLog?.details as Record<string, unknown>)?.error, 'local runtime offline');
});

test('D-ERR-009: loadLocalRouteMetadata logs and rejects when listRuntimeLocalAssets fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  await assert.rejects(
    () => loadLocalRouteMetadata('audio.synthesize', {
      pollLocalSnapshotWithTimeout: async () => ({
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      }),
      listRuntimeLocalAssets: async () => {
        throw new Error('go runtime unavailable');
      },
    }),
    /go runtime unavailable/,
  );

  const failedLog = logs.find((entry) => entry.message === 'action:list-runtime-local-models:failed');
  assert.ok(failedLog, 'list-runtime-local-models failure must emit a warn log');
  assert.equal((failedLog?.details as Record<string, unknown>)?.error, 'go runtime unavailable');
});

test('loadLocalRouteMetadata starts snapshot and local asset reads in parallel', async () => {
  let releaseSnapshot: (() => void) | null = null;
  let assetsStarted = false;

  const metadataPromise = loadLocalRouteMetadata('text.generate', {
    pollLocalSnapshotWithTimeout: () => new Promise((resolve) => {
      releaseSnapshot = () => resolve({
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      });
    }),
    listRuntimeLocalAssets: async () => {
      assetsStarted = true;
      return [];
    },
  });

  await Promise.resolve();
  assert.equal(assetsStarted, true);

  const triggerSnapshot = releaseSnapshot;
  if (!triggerSnapshot) {
    throw new Error('expected snapshot resolver to be registered');
  }
  (triggerSnapshot as () => void)();
  const metadata = await metadataPromise;
  assert.equal(metadata.nodeCatalog.length, 0);
  assert.equal(metadata.runtimeLocalModels.length, 0);
});

test('D-ERR-009: loadRuntimeRouteOptions degrades gracefully when local metadata times out', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  productionAppStore.setState({
    runtimeFields: {
      ...productionAppStore.getState().runtimeFields,
    },
    aiConfig: {
      ...initialAIConfig,
      capabilities: {
        targetRefs: {},
        selectedParams: {},
      },
    },
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    targetId: 'world.nimi.test-ai',
    selectedTargetRef: localTargetRefFor('local-model'),
  }, withRouteOptionsRuntime({
    listConnectors: async () => ([
      {
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
        vendor: 'gpt',
        endpoint: 'https://api.openai.com/v1',
        hasCredential: true,
        isSystemOwned: false,
        scope: 'user',
        models: ['gpt-4.1-mini'],
        status: 'healthy',
        lastCheckedAt: null,
        lastDetail: '',
      },
    ]),
    listConnectorModelDescriptors: async () => ([
      {
        modelId: 'gpt-4.1-mini',
        remoteModelCatalogId: 'remote-catalog:connector-openai:gpt-4.1-mini',
        providerModelId: 'gpt-4.1-mini',
        provider: 'openai',
        available: true,
        capabilities: ['text.generate'],
      },
    ]),
    loadLocalRouteMetadata: async () => {
      throw new Error('local runtime snapshot timed out after 3500ms');
    },
  }));

  assert.equal(targetsBySource(options, 'local-runtime').length, 0);
  assert.equal(targetsBySource(options, 'cloud-connector').length, 1);
  assert.equal(options.inventory.targets[0]?.targetRef.kind, 'cloud-connector');
  assert.equal(options.selectedTargetRef, null);
  assert.equal('resolvedDefault' in options, false);

  const degradedLog = logs.find((entry) => entry.message === 'action:load-local-route-metadata:degraded');
  assert.ok(degradedLog, 'local metadata timeout should emit a degrade log instead of rejecting the dialog');
  assert.equal(degradedLog?.level, 'warn');
  assert.equal((degradedLog?.details as Record<string, unknown>)?.error, 'local runtime snapshot timed out after 3500ms');
});

test('loadRuntimeRouteOptions does not treat desktop snapshot-only local models as authoritative route truth', async () => {
  productionAppStore.setState({
    runtimeFields: {
      ...productionAppStore.getState().runtimeFields,
    },
    aiConfig: {
      ...initialAIConfig,
      capabilities: {
        targetRefs: {},
        selectedParams: {},
      },
    },
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    targetId: 'world.nimi.test-ai',
    selectedTargetRef: localTargetRefFor('desktop-local-1'),
  }, withRouteOptionsRuntime({
    listConnectors: async () => ([]),
    listConnectorModelDescriptors: async () => ([]),
    loadLocalRouteMetadata: async () => ({
      snapshot: {
        assets: [{
          localAssetId: 'desktop-local-1',
          assetId: 'local/local-import/Qwen3-4B-Q4_K_M',
          kind: 'chat' as const,
          engine: 'llama',
          entry: '',
          files: [],
          license: '',
          source: { repo: '', revision: '' },
          integrityMode: 'verified' as const,
          hashes: {},
          capabilities: ['chat', 'text.generate'],
          status: 'active' as const,
          installedAt: '',
          updatedAt: '',
        }],
        health: [],
        generatedAt: new Date().toISOString(),
      },
      nodeCatalog: [{
        provider: 'llama',
        adapter: 'llama_native_adapter',
        providerHints: {
          extra: {
            local_default_rank: 0,
          },
        },
      }] as never[],
      runtimeLocalModels: [],
    }),
  }));

  assert.equal(options.inventory.targets.length, 0);
  assert.deepEqual(options.selectedTargetRef, localTargetRefFor('desktop-local-1'));
});

test('runtime route options bootstrap does not own projection heuristics or endpoint fallback', () => {
  const source = readFileSync(
    resolve(__dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-options.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /\bfallbackLocalEngine\b/);
  assert.doesNotMatch(source, /\binferLocalEngine\b/);
  assert.doesNotMatch(source, /\bproviderDefaultRank\b/);
  assert.doesNotMatch(source, /\bsyncLookup\b/);
  assert.doesNotMatch(source, /localRuntime\.health\(/);
  assert.doesNotMatch(source, /runtimeFields\.localProviderEndpoint/);
  assert.doesNotMatch(source, /runtimeFields\.localOpenAiEndpoint/);
});

test('loadRuntimeRouteOptions fetches connector descriptors in parallel', async () => {
  const descriptorResolvers = new Map<string, () => void>();
  const descriptorCalls: string[] = [];

  const optionsPromise = loadRuntimeRouteOptions({
    capability: 'text.generate',
    targetId: 'world.nimi.parallel-route-options',
  }, withRouteOptionsRuntime({
    listConnectors: async () => ([
      {
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
      },
      {
        id: 'connector-anthropic',
        label: 'Anthropic',
        provider: 'anthropic',
      },
    ] as never[]),
    listConnectorModelDescriptors: (async (connectorId: string) => {
      descriptorCalls.push(connectorId);
      return await new Promise((resolve) => {
        descriptorResolvers.set(connectorId, () => resolve([
          {
            modelId: `${connectorId}-model`,
            remoteModelCatalogId: `remote-catalog:${connectorId}:${connectorId}-model`,
            providerModelId: `${connectorId}-model`,
            provider: connectorId.replace(/^connector-/u, ''),
            available: true,
            capabilities: ['text.generate'],
          },
        ]));
      });
    }) as never,
    loadLocalRouteMetadata: async () => ({
      snapshot: {
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      },
      nodeCatalog: [],
      runtimeLocalModels: [],
    }),
  }));

  for (let attempt = 0; attempt < 20 && descriptorCalls.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(
    [...descriptorCalls].sort(),
    ['connector-anthropic', 'connector-openai'],
  );

  descriptorResolvers.get('connector-openai')?.();
  descriptorResolvers.get('connector-anthropic')?.();

  const options = await optionsPromise;
  assert.equal(targetsBySource(options, 'cloud-connector').length, 2);
});

test('loadRuntimeRouteOptions dedupes concurrent capability reads within the same deps scope', async () => {
  let connectorListCalls = 0;
  let descriptorCalls = 0;
  let localMetadataCalls = 0;
  const deps = {
    runtime: routeOptionsRuntimeStub,
    listConnectors: async () => {
      connectorListCalls += 1;
      return ([
        {
          id: 'connector-openai',
          label: 'OpenAI',
          provider: 'openai',
        },
      ] as never[]);
    },
    listConnectorModelDescriptors: (async () => {
      descriptorCalls += 1;
      return ([
        {
          modelId: 'gpt-4.1-mini',
          remoteModelCatalogId: 'remote-catalog:connector-openai:gpt-4.1-mini',
          providerModelId: 'gpt-4.1-mini',
          provider: 'openai',
          available: true,
          capabilities: ['text.generate'],
        },
      ] as never[]);
    }) as never,
    loadLocalRouteMetadata: async () => {
      localMetadataCalls += 1;
      return {
        snapshot: {
          assets: [],
          health: [],
          generatedAt: new Date().toISOString(),
        },
        nodeCatalog: [],
        runtimeLocalModels: [],
      };
    },
  };

  const [left, right] = await Promise.all([
    loadRuntimeRouteOptions({ capability: 'text.generate', targetId: 'world.nimi.same' }, deps),
    loadRuntimeRouteOptions({ capability: 'text.generate', targetId: 'world.nimi.same' }, deps),
  ]);

  assert.equal(connectorListCalls, 1);
  assert.equal(descriptorCalls, 1);
  assert.equal(localMetadataCalls, 1);
  assert.equal(targetsBySource(left, 'cloud-connector').length, 1);
  assert.equal(targetsBySource(right, 'cloud-connector').length, 1);
});

test('loadRuntimeRouteOptions preserves local models when connector listing fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    targetId: 'world.nimi.local-only',
  }, withRouteOptionsRuntime({
    listConnectors: async () => {
      throw new Error('dynamic provider catalog offline');
    },
    listConnectorModelDescriptors: async () => ([]),
    loadLocalRouteMetadata: async () => ({
      snapshot: {
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      },
      nodeCatalog: [{
        provider: 'llama',
        providerHints: {
          extra: {
            local_default_rank: 0,
          },
        },
      }] as never[],
      runtimeLocalModels: [{
        localAssetId: '01KLOCALCHAT',
        assetId: 'local/Qwen3-4B-Q4_K_M',
        kind: 'chat',
        engine: 'llama',
        entry: 'Qwen3-4B-Q4_K_M.gguf',
        files: ['Qwen3-4B-Q4_K_M.gguf'],
        license: 'apache-2.0',
        source: { repo: 'qwen/qwen3', revision: 'main' },
        integrityMode: 'verified',
        hashes: {},
        status: 'active',
        installedAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z',
        endpoint: 'http://127.0.0.1:1234/v1',
        capabilities: ['text.generate'],
        engineConfig: {},
      }] as never[],
    }),
  }));

  const localTargets = targetsBySource(options, 'local-runtime');
  assert.equal(localTargets.length, 1);
  assert.equal(localTargets[0]?.evidence.source, 'local-runtime');
  if (localTargets[0]?.evidence.source === 'local-runtime') {
    assert.equal(localTargets[0].evidence.localAssetId, '01KLOCALCHAT');
  }
  assert.equal(targetsBySource(options, 'cloud-connector').length, 0);

  const degradedLog = logs.find((entry) => entry.message === 'action:list-connectors:degraded');
  assert.ok(degradedLog, 'connector list failure should emit a degrade log');
  assert.equal((degradedLog?.details as Record<string, unknown>)?.error, 'dynamic provider catalog offline');
});

test('loadRuntimeRouteOptions preserves local models when connector model discovery fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    targetId: 'world.nimi.local-only',
  }, withRouteOptionsRuntime({
    listConnectors: async () => ([
      {
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
      },
    ] as never[]),
    listConnectorModelDescriptors: async () => {
      throw new Error('dynamic provider model discovery failed');
    },
    loadLocalRouteMetadata: async () => ({
      snapshot: {
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      },
      nodeCatalog: [{
        provider: 'llama',
        providerHints: {
          extra: {
            local_default_rank: 0,
          },
        },
      }] as never[],
      runtimeLocalModels: [{
        localAssetId: '01KLOCALCHAT',
        assetId: 'local/Qwen3-4B-Q4_K_M',
        kind: 'chat',
        engine: 'llama',
        entry: 'Qwen3-4B-Q4_K_M.gguf',
        files: ['Qwen3-4B-Q4_K_M.gguf'],
        license: 'apache-2.0',
        source: { repo: 'qwen/qwen3', revision: 'main' },
        integrityMode: 'verified',
        hashes: {},
        status: 'active',
        installedAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z',
        endpoint: 'http://127.0.0.1:1234/v1',
        capabilities: ['text.generate'],
        engineConfig: {},
      }] as never[],
    }),
  }));

  assert.equal(targetsBySource(options, 'local-runtime').length, 1);
  assert.equal(targetsBySource(options, 'cloud-connector').length, 0);

  const degradedLog = logs.find((entry) => entry.message === 'action:list-connector-model-descriptors:degraded');
  assert.ok(degradedLog, 'connector model discovery failure should emit a degrade log');
  assert.equal((degradedLog?.details as Record<string, unknown>)?.error, 'dynamic provider model discovery failed');
});
