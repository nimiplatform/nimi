import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { setRuntimeLogger } from '../src/runtime/telemetry/logger.js';
import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';
import {
  loadLocalRouteMetadata,
  loadRuntimeRouteOptions,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-options';

const SETTINGS_DEVELOPER_PAGE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/settings/settings-developer-page.tsx',
);
const settingsDeveloperPageSource = readFileSync(SETTINGS_DEVELOPER_PAGE_PATH, 'utf8');
const initialRuntimeFields = { ...useAppStore.getState().runtimeFields };

test.afterEach(() => {
  setRuntimeLogger(null);
  useAppStore.setState({
    runtimeFields: { ...initialRuntimeFields },
    aiConfig: createEmptyAIConfig(),
  });
});

test('D-ERR-009: loadLocalRouteMetadata logs and rejects when listNodesCatalog fails', async () => {
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
      listNodesCatalog: async () => {
        throw new Error('catalog offline');
      },
      listRuntimeLocalAssets: async () => [],
    }),
    (error: unknown) => {
      const record = error as { reasonCode?: string; actionHint?: string };
      assert.equal(record.reasonCode, 'RUNTIME_UNAVAILABLE');
      assert.equal(record.actionHint, 'check_runtime_daemon_health');
      return true;
    },
  );

  const failedLog = logs.find((entry) => entry.message === 'action:list-nodes-catalog:failed');
  assert.ok(failedLog, 'list-nodes-catalog failure must emit a warn log');
  assert.equal(failedLog?.level, 'warn');
  assert.equal(failedLog?.area, 'route-options');
  assert.equal((failedLog?.details as Record<string, unknown>)?.error, 'catalog offline');
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
      listNodesCatalog: async () => [],
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

