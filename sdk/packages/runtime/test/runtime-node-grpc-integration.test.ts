import assert from 'node:assert/strict';
import test from 'node:test';

import * as grpc from '@grpc/grpc-js';
import type {
  sendUnaryData,
  ServerUnaryCall,
  ServerWritableStream,
  ServiceDefinition,
  UntypedServiceImplementation,
} from '@grpc/grpc-js';

import { createRuntimeClient } from '../src/core/client';
import { asNimiError } from '../src/errors';
import { RuntimeMethodIds } from '../src/method-ids';
import { setNodeGrpcBridge } from '../src/transports/node-grpc/index';
import type { RuntimeClientConfig } from '../src/types';
import {
  FallbackPolicy,
  FinishReason,
  Modal,
  RoutePolicy,
  StreamEventType,
  StreamGenerateEvent,
  StreamGenerateRequest,
} from '../src/generated/runtime/v1/ai';
import { ListModelsRequest, ListModelsResponse } from '../src/generated/runtime/v1/model';

const APP_ID = 'nimi.desktop.grpc.integration';

function toBinaryBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value);
}

function fromBinaryBuffer(value: Buffer): Uint8Array {
  return Uint8Array.from(value);
}

const runtimeServiceDefinition = {
  listModels: {
    path: RuntimeMethodIds.model.list,
    requestStream: false,
    responseStream: false,
    requestSerialize: toBinaryBuffer,
    requestDeserialize: fromBinaryBuffer,
    responseSerialize: toBinaryBuffer,
    responseDeserialize: fromBinaryBuffer,
    originalName: 'listModels',
  },
  streamGenerate: {
    path: RuntimeMethodIds.ai.streamGenerate,
    requestStream: false,
    responseStream: true,
    requestSerialize: toBinaryBuffer,
    requestDeserialize: fromBinaryBuffer,
    responseSerialize: toBinaryBuffer,
    responseDeserialize: fromBinaryBuffer,
    originalName: 'streamGenerate',
  },
} satisfies ServiceDefinition<UntypedServiceImplementation>;

type RuntimeServiceImpl = {
  listModels: (
    call: ServerUnaryCall<Uint8Array, Uint8Array>,
    callback: sendUnaryData<Uint8Array>,
  ) => void;
  streamGenerate: (call: ServerWritableStream<Uint8Array, Uint8Array>) => void;
};

async function startRuntimeGrpcServer(impl: RuntimeServiceImpl): Promise<{
  endpoint: string;
  close: () => Promise<void>;
}> {
  const server = new grpc.Server();
  server.addService(runtimeServiceDefinition as ServiceDefinition<UntypedServiceImplementation>, impl as UntypedServiceImplementation);

  const endpoint = await new Promise<string>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`127.0.0.1:${port}`);
    });
  });

  return {
    endpoint,
    close: () => new Promise<void>((resolve) => {
      server.tryShutdown(() => {
        resolve();
      });
    }),
  };
}

function createStreamGenerateRequest(): StreamGenerateRequest {
  return {
    appId: APP_ID,
    subjectUserId: 'mod:local-chat',
    modelId: 'llama3',
    modal: Modal.TEXT,
    input: [
      {
        role: 'user',
        content: 'hello',
        name: '',
      },
    ],
    systemPrompt: '',
    tools: [],
    temperature: 0,
    topP: 0,
    maxTokens: 128,
    routePolicy: RoutePolicy.LOCAL_RUNTIME,
    fallback: FallbackPolicy.DENY,
    timeoutMs: 0,
  };
}

function createRuntimeConfig(endpoint: string): RuntimeClientConfig {
  return {
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
  };
}

