import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import { createModRuntimeClient } from '../../src/mod/runtime/index.js';
import { createModRuntimeInspector } from '../../src/mod/runtime/inspector.js';
import { createInterModClient } from '../../src/mod/hook/inter-mod-client.js';
import { worldEvolution } from '../../src/mod/index.js';
import { clearModSdkHost, setModSdkHost } from '../../src/mod/host.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-facade.js';
import type { RuntimeHookInterModFacade } from '../../src/mod/types/inter-mod.js';

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
          source: 'local' as const,
          connectorId: '',
          model: 'qwen2.5',
        },
        local: { models: [] },
        connectors: [],
      }),
      resolve: async (input: Record<string, unknown>) => {
        routeResolveCalls.push(input);
        return {
          capability: 'text.generate' as const,
          source: 'local' as const,
          provider: 'llama',
          model: 'qwen2.5',
          connectorId: '',
          localModelId: 'qwen2.5',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:11434/v1',
          localProviderEndpoint: 'http://127.0.0.1:11434/v1',
          localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        };
      },
      checkHealth: async () => ({
        status: 'healthy' as const,
        healthy: true,
        provider: 'llama',
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
    getModLocalProfileSnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready' as const,
      routeSource: 'local' as const,
      warnings: [],
      entries: [],
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

test('mod runtime client forwards media.jobs.submit through injected runtime context', async () => {
  clearModSdkHost();

  const submitCalls: Array<Record<string, unknown>> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    route: {
      listOptions: async () => ({
        capability: 'image.generate' as const,
        selected: {
          source: 'local' as const,
          connectorId: '',
          model: 'media/local-import/z_image_turbo-Q4_K',
        },
        local: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'image.generate' as const,
        source: 'local' as const,
        provider: 'media',
        model: 'media/local-import/z_image_turbo-Q4_K',
        connectorId: '',
        localModelId: '01KK5M5ZNHWYK9WV1QWKSW48WG',
        engine: 'media',
        endpoint: 'http://127.0.0.1:1234/v1',
        localProviderEndpoint: 'http://127.0.0.1:1234/v1',
        localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
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
      listArtifacts: async () => [],
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
        submit: async (input: Record<string, unknown>) => {
          submitCalls.push(input);
          return {
            jobId: 'job-image-submit',
            status: 'submitted',
          } as never;
        },
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
      modId: 'mod.context.test',
      status: 'ready' as const,
      routeSource: 'local' as const,
      warnings: [],
      entries: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const client = createModRuntimeClient('mod.context.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  await client.media.jobs.submit({
    modal: 'image',
    input: {
      prompt: 'orange cat astronaut',
    },
  });

  assert.equal(submitCalls.length, 1);
  assert.equal(submitCalls[0]?.modId, 'mod.context.test');
  assert.equal((submitCalls[0]?.input as Record<string, unknown>)?.prompt, 'orange cat astronaut');
  assert.equal(submitCalls[0]?.modal, 'image');
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
          source: 'local' as const,
          connectorId: '',
          model: 'qwen2.5',
        },
        local: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'text.generate' as const,
        source: 'local' as const,
        provider: 'llama',
        model: 'qwen2.5',
        connectorId: '',
        localModelId: 'qwen2.5',
        engine: 'llama',
        endpoint: 'http://127.0.0.1:11434/v1',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      }),
      checkHealth: async (input: Record<string, unknown>) => {
        routeHealthCalls.push(input);
        return {
          status: 'healthy',
          healthy: true,
          provider: 'llama',
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
    getModLocalProfileSnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready' as const,
      routeSource: 'local' as const,
      warnings: [],
      entries: [],
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
          source: 'local' as const,
          connectorId: '',
          model: 'qwen2.5',
        },
        local: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'text.generate' as const,
        source: 'local' as const,
        provider: 'llama',
        model: 'qwen2.5',
        connectorId: '',
        localModelId: 'qwen2.5',
        engine: 'llama',
        endpoint: 'http://127.0.0.1:11434/v1',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      }),
      checkHealth: async () => ({
        status: 'healthy',
        healthy: true,
        provider: 'llama',
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
    getModLocalProfileSnapshot: async (input: Record<string, unknown>) => {
      snapshotCalls.push(input);
      return {
        modId: 'mod.context.test',
        status: 'ready' as const,
        routeSource: 'local' as const,
        warnings: [],
        entries: [],
        repairActions: [],
        updatedAt: new Date(0).toISOString(),
      };
    },
  };

  const inspector = createModRuntimeInspector('mod.context.test', {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  await inspector.getLocalProfileSnapshot('audio.synthesize', 'local');

  assert.equal(snapshotCalls.length, 1);
  assert.equal(snapshotCalls[0]?.modId, 'mod.context.test');
  assert.equal(snapshotCalls[0]?.capability, 'audio.synthesize');
  assert.equal(snapshotCalls[0]?.routeSourceHint, 'local');
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
          source: 'local' as const,
          connectorId: '',
          model: 'sdxl',
        },
        local: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        capability: 'image.generate' as const,
        source: 'local' as const,
        provider: 'media',
        model: 'sdxl',
        connectorId: '',
        localModelId: 'sdxl',
        engine: 'media',
        endpoint: 'http://127.0.0.1:11434/v1',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      }),
      checkHealth: async () => ({
        status: 'healthy',
        healthy: true,
        provider: 'media',
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
    getModLocalProfileSnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready' as const,
      routeSource: 'local' as const,
      warnings: [],
      entries: [],
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

// ---------------------------------------------------------------------------
// S-MOD-002: inter-mod messaging semantics (same-process, observable)
// ---------------------------------------------------------------------------
test('inter-mod client forwards request/broadcast/discover through injected runtime facade', async () => {
  const requestCalls: Array<Record<string, unknown>> = [];
  const broadcastCalls: Array<Record<string, unknown>> = [];
  let discoverCalled = false;

  const runtime: RuntimeHookInterModFacade = {
    registerInterModHandlerV2: async () => {},
    unregisterInterModHandler: () => 0,
    requestInterMod: async (input) => {
      requestCalls.push(input as Record<string, unknown>);
      return { echo: true };
    },
    broadcastInterMod: async (input) => {
      broadcastCalls.push(input as Record<string, unknown>);
      return { responses: [{ modId: 'mod-b', result: 'ok' }], errors: [] };
    },
    discoverInterModChannels: () => {
      discoverCalled = true;
      return [{ channel: 'chat', providers: ['mod-b'] }];
    },
  };

  const client = createInterModClient({
    modId: 'mod-a',
    runtime: runtime as unknown as RuntimeHookRuntimeFacade,
  });

  const requestResult = await client.request({
    toModId: 'mod-b',
    channel: 'chat',
    payload: { text: 'hello' },
  });
  assert.deepEqual(requestResult, { echo: true });
  assert.equal(requestCalls.length, 1);
  assert.equal(requestCalls[0]?.fromModId, 'mod-a');
  assert.equal(requestCalls[0]?.toModId, 'mod-b');
  assert.equal(requestCalls[0]?.channel, 'chat');

  const broadcastResult = await client.broadcast({
    channel: 'chat',
    payload: { text: 'broadcast' },
  });
  assert.equal(broadcastResult.responses.length, 1);
  assert.equal(broadcastCalls.length, 1);
  assert.equal(broadcastCalls[0]?.fromModId, 'mod-a');

  const channels = client.discover();
  assert.equal(discoverCalled, true);
  assert.equal(channels.length, 1);
  assert.equal(channels[0]?.channel, 'chat');
});

// ---------------------------------------------------------------------------
// S-MOD-005: hook register/unregister lifecycle boundary
// ---------------------------------------------------------------------------
test('inter-mod client register/unregister delegates to runtime facade', async () => {
  const registeredHandlers: Array<{ modId: string; channel: string }> = [];
  let unregisterResult = 0;

  const runtime: RuntimeHookInterModFacade = {
    registerInterModHandlerV2: async (input) => {
      registeredHandlers.push({ modId: input.modId, channel: input.channel });
    },
    unregisterInterModHandler: (input) => {
      unregisterResult = input.channel ? 1 : 2;
      return unregisterResult;
    },
    requestInterMod: async () => ({}),
    broadcastInterMod: async () => ({ responses: [], errors: [] }),
    discoverInterModChannels: () => [],
  };

  const client = createInterModClient({
    modId: 'mod-lifecycle',
    runtime: runtime as unknown as RuntimeHookRuntimeFacade,
  });

  await client.registerHandler({
    channel: 'events',
    handler: async (payload) => payload,
  });
  assert.equal(registeredHandlers.length, 1);
  assert.equal(registeredHandlers[0]?.modId, 'mod-lifecycle');
  assert.equal(registeredHandlers[0]?.channel, 'events');

  const removed = client.unregisterHandler({ channel: 'events' });
  assert.equal(removed, 1);

  const removedAll = client.unregisterHandler();
  assert.equal(removedAll, 2);
});

test('mod worldEvolution facade fails closed when host is unavailable', async () => {
  clearModSdkHost();

  await assert.rejects(
    () => worldEvolution.executionEvents.read({ eventId: 'evt-mod-missing' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_PERMISSION_DENIED);
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'BOUNDARY_DENIED');
      return true;
    },
  );
});

test('mod worldEvolution facade delegates through the host-injected namespace', async () => {
  clearModSdkHost();

  const providerCalls: Array<Record<string, unknown>> = [];
  setModSdkHost({
    worldEvolution: {
      executionEvents: {
        read: async (selector) => {
          providerCalls.push(selector as Record<string, unknown>);
          return [{
            eventId: 'evt-mod-1',
            worldId: 'world-mod-1',
            appId: 'app-mod-1',
            sessionId: 'session-mod-1',
            traceId: 'trace-mod-1',
            tick: 7,
            timestamp: '2026-04-08T00:00:00.000Z',
            eventKind: 'EXECUTION_EVENT',
            stage: 'EFFECT',
            actorRefs: [{ actorId: 'actor-1', actorType: 'AGENT' }],
            causation: null,
            correlation: null,
            effectClass: 'STATE_ONLY',
            reason: 'delegated',
            evidenceRefs: [{ kind: 'event', refId: 'evt-mod-1' }],
          }];
        },
      },
      replays: { read: async () => [] },
      checkpoints: { read: async () => [] },
      supervision: { read: async () => [] },
      commitRequests: { read: async () => [] },
    },
  } as never);

  try {
    const result = await worldEvolution.executionEvents.read({ eventId: 'evt-mod-1' });
    assert.equal(result.matchMode, 'exact');
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.eventId, 'evt-mod-1');
    assert.equal(providerCalls.length, 1);
    assert.deepEqual(providerCalls[0], { eventId: 'evt-mod-1' });
  } finally {
    clearModSdkHost();
  }
});

test('mod worldEvolution replays.read fails closed on unsupported selector replay mode', async () => {
  clearModSdkHost();

  let providerCalled = false;
  setModSdkHost({
    worldEvolution: {
      executionEvents: { read: async () => [] },
      replays: {
        read: async () => {
          providerCalled = true;
          return [];
        },
      },
      checkpoints: { read: async () => [] },
      supervision: { read: async () => [] },
      commitRequests: { read: async () => [] },
    },
  } as never);

  try {
    await assert.rejects(
      () => worldEvolution.replays.read({
        replayRef: { kind: 'replay', refId: 'replay-invalid-mod-selector' },
        replayMode: 'HYBRID',
      }),
      (error: unknown) => {
        assert.equal(providerCalled, false);
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
        assert.equal((error as { source?: string }).source, 'sdk');
        assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'INVALID_SELECTOR');
        assert.equal((error as { details?: { methodId?: string } }).details?.methodId, 'worldEvolution.replays.read');
        return true;
      },
    );
  } finally {
    clearModSdkHost();
  }
});
