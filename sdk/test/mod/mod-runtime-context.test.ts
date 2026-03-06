import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import { createModRuntimeClient } from '../../src/mod/runtime/index.js';
import { createModRuntimeInspector } from '../../src/mod/runtime/inspector.js';
import { clearModSdkHost } from '../../src/mod/host.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-hook/runtime-facade.js';

test('mod runtime client uses injected runtime context without global host', async () => {
  clearModSdkHost();

  const routeResolveCalls: Array<Record<string, unknown>> = [];
  const textCalls: Array<Record<string, unknown>> = [];

  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    route: {
      listOptions: async () => ({
        capability: 'text.generate' as const,
        selected: {
          source: 'local-runtime' as const,
          connectorId: '',
          model: 'qwen2.5',
        },
        localRuntime: { models: [] },
        connectors: [],
      }),
      resolve: async (input: Record<string, unknown>) => {
        routeResolveCalls.push(input);
        return {
          capability: 'text.generate' as const,
          source: 'local-runtime' as const,
          provider: 'localai',
          model: 'qwen2.5',
          connectorId: '',
          localModelId: 'qwen2.5',
          engine: 'localai',
          endpoint: 'http://127.0.0.1:11434/v1',
          localProviderEndpoint: 'http://127.0.0.1:11434/v1',
          localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        };
      },
      checkHealth: async () => ({
        status: 'healthy' as const,
        healthy: true,
        provider: 'localai',
        reasonCode: ReasonCode.RUNTIME_ROUTE_HEALTHY,
        actionHint: 'none',
      }),
    },
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          textCalls.push(input);
          return {
            text: 'hello',
            finishReason: 'stop',
            usage: {},
            trace: { traceId: 'trace-mod-context' },
          };
        },
        stream: async () => ({ stream: (async function* noop() {})() }),
      },
      embedding: {
        generate: async () => ({
          vectors: [],
          usage: {},
          trace: {},
        }),
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
    getModAiDependencySnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready' as const,
      routeSource: 'local-runtime' as const,
      warnings: [],
      dependencies: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const client = createModRuntimeClient('mod.context.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const result = await client.ai.text.generate({
    input: 'hello',
  });

  assert.equal(result.text, 'hello');
  assert.equal(routeResolveCalls.length, 0);
  assert.equal(textCalls.length, 1);
  assert.equal(textCalls[0]?.modId, 'mod.context.test');
  assert.equal(textCalls[0]?.input, 'hello');
});

test('mod runtime client route health uses injected runtime context', async () => {
  clearModSdkHost();

  const routeHealthCalls: Array<Record<string, unknown>> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    route: {
      listOptions: async () => ({
        capability: 'text.generate' as const,
        selected: {
          source: 'local-runtime' as const,
          connectorId: '',
          model: 'qwen2.5',
        },
        localRuntime: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'text.generate' as const,
        source: 'local-runtime' as const,
        provider: 'localai',
        model: 'qwen2.5',
        connectorId: '',
        localModelId: 'qwen2.5',
        engine: 'localai',
        endpoint: 'http://127.0.0.1:11434/v1',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      }),
      checkHealth: async (input: Record<string, unknown>) => {
        routeHealthCalls.push(input);
        return {
          status: 'healthy',
          healthy: true,
          provider: 'localai',
          reasonCode: ReasonCode.RUNTIME_ROUTE_HEALTHY,
          actionHint: 'none',
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
    getModAiDependencySnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready' as const,
      routeSource: 'local-runtime' as const,
      warnings: [],
      dependencies: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const client = createModRuntimeClient('mod.context.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const routeHealth = await client.route.checkHealth({
    capability: 'text.generate',
  });
  assert.equal(routeHealth.reasonCode, ReasonCode.RUNTIME_ROUTE_HEALTHY);
  assert.equal(routeHealth.actionHint, 'none');
  assert.equal(routeHealthCalls.length, 1);
  assert.equal(routeHealthCalls[0]?.modId, 'mod.context.test');
  assert.equal(routeHealthCalls[0]?.capability, 'text.generate');
});

test('mod runtime inspector forwards canonical dependency capability tokens', async () => {
  clearModSdkHost();

  const snapshotCalls: Array<Record<string, unknown>> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    route: {
      listOptions: async () => ({
        capability: 'text.generate' as const,
        selected: {
          source: 'local-runtime' as const,
          connectorId: '',
          model: 'qwen2.5',
        },
        localRuntime: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'text.generate' as const,
        source: 'local-runtime' as const,
        provider: 'localai',
        model: 'qwen2.5',
        connectorId: '',
        localModelId: 'qwen2.5',
        engine: 'localai',
        endpoint: 'http://127.0.0.1:11434/v1',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      }),
      checkHealth: async () => ({
        status: 'healthy',
        healthy: true,
        provider: 'localai',
        reasonCode: ReasonCode.RUNTIME_ROUTE_HEALTHY,
        actionHint: 'none',
      }),
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
    getModAiDependencySnapshot: async (input: Record<string, unknown>) => {
      snapshotCalls.push(input);
      return {
        modId: 'mod.context.test',
        status: 'ready' as const,
        routeSource: 'local-runtime' as const,
        warnings: [],
        dependencies: [],
        repairActions: [],
        updatedAt: new Date(0).toISOString(),
      };
    },
  };

  const inspector = createModRuntimeInspector('mod.context.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  await inspector.getDependencySnapshot('audio.synthesize', 'local-runtime');

  assert.equal(snapshotCalls.length, 1);
  assert.equal(snapshotCalls[0]?.modId, 'mod.context.test');
  assert.equal(snapshotCalls[0]?.capability, 'audio.synthesize');
  assert.equal(snapshotCalls[0]?.routeSourceHint, 'local-runtime');
});

test('mod runtime client image.generate keeps minimal payload', async () => {
  clearModSdkHost();

  const imageCalls: Array<Record<string, unknown>> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    route: {
      listOptions: async () => ({
        capability: 'image.generate' as const,
        selected: {
          source: 'local-runtime' as const,
          connectorId: '',
          model: 'sdxl',
        },
        localRuntime: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'image.generate' as const,
        source: 'local-runtime' as const,
        provider: 'localai',
        model: 'sdxl',
        connectorId: '',
        localModelId: 'sdxl',
        engine: 'localai',
        endpoint: 'http://127.0.0.1:11434/v1',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      }),
      checkHealth: async () => ({
        status: 'healthy',
        healthy: true,
        provider: 'localai',
        reasonCode: ReasonCode.RUNTIME_ROUTE_HEALTHY,
        actionHint: 'none',
      }),
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
        generate: async (input: Record<string, unknown>) => {
          imageCalls.push(input);
          return {
            job: {} as never,
            artifacts: [{ uri: 'data:image/png;base64,AA==' } as never],
            trace: { traceId: 'trace-image-t2i' },
          };
        },
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
    getModAiDependencySnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready' as const,
      routeSource: 'local-runtime' as const,
      warnings: [],
      dependencies: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const client = createModRuntimeClient('mod.context.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const result = await client.media.image.generate({
    prompt: 'draw mountain',
  });

  assert.equal(result.trace.traceId, 'trace-image-t2i');
  assert.equal(imageCalls.length, 1);
  assert.equal(imageCalls[0]?.prompt, 'draw mountain');
  assert.equal(imageCalls[0]?.negativePrompt, undefined);
  assert.equal(imageCalls[0]?.referenceImages, undefined);
  assert.equal(imageCalls[0]?.mask, undefined);
});
