import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { asNimiError } from '../../src/runtime/errors';
import { createRuntimeClient } from '../../src/runtime/core/client';
import type {
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '../../src/runtime/types';
import {
  ExecuteScenarioResponse,
  FinishReason,
  RoutePolicy,
  StreamEventType,
  StreamScenarioEvent,
} from '../../src/runtime/generated/runtime/v1/ai';
import { ListModelsResponse } from '../../src/runtime/generated/runtime/v1/model';
import { RuntimeUnaryMethodCodecs } from '../../src/runtime/core/method-codecs';
import { isRuntimeWriteMethod, RuntimeMethodIds } from '../../src/runtime/method-ids';
import {
  APP_ID,
  runtimeConfig,
  createGenerateRequest,
  createStreamGenerateRequest,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
  installTauriRuntime,
  unwrapTauriInvokePayload,
} from './runtime-client-fixtures.js';

test('node-grpc and tauri-ipc cover runtime.localRuntime unary contract surface', async () => {
  const localRuntimeMethodEntries = Object.entries(RuntimeMethodIds.localRuntime) as Array<
    [keyof typeof RuntimeMethodIds.localRuntime, string]
  >;

  const nodeCalls: RuntimeUnaryCall<RuntimeWireMessage>[] = [];
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      nodeCalls.push(input);
      const codec = RuntimeUnaryMethodCodecs[input.methodId as keyof typeof RuntimeUnaryMethodCodecs];
      assert.ok(codec, `missing unary codec for ${input.methodId}`);
      return codec.responseType.toBinary(codec.responseType.create({}));
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  const tauriCalls: Array<Record<string, unknown>> = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command !== 'runtime_bridge_unary') {
          throw new Error(`unexpected tauri command: ${command}`);
        }
        const call = unwrapTauriInvokePayload(payload);
        tauriCalls.push(call);
        const methodId = String(call.methodId || '').trim();
        const codec = RuntimeUnaryMethodCodecs[methodId as keyof typeof RuntimeUnaryMethodCodecs];
        assert.ok(codec, `missing unary codec for ${methodId}`);
        return {
          responseBytesBase64: Buffer.from(
            codec.responseType.toBinary(codec.responseType.create({})),
          ).toString('base64'),
        };
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const nodeClient = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });
    const tauriClient = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    for (const [methodName, methodId] of localRuntimeMethodEntries) {
      const nodeInvoker = nodeClient.localRuntime[methodName] as (request: Record<string, unknown>) => Promise<unknown>;
      const tauriInvoker = tauriClient.localRuntime[methodName] as (request: Record<string, unknown>) => Promise<unknown>;

      const nodeResponse = await nodeInvoker({});
      const tauriResponse = await tauriInvoker({});
      assert.deepEqual(tauriResponse, nodeResponse);

      const nodeMetadata = nodeCalls[nodeCalls.length - 1]?.metadata || {};
      const tauriMetadata = ((tauriCalls[tauriCalls.length - 1] || {}).metadata || {}) as Record<string, unknown>;

      if (isRuntimeWriteMethod(methodId)) {
        assert.ok(String(nodeMetadata.idempotencyKey || '').length > 0, `${methodId} node idempotency missing`);
        assert.ok(String(tauriMetadata.idempotencyKey || '').length > 0, `${methodId} tauri idempotency missing`);
      } else {
        assert.equal(nodeMetadata.idempotencyKey, undefined, `${methodId} node should not inject idempotency`);
        assert.equal(tauriMetadata.idempotencyKey, undefined, `${methodId} tauri should not inject idempotency`);
      }
    }

    assert.equal(nodeCalls.length, localRuntimeMethodEntries.length);
    assert.equal(tauriCalls.length, localRuntimeMethodEntries.length);
  } finally {
    restoreTauri();
    clearNodeGrpcBridge();
  }
});

