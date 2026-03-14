import assert from 'node:assert/strict';
import test from 'node:test';

import { createModRuntimeClient } from '../../src/mod/runtime/index.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-facade.js';
import { ReasonCode } from '../../src/types/index.js';

test('mod runtime client forwards local profile methods with mod id', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    getModLocalProfileSnapshot: async () => ({
      modId: 'mod.profile.test',
      status: 'ready' as const,
      routeSource: 'local' as const,
      warnings: [],
      entries: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
    route: {
      listOptions: async () => ({ capability: 'image.generate' as const, selected: { source: 'local' as const, connectorId: '', model: 'image-model' }, local: { models: [] }, connectors: [] }),
      resolve: async () => ({ capability: 'image.generate' as const, source: 'local' as const, provider: 'localai', model: 'image-model', connectorId: '' }),
      checkHealth: async () => ({ status: 'healthy' as const, healthy: true, provider: 'localai', actionHint: 'none', reasonCode: ReasonCode.RUNTIME_ROUTE_HEALTHY }),
    },
    local: {
      listArtifacts: async () => [],
      listProfiles: async (input: Record<string, unknown>) => {
        calls.push({ method: 'listProfiles', ...input });
        return [{
          id: 'balanced-fast',
          title: 'Balanced Fast',
          recommended: true,
          consumeCapabilities: ['image'],
          entries: [],
        }];
      },
      requestProfileInstall: async (input: Record<string, unknown>) => {
        calls.push({ method: 'requestProfileInstall', ...input });
        return {
          modId: 'mod.profile.test',
          profileId: String(input.profileId || ''),
          accepted: true,
          declined: false,
          warnings: [],
        };
      },
      getProfileInstallStatus: async (input: Record<string, unknown>) => {
        calls.push({ method: 'getProfileInstallStatus', ...input });
        return {
          modId: 'mod.profile.test',
          profileId: String(input.profileId || ''),
          status: 'ready' as const,
          warnings: [],
          missingEntries: [],
          updatedAt: new Date(0).toISOString(),
        };
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
  };

  const client = createModRuntimeClient('mod.profile.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const profiles = await client.local.listProfiles();
  const request = await client.local.requestProfileInstall({
    profileId: 'balanced-fast',
    capability: 'image.generate',
  });
  const status = await client.local.getProfileInstallStatus({
    profileId: 'balanced-fast',
    capability: 'image.generate',
  });

  assert.equal(profiles[0]?.id, 'balanced-fast');
  assert.equal(request.accepted, true);
  assert.equal(status.status, 'ready');
  assert.deepEqual(calls.map((item) => item.method), [
    'listProfiles',
    'requestProfileInstall',
    'getProfileInstallStatus',
  ]);
  assert.equal(calls[0]?.modId, 'mod.profile.test');
  assert.equal(calls[1]?.profileId, 'balanced-fast');
  assert.equal(calls[1]?.capability, 'image.generate');
  assert.equal(calls[2]?.capability, 'image.generate');
});