test('loadLocalRouteMetadata starts snapshot, node catalog, and local asset reads in parallel', async () => {
  let releaseSnapshot: (() => void) | null = null;
  let nodeStarted = false;
  let assetsStarted = false;

  const metadataPromise = loadLocalRouteMetadata('text.generate', {
    pollLocalSnapshotWithTimeout: () => new Promise((resolve) => {
      releaseSnapshot = () => resolve({
        assets: [],
        health: [],
        generatedAt: new Date().toISOString(),
      });
    }),
    listNodesCatalog: async () => {
      nodeStarted = true;
      return [];
    },
    listRuntimeLocalAssets: async () => {
      assetsStarted = true;
      return [];
    },
  });

  await Promise.resolve();
  assert.equal(nodeStarted, true);
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

test('D-ERR-009: settings developer page no longer uses silent empty catch', () => {
  assert.ok(
    !settingsDeveloperPageSource.includes('.catch(() => {})'),
    'settings developer page must not use silent .catch(() => {})',
  );
  assert.match(
    settingsDeveloperPageSource,
    /logRendererEvent\(\{/,
    'settings developer page should emit a renderer warning when getRuntimeModStorageDirs fails',
  );
});

test('D-ERR-009: loadRuntimeRouteOptions degrades gracefully when local metadata times out', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  useAppStore.setState({
    runtimeFields: {
      ...useAppStore.getState().runtimeFields,
    },
    aiConfig: {
      ...createEmptyAIConfig(),
      capabilities: {
        selectedBindings: {
          'text.generate': {
            source: 'local',
            connectorId: '',
            model: 'local-model',
            modelId: 'local-model',
            provider: 'localai',
            engine: 'llama',
          },
        },
        localProfileRefs: {},
        selectedParams: {},
      },
    },
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    modId: 'world.nimi.test-ai',
  }, {
    sdkListConnectors: async () => ([
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
    sdkListConnectorModelDescriptors: async () => ([
      {
        modelId: 'gpt-4.1-mini',
        capabilities: ['text.generate'],
      },
    ]),
    loadLocalRouteMetadata: async () => {
      throw new Error('local runtime snapshot timed out after 3500ms');
    },
  });

  assert.equal(options.local.models.length, 0);
  assert.equal(options.connectors.length, 1);
  assert.equal(options.connectors[0]?.id, 'connector-openai');
  assert.ok(options.selected);
  assert.equal(options.selected.source, 'local');
  assert.equal(options.selected.model, 'local-model');
  assert.equal(options.resolvedDefault?.source, 'local');

  const degradedLog = logs.find((entry) => entry.message === 'action:load-local-route-metadata:degraded');
  assert.ok(degradedLog, 'local metadata timeout should emit a degrade log instead of rejecting the dialog');
  assert.equal(degradedLog?.level, 'warn');
  assert.equal((degradedLog?.details as Record<string, unknown>)?.error, 'local runtime snapshot timed out after 3500ms');
});

test('loadRuntimeRouteOptions does not treat desktop snapshot-only local models as authoritative route truth', async () => {
  useAppStore.setState({
    runtimeFields: {
      ...useAppStore.getState().runtimeFields,
    },
    aiConfig: {
      ...createEmptyAIConfig(),
      capabilities: {
        selectedBindings: {
          'text.generate': {
            source: 'local',
            connectorId: '',
            model: 'local/local-import/Qwen3-4B-Q4_K_M',
            modelId: 'local/local-import/Qwen3-4B-Q4_K_M',
            provider: 'local',
            engine: 'llama',
            endpoint: 'http://127.0.0.1:1234/v1',
          },
        },
        localProfileRefs: {},
        selectedParams: {},
      },
    },
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    modId: 'world.nimi.test-ai',
  }, {
    sdkListConnectors: async () => ([]),
    sdkListConnectorModelDescriptors: async () => ([]),
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
  });

  assert.equal(options.local.models.length, 0);
  assert.ok(options.selected);
  assert.equal(options.selected.source, 'local');
  assert.equal(options.selected.modelId, 'local-import/Qwen3-4B-Q4_K_M');
  assert.equal(options.selected.goRuntimeStatus, 'unavailable');
});

test('loadRuntimeRouteOptions fetches connector descriptors in parallel', async () => {
  const descriptorResolvers = new Map<string, () => void>();
  const descriptorCalls: string[] = [];

  const optionsPromise = loadRuntimeRouteOptions({
    capability: 'text.generate',
    modId: 'world.nimi.parallel-route-options',
  }, {
    sdkListConnectors: async () => ([
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
    sdkListConnectorModelDescriptors: (async (connectorId: string) => {
      descriptorCalls.push(connectorId);
      return await new Promise((resolve) => {
        descriptorResolvers.set(connectorId, () => resolve([
          {
            modelId: `${connectorId}-model`,
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
  });

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
  assert.equal(options.connectors.length, 2);
});

test('loadRuntimeRouteOptions dedupes concurrent capability reads within the same deps scope', async () => {
  let connectorListCalls = 0;
  let descriptorCalls = 0;
  let localMetadataCalls = 0;
  const deps = {
    sdkListConnectors: async () => {
      connectorListCalls += 1;
      return ([
        {
          id: 'connector-openai',
          label: 'OpenAI',
          provider: 'openai',
        },
      ] as never[]);
    },
    sdkListConnectorModelDescriptors: (async () => {
      descriptorCalls += 1;
      return ([
        {
          modelId: 'gpt-4.1-mini',
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
    loadRuntimeRouteOptions({ capability: 'text.generate', modId: 'world.nimi.one' }, deps),
    loadRuntimeRouteOptions({ capability: 'text.generate', modId: 'world.nimi.two' }, deps),
  ]);

  assert.equal(connectorListCalls, 1);
  assert.equal(descriptorCalls, 1);
  assert.equal(localMetadataCalls, 1);
  assert.equal(left.connectors.length, 1);
  assert.equal(right.connectors.length, 1);
});

test('loadRuntimeRouteOptions preserves local models when connector listing fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    modId: 'world.nimi.local-only',
  }, {
    sdkListConnectors: async () => {
      throw new Error('dynamic provider catalog offline');
    },
    sdkListConnectorModelDescriptors: async () => ([]),
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
  });

  assert.equal(options.local.models.length, 1);
  assert.equal(options.local.models[0]?.localModelId, '01KLOCALCHAT');
  assert.equal(options.connectors.length, 0);

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
    modId: 'world.nimi.local-only',
  }, {
    sdkListConnectors: async () => ([
      {
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
      },
    ] as never[]),
    sdkListConnectorModelDescriptors: async () => {
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
  });

  assert.equal(options.local.models.length, 1);
  assert.equal(options.connectors.length, 0);

  const degradedLog = logs.find((entry) => entry.message === 'action:list-connector-model-descriptors:degraded');
  assert.ok(degradedLog, 'connector model discovery failure should emit a degrade log');
  assert.equal((degradedLog?.details as Record<string, unknown>)?.error, 'dynamic provider model discovery failed');
});