test('tauri-ipc write unary request includes idempotency key metadata', async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_unary') {
          capturedPayload = unwrapTauriInvokePayload(payload);
          return {
            responseBytesBase64: Buffer.from(
              ExecuteScenarioResponse.toBinary(
                ExecuteScenarioResponse.create({
                  finishReason: FinishReason.STOP,
                  routeDecision: RoutePolicy.LOCAL_RUNTIME,
                  modelResolved: 'llama3',
                  traceId: 'trace-tauri-write',
                }),
              ),
            ).toString('base64'),
          };
        }
        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      auth: {
        accessToken: () => 'token-tauri-unary',
      },
    });

    const response = await client.ai.executeScenario(createGenerateRequest());
    assert.equal(response.traceId, 'trace-tauri-write');
    assert.ok(capturedPayload);
    assert.equal(capturedPayload.methodId, RuntimeMethodIds.ai.executeScenario);

    const metadata = (capturedPayload.metadata || {}) as Record<string, unknown>;
    assert.equal(metadata.appId, APP_ID);
    assert.equal(typeof metadata.idempotencyKey, 'string');
    assert.ok(String(metadata.idempotencyKey || '').length > 0);
    assert.equal(capturedPayload.authorization, 'Bearer token-tauri-unary');
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc falls back to runtime_bridge command namespace when custom command is missing', async () => {
  const invokedCommands: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokedCommands.push(command);
        if (command.startsWith('custom_bridge_')) {
          throw new Error(`unknown command: ${command}`);
        }
        if (command === 'runtime_bridge_unary') {
          return {
            responseBytesBase64: Buffer.from(
              ListModelsResponse.toBinary(ListModelsResponse.create({ models: [] })),
            ).toString('base64'),
          };
        }
        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'custom_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    const result = await client.model.list({});
    assert.deepEqual(result.models, []);
    assert.deepEqual(invokedCommands, ['custom_bridge_unary', 'runtime_bridge_unary']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc does not retry with legacy payload when invoke reports invalid args', async () => {
  const invokedCalls: Array<{ command: string; payload: unknown }> = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        invokedCalls.push({ command, payload });
        if (command === 'runtime_bridge_unary') {
          throw new Error('invalid args `payload`: missing required key methodId');
        }
        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    let captured: ReturnType<typeof asNimiError> | null = null;
    try {
      await client.model.list({});
    } catch (error) {
      captured = asNimiError(error, { source: 'runtime' });
    }

    assert.ok(captured);
    assert.equal(captured.reasonCode, 'SDK_RUNTIME_TAURI_UNARY_FAILED');
    assert.equal(invokedCalls.length, 1);
    const firstArgs = (invokedCalls[0]?.payload || {}) as Record<string, unknown>;
    const firstPayload = unwrapTauriInvokePayload(invokedCalls[0]?.payload);
    assert.equal(typeof firstPayload.methodId, 'string');
    assert.equal(firstArgs.methodId, undefined);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc does not fall back when custom command returns domain not-found error', async () => {
  const invokedCommands: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokedCommands.push(command);
        if (command === 'custom_bridge_unary') {
          throw new Error('model not found');
        }
        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'custom_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    let captured: ReturnType<typeof asNimiError> | null = null;
    try {
      await client.model.list({});
    } catch (error) {
      captured = asNimiError(error, { source: 'runtime' });
    }

    assert.ok(captured);
    assert.equal(captured.reasonCode, 'SDK_RUNTIME_TAURI_UNARY_FAILED');
    assert.match(captured.message, /model not found/i);
    assert.deepEqual(invokedCommands, ['custom_bridge_unary']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc unary accepts empty protobuf payload bytes', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command !== 'runtime_bridge_unary') {
          throw new Error(`unexpected tauri command: ${command}`);
        }
        return {
          responseBytesBase64: '',
        };
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    const result = await client.model.list({});
    assert.deepEqual(result.models, []);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc stream errors surface as NimiError and close remote stream', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const closeRequests: string[] = [];

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_stream_open') {
          const streamId = 'stream-tauri-error';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (!handler) {
              return;
            }
            handler({
              payload: {
                streamId,
                eventType: 'error',
                error: {
                  reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
                  actionHint: 'retry',
                  traceId: 'trace-stream-error',
                  retryable: true,
                  message: 'provider timeout',
                },
              },
            });
          }, 0);
          return { streamId };
        }

        if (command === 'runtime_bridge_stream_close') {
          const value = unwrapTauriInvokePayload(payload) as { streamId?: string };
          closeRequests.push(String(value.streamId || ''));
          return {};
        }

        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: (event, handler) => {
        listeners.set(event, handler);
        return () => {
          listeners.delete(event);
        };
      },
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    const stream = await client.ai.streamScenario(createStreamGenerateRequest());
    let streamError: unknown = null;
    try {
      for await (const _event of stream) {
        // expected to fail before yielding events
      }
    } catch (error) {
      streamError = error;
    }

    assert.ok(streamError);
    const normalized = asNimiError(streamError, { source: 'runtime' });
    assert.equal(normalized.reasonCode, 'AI_PROVIDER_TIMEOUT');
    assert.equal(normalized.actionHint, 'retry');
    assert.equal(normalized.retryable, true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(closeRequests, ['stream-tauri-error']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc stream close is invoked when consumer breaks early', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const closeRequests: string[] = [];

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_stream_open') {
          const streamId = 'stream-tauri-break';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (!handler) {
              return;
            }
            handler({
              payload: {
                streamId,
                eventType: 'next',
                payloadBytesBase64: Buffer.from(
                  StreamScenarioEvent.toBinary(
                    StreamScenarioEvent.create({
                      eventType: StreamEventType.STREAM_EVENT_DELTA,
                      sequence: '1',
                      traceId: 'trace-break',
                      payload: {
                        oneofKind: 'delta',
                        delta: {
                          text: 'hello',
                        },
                      },
                    }),
                  ),
                ).toString('base64'),
              },
            });
          }, 0);
          return { streamId };
        }

        if (command === 'runtime_bridge_stream_close') {
          const value = unwrapTauriInvokePayload(payload) as { streamId?: string };
          closeRequests.push(String(value.streamId || ''));
          return {};
        }

        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: (event, handler) => {
        listeners.set(event, handler);
        return () => {
          listeners.delete(event);
        };
      },
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    const stream = await client.ai.streamScenario(createStreamGenerateRequest());
    const received: string[] = [];
    for await (const event of stream) {
      if (event.payload.oneofKind === 'delta') {
        received.push(event.payload.delta.text);
      }
      break;
    }

    assert.deepEqual(received, ['hello']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(closeRequests, ['stream-tauri-break']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc stream open forwards eventNamespace in payload', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  let streamOpenPayload: Record<string, unknown> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_stream_open') {
          streamOpenPayload = unwrapTauriInvokePayload(payload);
          const streamId = 'stream-tauri-event-namespace';
          setTimeout(() => {
            const handler = listeners.get('custom_events:stream:stream-tauri-event-namespace');
            if (!handler) {
              return;
            }
            handler({
              payload: {
                streamId,
                eventType: 'completed',
              },
            });
          }, 0);
          return { streamId };
        }
        if (command === 'runtime_bridge_stream_close') {
          return {};
        }
        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: (event, handler) => {
        listeners.set(event, handler);
        return () => {
          listeners.delete(event);
        };
      },
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'custom_events',
      },
      auth: {
        accessToken: () => 'token-tauri-stream',
      },
    });

    const stream = await client.ai.streamScenario(createStreamGenerateRequest());
    for await (const _event of stream) {
      // no-op; this stream completes without payload events
    }

    assert.ok(streamOpenPayload);
    assert.equal(streamOpenPayload.eventNamespace, 'custom_events');
    assert.equal(streamOpenPayload.authorization, 'Bearer token-tauri-stream');
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc stream abort signal triggers remote close', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const closeRequests: string[] = [];

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_stream_open') {
          return { streamId: 'stream-tauri-abort' };
        }

        if (command === 'runtime_bridge_stream_close') {
          const value = unwrapTauriInvokePayload(payload) as { streamId?: string };
          closeRequests.push(String(value.streamId || ''));
          return {};
        }

        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: (event, handler) => {
        listeners.set(event, handler);
        return () => {
          listeners.delete(event);
        };
      },
    },
  });

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    const controller = new AbortController();
    const stream = await client.ai.streamScenario(createStreamGenerateRequest(), {
      signal: controller.signal,
    });
    controller.abort();

    const iterator = stream[Symbol.asyncIterator]();
    const result = await iterator.next();
    assert.equal(result.done, true);
    assert.deepEqual(closeRequests, ['stream-tauri-abort']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc stream completion removes abort listener', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command === 'runtime_bridge_stream_open') {
          const streamId = 'stream-tauri-listener-cleanup';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (!handler) {
              return;
            }
            handler({
              payload: {
                streamId,
                eventType: 'completed',
              },
            });
          }, 0);
          return { streamId };
        }

        if (command === 'runtime_bridge_stream_close') {
          return {};
        }

        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: (event, handler) => {
        listeners.set(event, handler);
        return () => {
          listeners.delete(event);
        };
      },
    },
  });

  type AbortHandler = () => void;
  const abortHandlers = new Set<AbortHandler>();
  const signal = {
    aborted: false,
    addEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => {
      abortHandlers.add(handler as AbortHandler);
    },
    removeEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => {
      abortHandlers.delete(handler as AbortHandler);
    },
  } as unknown as AbortSignal;

  try {
    const client = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    const stream = await client.ai.streamScenario(createStreamGenerateRequest(), { signal });
    assert.equal(abortHandlers.size, 1);

    for await (const _event of stream) {
      // no-op; completion ends stream
    }

    assert.equal(abortHandlers.size, 0);
  } finally {
    restoreTauri();
  }
});