test('node-grpc integrates metadata injection and stream decoding against grpc-js server', async () => {
  setNodeGrpcBridge(null);

  let unaryMetadata: Record<string, unknown> | null = null;
  let streamMetadata: Record<string, unknown> | null = null;
  let streamIdempotencyKey = '';

  const server = await startRuntimeGrpcServer({
    listModels: (call, callback) => {
      unaryMetadata = call.metadata.getMap();
      ListModelsRequest.fromBinary(call.request);

      callback(
        null,
        ListModelsResponse.toBinary(ListModelsResponse.create({
          models: [{
            modelId: 'llama3',
            provider: 'local',
            modal: [],
          }],
        })),
      );
    },
    streamGenerate: (call) => {
      streamMetadata = call.metadata.getMap();
      streamIdempotencyKey = String(call.metadata.get('x-nimi-idempotency-key')[0] || '');

      call.write(StreamGenerateEvent.toBinary(StreamGenerateEvent.create({
        eventType: StreamEventType.STREAM_EVENT_DELTA,
        sequence: '1',
        traceId: 'trace-grpc',
        payload: {
          oneofKind: 'delta',
          delta: {
            text: 'hello',
          },
        },
      })));
      call.write(StreamGenerateEvent.toBinary(StreamGenerateEvent.create({
        eventType: StreamEventType.STREAM_EVENT_COMPLETED,
        sequence: '2',
        traceId: 'trace-grpc',
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: FinishReason.STOP,
          },
        },
      })));
      call.end();
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));

    const listModels = await client.model.list({});
    assert.equal(listModels.models.length, 1);

    const stream = await client.ai.streamGenerate(createStreamGenerateRequest());
    const events: StreamGenerateEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    assert.equal(events.length, 2);
    assert.equal(events[0]?.payload.oneofKind, 'delta');
    assert.equal(events[1]?.payload.oneofKind, 'completed');

    assert.ok(unaryMetadata);
    assert.equal(unaryMetadata['x-nimi-app-id'], APP_ID);
    assert.equal(unaryMetadata['x-nimi-idempotency-key'], undefined);

    assert.ok(streamMetadata);
    assert.equal(streamMetadata['x-nimi-app-id'], APP_ID);
    assert.equal(streamMetadata['x-nimi-domain'], 'runtime.rpc');
    assert.ok(streamIdempotencyKey.length > 0);
  } finally {
    await server.close();
  }
});

