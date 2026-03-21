import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { createTauriIpcTransport } from '../../src/runtime/transports/tauri-ipc';
import {
  createNodeGrpcTransport,
  setNodeGrpcBridge,
} from '../../src/runtime/transports/node-grpc';
import { asNimiError, createNimiError } from '../../src/runtime/errors';
import {
  checkRuntimeVersionCompatibility,
  assertRuntimeMethodAvailable,
  wrapModeDStream,
  resolveRuntimeSubjectUserId,
  resolveOptionalRuntimeSubjectUserId,
  runtimeAiRequestRequiresSubject,
} from '../../src/runtime/runtime-guards.js';
import {
  connectRuntime,
  readyRuntime,
  closeRuntime,
} from '../../src/runtime/runtime-lifecycle.js';
import {
  toRuntimeGenerateResult,
  runtimeGenerateConvenience,
  runtimeStreamConvenience,
} from '../../src/runtime/runtime-convenience.js';
import {
  installTauriRuntime,
  unwrapTauriInvokePayload,
  clearNodeGrpcBridge,
  installNodeGrpcBridge,
} from './runtime-client-fixtures.js';
import { RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai';
import type {
  RuntimeWireMessage,
  RuntimeUnaryCall,
  RuntimeOpenStreamCall,
  RuntimeConnectionState,
} from '../../src/runtime/types';

// ---------------------------------------------------------------------------
// runtime-lifecycle: connectRuntime branches
// ---------------------------------------------------------------------------

test('runtime-lifecycle: connectRuntime returns immediately if already ready', async () => {
  let clientSet = false;
  await connectRuntime({
    appId: 'test',
    options: { transport: { type: 'tauri-ipc' } },
    getState: () => ({ status: 'ready' }),
    getConnectPromise: () => null,
    setState: () => {},
    setConnectPromise: () => {},
    setClient: () => { clientSet = true; },
    emitConnected: () => {},
    emitTelemetry: () => {},
  });
  assert.equal(clientSet, false); // should not create client since already ready
});

test('runtime-lifecycle: connectRuntime returns existing promise if connecting', async () => {
  let resolveFn: () => void = () => {};
  const existingPromise = new Promise<void>((resolve) => { resolveFn = resolve; });
  const state: RuntimeConnectionState = { status: 'connecting' };

  const connectPromise = connectRuntime({
    appId: 'test',
    options: { transport: { type: 'tauri-ipc' } },
    getState: () => state,
    getConnectPromise: () => existingPromise,
    setState: () => {},
    setConnectPromise: () => {},
    setClient: () => {},
    emitConnected: () => {},
    emitTelemetry: () => {},
  });

  resolveFn();
  await connectPromise;
});

test('runtime-lifecycle: connectRuntime throws when no transport configured', async () => {
  let stateSet: RuntimeConnectionState | null = null;
  let currentState: RuntimeConnectionState = { status: 'idle' };
  await assert.rejects(
    () => connectRuntime({
      appId: 'test',
      options: {}, // no transport
      getState: () => currentState,
      getConnectPromise: () => null,
      setState: (s) => { stateSet = s; currentState = s; },
      setConnectPromise: () => {},
      setClient: () => {},
      emitConnected: () => {},
      emitTelemetry: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_TRANSPORT_INVALID;
    },
  );
  // State should be reset to idle on failure
  assert.ok(stateSet);
  assert.equal(stateSet!.status, 'idle');
});

// ---------------------------------------------------------------------------
// runtime-lifecycle: readyRuntime branches
// ---------------------------------------------------------------------------

test('runtime-lifecycle: readyRuntime throws when health is unavailable', async () => {
  await assert.rejects(
    () => readyRuntime({
      timeoutMs: 5000,
      waitForReady: async () => {},
      health: async () => ({ status: 'unavailable' as const, reason: 'daemon down' }),
      markReady: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'runtime' });
      return e.reasonCode === ReasonCode.RUNTIME_UNAVAILABLE;
    },
  );
});

test('runtime-lifecycle: readyRuntime succeeds when health is healthy', async () => {
  let readyAt = '';
  await readyRuntime({
    timeoutMs: 5000,
    waitForReady: async () => {},
    health: async () => ({ status: 'healthy' as const }),
    markReady: (at) => { readyAt = at; },
  });
  assert.ok(readyAt.length > 0);
});

test('runtime-lifecycle: readyRuntime succeeds when health is degraded', async () => {
  let readyAt = '';
  await readyRuntime({
    timeoutMs: 5000,
    waitForReady: async () => {},
    health: async () => ({ status: 'degraded' as const }),
    markReady: (at) => { readyAt = at; },
  });
  assert.ok(readyAt.length > 0);
});

test('runtime-lifecycle: readyRuntime health unavailable without reason', async () => {
  await assert.rejects(
    () => readyRuntime({
      timeoutMs: 5000,
      waitForReady: async () => {},
      health: async () => ({ status: 'unavailable' as const }),
      markReady: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'runtime' });
      return e.message.includes('unknown reason');
    },
  );
});

