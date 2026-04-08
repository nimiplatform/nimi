import assert from 'node:assert/strict';
import test from 'node:test';

import { createModRuntimeClient } from '../../src/mod/runtime/index.js';
import { clearModSdkHost } from '../../src/mod/host.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-facade.js';

test('mod runtime client scheduler.peek forwards repeated scheduling targets', async () => {
  clearModSdkHost();

  const peekCalls: Array<Record<string, unknown>> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    route: {
      listOptions: async () => ({ capability: 'text.generate' as const, selected: null, local: { models: [] }, connectors: [] }),
      resolve: async () => { throw new Error('not implemented'); },
      checkHealth: async () => ({ healthy: true, status: 'healthy' as const, detail: 'ok' }),
      describe: async () => { throw new Error('not implemented'); },
    },
    scheduler: {
      peek: async (input: Record<string, unknown>) => {
        peekCalls.push(input);
        return {
          occupancy: { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 },
          aggregateJudgement: {
            state: 'queue_required',
            detail: 'slots occupied',
            occupancy: { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 },
            resourceWarnings: [],
          },
          targetJudgements: [],
        };
      },
    },
    local: {
      listAssets: async () => [],
      listProfiles: async () => [],
      requestProfileInstall: async () => { throw new Error('not implemented'); },
      getProfileInstallStatus: async () => { throw new Error('not implemented'); },
    },
    ai: {
      text: {
        generate: async () => { throw new Error('not implemented'); },
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
        submit: async () => ({} as never),
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
      modId: 'mod.scheduler.test',
      status: 'ready' as const,
      routeSource: 'local' as const,
      warnings: [],
      entries: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const client = createModRuntimeClient('mod.scheduler.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const result = await client.scheduler.peek({
    appId: 'desktop',
    targets: [
      { capability: 'text.generate', modId: 'core:runtime', profileId: 'text-local' },
      { capability: 'image.generate', modId: 'core:runtime', profileId: 'image-local' },
    ],
  });

  assert.equal(peekCalls.length, 1);
  assert.deepEqual(peekCalls[0]?.targets, [
    { capability: 'text.generate', modId: 'core:runtime', profileId: 'text-local' },
    { capability: 'image.generate', modId: 'core:runtime', profileId: 'image-local' },
  ]);
  assert.equal(result.aggregateJudgement?.state, 'queue_required');
  assert.deepEqual(result.occupancy, { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 });
});
