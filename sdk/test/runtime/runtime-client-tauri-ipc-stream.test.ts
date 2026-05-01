import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { asNimiError } from '../../src/runtime/errors';
import { createRuntimeClient } from '../../src/runtime/core/client';
import { RoutePolicy, StreamEventType, StreamScenarioEvent } from '../../src/runtime/generated/runtime/v1/ai';
import { createStreamGenerateRequest, installTauriRuntime, runtimeConfig, unwrapTauriInvokePayload } from './runtime-client-fixtures.js';
import { textDelta } from '../helpers/runtime-ai-shapes.js';
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

    const stream = await client.ai.streamScenario({
      ...createStreamGenerateRequest(),
      head: {
        ...createStreamGenerateRequest().head,
        modelId: 'cloud/model',
        routePolicy: RoutePolicy.CLOUD,
      },
    });
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

test('tauri-ipc projects RESOURCE_EXHAUSTED stream backpressure as NimiError', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const closeRequests: string[] = [];

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_stream_open') {
          const streamId = 'stream-tauri-backpressure';
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
                  reasonCode: ReasonCode.RESOURCE_EXHAUSTED,
                  actionHint: 'slow_down_stream_consumer',
                  traceId: 'trace-backpressure',
                  retryable: false,
                  message: 'slow consumer closed by transport',
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

    const stream = await client.ai.streamScenario({
      ...createStreamGenerateRequest(),
      head: {
        ...createStreamGenerateRequest().head,
        modelId: 'cloud/model',
        routePolicy: RoutePolicy.CLOUD,
      },
    });

    let streamError: unknown = null;
    try {
      for await (const _event of stream) {
        // expected to fail before normal completion
      }
    } catch (error) {
      streamError = error;
    }

    assert.ok(streamError);
    const normalized = asNimiError(streamError, { source: 'runtime' });
    assert.equal(normalized.reasonCode, 'RESOURCE_EXHAUSTED');
    assert.equal(normalized.actionHint, 'slow_down_stream_consumer');
    assert.equal(normalized.traceId, 'trace-backpressure');
    assert.equal(normalized.retryable, false);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(closeRequests, ['stream-tauri-backpressure']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc backpressure close does not masquerade as normal completion', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command === 'runtime_bridge_stream_open') {
          const streamId = 'stream-tauri-slow-consumer';
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
                      traceId: 'trace-slow-consumer',
                      payload: {
                        oneofKind: 'delta',
                        delta: textDelta('partial'),
                      },
                    }),
                  ),
                ).toString('base64'),
              },
            });
            setTimeout(() => {
              const nextHandler = listeners.get(`runtime_bridge:stream:${streamId}`);
              if (!nextHandler) {
                return;
              }
              nextHandler({
              payload: {
                streamId,
                eventType: 'error',
                error: {
                    reasonCode: ReasonCode.RESOURCE_EXHAUSTED,
                    actionHint: 'slow_down_stream_consumer',
                    traceId: 'trace-slow-consumer',
                    retryable: false,
                    message: 'slow consumer closed by transport',
                  },
                },
              });
            }, 0);
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
        eventNamespace: 'runtime_bridge',
      },
    });

    const stream = await client.ai.streamScenario({
      ...createStreamGenerateRequest(),
      head: {
        ...createStreamGenerateRequest().head,
        modelId: 'cloud/model',
        routePolicy: RoutePolicy.CLOUD,
      },
    });

    const deltas: string[] = [];
    let completedNormally = true;
    let streamError: unknown = null;
    try {
      for await (const event of stream) {
        if (event.payload.oneofKind === 'delta') {
          if (event.payload.delta.delta.oneofKind === 'text') {
            deltas.push(event.payload.delta.delta.text.text);
          }
        }
      }
    } catch (error) {
      completedNormally = false;
      streamError = error;
    }

    assert.deepEqual(deltas, ['partial']);
    assert.equal(completedNormally, false);
    assert.ok(streamError);
    assert.equal(asNimiError(streamError, { source: 'runtime' }).reasonCode, 'RESOURCE_EXHAUSTED');
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
                        delta: textDelta('hello'),
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

    const stream = await client.ai.streamScenario({
      ...createStreamGenerateRequest(),
      head: {
        ...createStreamGenerateRequest().head,
        modelId: 'cloud/model',
        routePolicy: RoutePolicy.CLOUD,
      },
    });
    const received: string[] = [];
    for await (const event of stream) {
      if (event.payload.oneofKind === 'delta') {
        received.push(event.payload.delta.delta.oneofKind === 'text'
          ? event.payload.delta.delta.text.text
          : '');
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
        protectedAccessToken: () => ({
          tokenId: 'protected-token-id',
          secret: 'protected-token-secret',
        }),
      },
    });

    const stream = await client.ai.streamScenario({
      ...createStreamGenerateRequest(),
      head: {
        ...createStreamGenerateRequest().head,
        modelId: 'cloud/model',
        routePolicy: RoutePolicy.CLOUD,
      },
    });
    for await (const _event of stream) {
      // no-op; this stream completes without payload events
    }

    assert.ok(streamOpenPayload);
    assert.equal(streamOpenPayload.eventNamespace, 'custom_events');
    assert.equal(streamOpenPayload.authorization, 'Bearer token-tauri-stream');
    assert.deepEqual(streamOpenPayload.protectedAccessToken, {
      tokenId: 'protected-token-id',
      secret: 'protected-token-secret',
    });
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