// ---------------------------------------------------------------------------
// runtime-lifecycle: closeRuntime branches
// ---------------------------------------------------------------------------

test('runtime-lifecycle: closeRuntime returns early if already closed', async () => {
  let stateSetCount = 0;
  await closeRuntime({
    getState: () => ({ status: 'closed' }),
    getConnectPromise: () => null,
    getClient: () => null,
    setState: () => { stateSetCount++; },
    setConnectPromise: () => {},
    setClient: () => {},
    emitDisconnected: () => {},
    emitTelemetry: () => {},
  });
  assert.equal(stateSetCount, 0);
});

test('runtime-lifecycle: closeRuntime transitions through closing to closed', async () => {
  const states: string[] = [];
  let disconnectedAt = '';
  let telemetryName = '';
  let currentState: RuntimeConnectionState = { status: 'ready' };
  await closeRuntime({
    getState: () => currentState,
    getConnectPromise: () => null,
    getClient: () => null,
    setState: (s) => { currentState = s; states.push(s.status); },
    setConnectPromise: () => {},
    setClient: () => {},
    emitDisconnected: (at) => { disconnectedAt = at; },
    emitTelemetry: (name) => { telemetryName = name; },
  });
  assert.deepEqual(states, ['closing', 'closed']);
  assert.ok(disconnectedAt.length > 0);
  assert.equal(telemetryName, 'runtime.disconnected');
});

test('runtime-lifecycle: closeRuntime sets client to null', async () => {
  let clientValue: unknown = 'not-null';
  await closeRuntime({
    getState: () => ({ status: 'ready' }),
    getConnectPromise: () => null,
    getClient: () => null,
    setState: () => {},
    setConnectPromise: () => {},
    setClient: (c) => { clientValue = c; },
    emitDisconnected: () => {},
    emitTelemetry: () => {},
  });
  assert.equal(clientValue, null);
});

test('runtime-lifecycle: closeRuntime awaits client cleanup and clears pending connect promise', async () => {
  let closed = false;
  let connectPromise: Promise<void> | null = Promise.resolve();
  let currentState: RuntimeConnectionState = { status: 'ready' };
  await closeRuntime({
    getState: () => currentState,
    getConnectPromise: () => connectPromise,
    getClient: () => ({
      close: async () => {
        closed = true;
      },
    } as never),
    setState: (state) => {
      currentState = state;
    },
    setConnectPromise: (promise) => {
      connectPromise = promise;
    },
    setClient: () => {},
    emitDisconnected: () => {},
    emitTelemetry: () => {},
  });
  assert.equal(closed, true);
  assert.equal(connectPromise, null);
  assert.equal(currentState.status, 'closed');
});

// ---------------------------------------------------------------------------
// runtime-convenience: resolveRuntimeConvenienceTarget branches (via export check)
// ---------------------------------------------------------------------------

// These functions are not directly exported, so we test them through the
// public API functions runtimeGenerateConvenience and runtimeStreamConvenience.

test('runtime-convenience: generate with no model/provider requires explicit target', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'hello',
            usage: { inputTokens: 5, outputTokens: 3 },
            finishReason: 'stop',
            trace: { traceId: 't1', modelResolved: 'local/default', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'hello',
    }),
    /requires an explicit local model or provider \+ model/i,
  );
  assert.equal(capturedModel, '');
});

test('runtime-convenience: generate with model only uses local route', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: 't2', modelResolved: 'local/llama3', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  const result = await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'llama3',
  });
  assert.equal(capturedModel, 'local/llama3');
  assert.equal(result.routeDecision, 'local');
});