test('node-grpc maps grpc status code to structured NimiError reason', async () => {
  setNodeGrpcBridge(null);

  const server = await startRuntimeGrpcServer({
    listModels: (_call, callback) => {
      const error = Object.assign(new Error('permission denied'), {
        code: grpc.status.PERMISSION_DENIED,
        details: 'permission denied',
        metadata: new grpc.Metadata(),
      }) as grpc.ServiceError;
      callback(error, null as unknown as Uint8Array);
    },
    streamGenerate: (call) => {
      call.end();
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    let thrown: unknown = null;
    try {
      await client.model.list({});
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'runtime' });
    assert.equal(nimiError.reasonCode, 'RUNTIME_GRPC_PERMISSION_DENIED');
    assert.equal(nimiError.retryable, false);
    assert.equal(nimiError.source, 'runtime');
  } finally {
    await server.close();
  }
});

test('node-grpc maps unavailable grpc status to retryable NimiError', async () => {
  setNodeGrpcBridge(null);

  const server = await startRuntimeGrpcServer({
    listModels: (_call, callback) => {
      const error = Object.assign(new Error('upstream unavailable'), {
        code: grpc.status.UNAVAILABLE,
        details: 'upstream unavailable',
        metadata: new grpc.Metadata(),
      }) as grpc.ServiceError;
      callback(error, null as unknown as Uint8Array);
    },
    streamGenerate: (call) => {
      call.end();
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    let thrown: unknown = null;
    try {
      await client.model.list({});
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'runtime' });
    assert.equal(nimiError.reasonCode, 'RUNTIME_GRPC_UNAVAILABLE');
    assert.equal(nimiError.retryable, true);
    assert.equal(nimiError.actionHint, 'retry_or_check_runtime_daemon');
  } finally {
    await server.close();
  }
});

test('node-grpc uses uppercase reason code from grpc details', async () => {
  setNodeGrpcBridge(null);

  const server = await startRuntimeGrpcServer({
    listModels: (_call, callback) => {
      const error = Object.assign(new Error('model not found'), {
        code: grpc.status.NOT_FOUND,
        details: 'AI_MODEL_NOT_FOUND',
        metadata: new grpc.Metadata(),
      }) as grpc.ServiceError;
      callback(error, null as unknown as Uint8Array);
    },
    streamGenerate: (call) => {
      call.end();
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    let thrown: unknown = null;
    try {
      await client.model.list({});
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'runtime' });
    assert.equal(nimiError.reasonCode, 'AI_MODEL_NOT_FOUND');
    assert.equal(nimiError.retryable, false);
    assert.equal(nimiError.actionHint, 'check_request_and_app_auth');
  } finally {
    await server.close();
  }
});

test('node-grpc prefers structured reason payload from grpc details', async () => {
  setNodeGrpcBridge(null);

  const server = await startRuntimeGrpcServer({
    listModels: (_call, callback) => {
      const error = Object.assign(new Error('internal runtime failure'), {
        code: grpc.status.INTERNAL,
        details: `runtime error: ${JSON.stringify({
          reasonCode: 'AI_PROVIDER_TIMEOUT',
          actionHint: 'retry_provider_or_switch_route',
          traceId: 'trace-structured-details',
          retryable: true,
          message: 'provider timeout',
        })}`,
        metadata: new grpc.Metadata(),
      }) as grpc.ServiceError;
      callback(error, null as unknown as Uint8Array);
    },
    streamGenerate: (call) => {
      call.end();
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    let thrown: unknown = null;
    try {
      await client.model.list({});
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'runtime' });
    assert.equal(nimiError.reasonCode, 'AI_PROVIDER_TIMEOUT');
    assert.equal(nimiError.actionHint, 'retry_provider_or_switch_route');
    assert.equal(nimiError.traceId, 'trace-structured-details');
    assert.equal(nimiError.retryable, true);
    assert.equal(nimiError.message, 'provider timeout');
  } finally {
    await server.close();
  }
});

test('node-grpc structured grpc details can override retryable for unavailable status', async () => {
  setNodeGrpcBridge(null);

  const server = await startRuntimeGrpcServer({
    listModels: (_call, callback) => {
      const error = Object.assign(new Error('provider denied retry'), {
        code: grpc.status.UNAVAILABLE,
        details: JSON.stringify({
          reasonCode: 'AI_PROVIDER_CIRCUIT_OPEN',
          actionHint: 'switch_model_or_wait',
          traceId: 'trace-retry-override',
          retryable: false,
          message: 'provider denied retry',
        }),
        metadata: new grpc.Metadata(),
      }) as grpc.ServiceError;
      callback(error, null as unknown as Uint8Array);
    },
    streamGenerate: (call) => {
      call.end();
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    let thrown: unknown = null;
    try {
      await client.model.list({});
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'runtime' });
    assert.equal(nimiError.reasonCode, 'AI_PROVIDER_CIRCUIT_OPEN');
    assert.equal(nimiError.actionHint, 'switch_model_or_wait');
    assert.equal(nimiError.traceId, 'trace-retry-override');
    assert.equal(nimiError.retryable, false);
    assert.equal(nimiError.message, 'provider denied retry');
  } finally {
    await server.close();
  }
});

test('node-grpc stream respects AbortSignal cancellation', { timeout: 5_000 }, async () => {
  setNodeGrpcBridge(null);

  const server = await startRuntimeGrpcServer({
    listModels: (_call, callback) => {
      callback(null, ListModelsResponse.toBinary(ListModelsResponse.create({ models: [] })));
    },
    streamGenerate: (call) => {
      const timer = setTimeout(() => {
        call.end();
      }, 200);
      call.on('cancelled', () => {
        clearTimeout(timer);
      });
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    const controller = new AbortController();
    const stream = await client.ai.streamGenerate(createStreamGenerateRequest(), {
      signal: controller.signal,
    });

    controller.abort();
    const iterator = stream[Symbol.asyncIterator]();
    const result = await iterator.next();
    assert.equal(result.done, true);
  } finally {
    await server.close();
  }
});

test('node-grpc stream completion removes abort listener', async () => {
  setNodeGrpcBridge(null);

  const server = await startRuntimeGrpcServer({
    listModels: (_call, callback) => {
      callback(null, ListModelsResponse.toBinary(ListModelsResponse.create({ models: [] })));
    },
    streamGenerate: (call) => {
      call.write(StreamGenerateEvent.toBinary(StreamGenerateEvent.create({
        eventType: StreamEventType.STREAM_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-stream-complete',
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: FinishReason.STOP,
          },
        },
      })));
      call.end();
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
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    const stream = await client.ai.streamGenerate(createStreamGenerateRequest(), { signal });
    assert.equal(abortHandlers.size, 1);

    for await (const _event of stream) {
      // stream completes with a completion event
    }

    assert.equal(abortHandlers.size, 0);
  } finally {
    await server.close();
  }
});

test('node-grpc metadata only forwards x-nimi extra headers', async () => {
  setNodeGrpcBridge(null);

  let unaryMetadata: Record<string, unknown> | null = null;
  const server = await startRuntimeGrpcServer({
    listModels: (call, callback) => {
      unaryMetadata = call.metadata.getMap();
      callback(null, ListModelsResponse.toBinary(ListModelsResponse.create({ models: [] })));
    },
    streamGenerate: (call) => {
      call.end();
    },
  });

  try {
    const client = createRuntimeClient(createRuntimeConfig(server.endpoint));
    await client.model.list({}, {
      metadata: {
        traceId: 'trace-extra-headers',
        extra: {
          'x-nimi-custom': 'allow',
          'X-NIMI-UPPER': 'allow-upper',
          'x-not-nimi': 'deny',
          random: 'deny',
        },
      },
    });

    assert.ok(unaryMetadata);
    assert.equal(unaryMetadata['x-nimi-custom'], 'allow');
    assert.equal(unaryMetadata['x-nimi-upper'], 'allow-upper');
    assert.equal(unaryMetadata['x-not-nimi'], undefined);
    assert.equal(unaryMetadata.random, undefined);
  } finally {
    await server.close();
  }
});
