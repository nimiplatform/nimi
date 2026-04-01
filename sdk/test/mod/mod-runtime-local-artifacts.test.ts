import assert from 'node:assert/strict';
import test from 'node:test';

import { clearModSdkHost } from '../../src/mod/host.js';
import { createModRuntimeClient } from '../../src/mod/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-facade.js';

test('mod runtime client forwards local asset listing with mod id and filters', async () => {
  clearModSdkHost();

  const assetCalls: Array<Record<string, unknown>> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    route: {
      listOptions: async () => ({
        capability: 'image.generate' as const,
        selected: {
          source: 'local' as const,
          connectorId: '',
          model: 'z-image',
        },
        local: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'image.generate' as const,
        source: 'local' as const,
        provider: 'media',
        model: 'z-image',
        connectorId: '',
      }),
      checkHealth: async () => ({
        status: 'healthy' as const,
        healthy: true,
        provider: 'media',
        reasonCode: ReasonCode.RUNTIME_ROUTE_HEALTHY,
        actionHint: 'none',
      }),
    },
    local: {
      listAssets: async (input: Record<string, unknown>) => {
        assetCalls.push(input);
        return [{
          localAssetId: 'asset-1',
          assetId: 'z-image-ae',
          kind: 'vae',
          engine: 'media',
          entry: 'ae.safetensors',
          files: ['ae.safetensors'],
          license: 'apache-2.0',
          source: {
            repo: 'Tongyi-MAI/Z-Image',
            revision: 'main',
          },
          hashes: {},
          status: 'installed',
          installedAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        }];
      },
    },
    ai: {
      text: {
        generate: async () => ({ text: '', finishReason: 'stop', usage: {}, trace: {} }),
        stream: async () => ({ stream: (async function* noop() {})() }),
      },
      embedding: {
        generate: async () => ({ vectors: [], usage: {}, trace: {} }),
      },
    },
    media: {
      image: {
        generate: async () => ({ job: {} as never, artifacts: [], trace: {} }),
        stream: async () => (async function* noop() {})(),
      },
      video: {
        generate: async () => ({ job: {} as never, artifacts: [], trace: {} }),
        stream: async () => (async function* noop() {})(),
      },
      tts: {
        synthesize: async () => ({ job: {} as never, artifacts: [], trace: {} }),
        stream: async () => (async function* noop() {})(),
        listVoices: async () => ({ voices: [], trace: {} }),
      },
      stt: {
        transcribe: async () => ({ text: '', segments: [], usage: {}, trace: {} }),
      },
      jobs: {
        get: async () => ({} as never),
        cancel: async () => ({} as never),
        subscribe: async () => (async function* noop() {})(),
        getArtifacts: async () => ({ artifacts: [] }),
      },
    },
    voice: {
      getAsset: async () => ({} as never),
      listAssets: async () => ({} as never),
      deleteAsset: async () => ({} as never),
      listPresetVoices: async () => ({} as never),
    },
    getModLocalProfileSnapshot: async () => ({
      modId: 'mod.local.artifacts.test',
      status: 'ready' as const,
      routeSource: 'local' as const,
      warnings: [],
      entries: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const client = createModRuntimeClient('mod.local.artifacts.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const assets = await client.local.listAssets({
    kind: 'vae',
    engine: 'media',
  });

  assert.equal(assetCalls.length, 1);
  assert.deepEqual(assetCalls[0], {
    modId: 'mod.local.artifacts.test',
    kind: 'vae',
    engine: 'media',
  });
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.assetId, 'z-image-ae');
});