test('runtime-convenience: generate with qualified remote model throws', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'openai/gpt-4',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: generate with provider + model uses cloud route', async () => {
  let capturedModel = '';
  let capturedRoute = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          capturedRoute = String(input.route || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: 't3', modelResolved: 'gemini/pro', routeDecision: 'cloud' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  const result = await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    provider: 'gemini',
    model: 'pro',
  });
  assert.equal(capturedModel, 'gemini/pro');
  assert.equal(capturedRoute, 'cloud');
  assert.equal(result.routeDecision, 'cloud');
});

test('runtime-convenience: generate with unsupported provider throws', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      provider: 'unsupported-provider',
    }),
    { message: /unsupported provider/ },
  );
});

test('runtime-convenience: generate with provider + qualified remote model throws', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      provider: 'openai',
      model: 'openai/gpt-4',
    }),
    { message: /provider-scoped model id/ },
  );
});

test('runtime-convenience: generate with provider but no model fails closed', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => {
          throw new Error('should not be called');
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      provider: 'anthropic',
    }),
    { message: /requires provider \+ model for cloud routing/i },
  );
});

// ---------------------------------------------------------------------------
// runtime-convenience: stream mapping branches
// ---------------------------------------------------------------------------

test('runtime-convenience: stream maps delta, finish, error, and unknown parts', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({
          stream: (async function*() {
            yield { type: 'delta', text: 'hello' };
            yield { type: 'finish', usage: { inputTokens: 5, outputTokens: 3 }, finishReason: 'stop', trace: { traceId: 't1', routeDecision: 'local' } };
            yield { type: 'error', error: createNimiError({ message: 'stream error', reasonCode: ReasonCode.AI_STREAM_BROKEN, source: 'runtime' }) };
            yield { type: 'unknown-type' }; // should be filtered out
          })(),
        }),
      },
    },
  };

  const chunks: unknown[] = [];
  const stream = await runtimeStreamConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'llama3',
  });
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  assert.equal(chunks.length, 3); // unknown type filtered out
  assert.deepEqual((chunks[0] as Record<string, unknown>).type, 'text');
  assert.deepEqual((chunks[1] as Record<string, unknown>).type, 'done');
  assert.deepEqual((chunks[2] as Record<string, unknown>).type, 'error');
});

// ---------------------------------------------------------------------------
// runtime-convenience: toRuntimeGenerateResult edge cases
// ---------------------------------------------------------------------------

test('runtime-convenience: toRuntimeGenerateResult handles missing trace fields', () => {
  const result = toRuntimeGenerateResult({
    text: 'result',
    usage: undefined,
    finishReason: 'stop',
    trace: { traceId: undefined, modelResolved: undefined, routeDecision: undefined },
  } as never);
  assert.equal(result.text, 'result');
  assert.equal(result.traceId, '');
  assert.equal(result.modelResolved, '');
  assert.equal(result.routeDecision, 'local');
});

// ---------------------------------------------------------------------------
// runtime-convenience: subjectUserId defaults to 'local-user'
// ---------------------------------------------------------------------------

test('runtime-convenience: generate uses default subjectUserId when not provided', async () => {
  let capturedSubject = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedSubject = String(input.subjectUserId || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await runtimeGenerateConvenience(mockRuntime as never, { prompt: 'test', model: 'llama3' });
  assert.equal(capturedSubject, 'local-user');
});

test('runtime-convenience: generate uses explicit subjectUserId', async () => {
  let capturedSubject = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedSubject = String(input.subjectUserId || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'llama3',
    subjectUserId: 'custom-user',
  });
  assert.equal(capturedSubject, 'custom-user');
});

// ---------------------------------------------------------------------------
// runtime-convenience: looksLikeQualifiedRemoteModel branches
// ---------------------------------------------------------------------------

test('runtime-convenience: cloud/ prefix model is treated as qualified remote', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'cloud/model',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: local/ prefix model is treated as qualified', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'local/llama3',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: model without slash uses local route', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'llama3',
  });
  assert.equal(capturedModel, 'local/llama3');
});

test('runtime-convenience: nexa/ prefix is rejected as legacy local input', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'nexa/octopus',
    }),
    { message: /legacy local model prefix/ },
  );
});

test('runtime-convenience: localai/ prefix is rejected as legacy local input', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'localai/model',
    }),
    { message: /legacy local model prefix/ },
  );
});

test('runtime-convenience: unknown-prefix/model is not treated as remote if not in provider set', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  // 'MyCustom/model' has uppercase so isLowercaseQualifiedPrefix fails
  await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'MyCustom/model',
  });
  assert.equal(capturedModel, 'local/MyCustom/model');
});
