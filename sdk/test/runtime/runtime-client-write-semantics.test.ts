import assert from 'node:assert/strict';
import test from 'node:test';
import { asNimiError } from '../../src/runtime/errors';
import { createRuntimeClient } from '../../src/runtime/core/client';
import type {
  RuntimeOpenStreamCall,
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '../../src/runtime/types';
import {
  AuthorizeExternalPrincipalResponse,
} from '../../src/runtime/generated/runtime/v1/grant';
import {
  FallbackPolicy,
  FinishReason,
  GenerateRequest,
  GenerateResponse,
  RoutePolicy,
  StreamEventType,
  StreamGenerateEvent,
} from '../../src/runtime/generated/runtime/v1/ai';
import { ListModelsResponse } from '../../src/runtime/generated/runtime/v1/model';
import {
  APP_ID,
  runtimeConfig,
  createGenerateRequest,
  createStreamGenerateRequest,
  createAuthorizeRequest,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
} from './runtime-client-fixtures.js';

test('createRuntimeClient injects idempotency key for write unary methods', async () => {
  let captured: RuntimeUnaryCall<RuntimeWireMessage> | null = null;
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      captured = input;
      return GenerateResponse.toBinary(
        GenerateResponse.create({
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.LOCAL_RUNTIME,
          modelResolved: 'local-model',
          traceId: 'trace-write',
        }),
      );
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const client = createRuntimeClient(runtimeConfig);
    const response = await client.ai.generate(createGenerateRequest());
    assert.equal(response.traceId, 'trace-write');
    assert.ok(captured);
    assert.equal(captured.metadata.appId, APP_ID);
    assert.equal(captured.metadata.domain, 'runtime.rpc');
    assert.equal(typeof captured.metadata.idempotencyKey, 'string');
    assert.ok((captured.metadata.idempotencyKey || '').length > 0);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('createRuntimeClient enforces explicit ai routePolicy', async () => {
  let invokeCount = 0;
  installNodeGrpcBridge({
    invokeUnary: async () => {
      invokeCount += 1;
      return GenerateResponse.toBinary(
        GenerateResponse.create({
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.LOCAL_RUNTIME,
          modelResolved: 'local-model',
          traceId: 'trace-route-required',
        }),
      );
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const client = createRuntimeClient(runtimeConfig);
    let thrown: unknown = null;
    try {
      await client.ai.generate({
        ...createGenerateRequest(),
        routePolicy: RoutePolicy.UNSPECIFIED,
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const normalized = asNimiError(thrown, { source: 'sdk' });
    assert.equal(normalized.reasonCode, 'SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED');
    assert.equal(invokeCount, 0);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('createRuntimeClient allows token-api route without explicit keySource metadata', async () => {
  let captured: RuntimeUnaryCall<RuntimeWireMessage> | null = null;
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      captured = input;
      return GenerateResponse.toBinary(
        GenerateResponse.create({
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.TOKEN_API,
          modelResolved: 'gemini/gemini-3-flash-preview',
          traceId: 'trace-token-api-no-keysource',
        }),
      );
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const client = createRuntimeClient(runtimeConfig);
    const response = await client.ai.generate({
      ...createGenerateRequest(),
      modelId: 'gemini/gemini-3-flash-preview',
      routePolicy: RoutePolicy.TOKEN_API,
    });
    assert.equal(response.traceId, 'trace-token-api-no-keysource');
    assert.ok(captured);
    assert.equal(captured.metadata.keySource, undefined);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('createRuntimeClient defaults ai fallback policy to deny when unspecified', async () => {
  let captured: RuntimeUnaryCall<RuntimeWireMessage> | null = null;
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      captured = input;
      return GenerateResponse.toBinary(
        GenerateResponse.create({
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.LOCAL_RUNTIME,
          modelResolved: 'local-model',
          traceId: 'trace-default-fallback',
        }),
      );
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const client = createRuntimeClient(runtimeConfig);
    await client.ai.generate({
      ...createGenerateRequest(),
      fallback: FallbackPolicy.UNSPECIFIED,
    });
    assert.ok(captured);

    const decoded = GenerateRequest.fromBinary(captured.request);
    assert.equal(decoded.fallback, FallbackPolicy.DENY);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('createRuntimeClient validates appAuth scopeCatalogVersion and consent evidence', async () => {
  let invokeCount = 0;
  installNodeGrpcBridge({
    invokeUnary: async () => {
      invokeCount += 1;
      return AuthorizeExternalPrincipalResponse.toBinary(
        AuthorizeExternalPrincipalResponse.create({
          tokenId: 'token-1',
          appId: APP_ID,
          subjectUserId: 'user-1',
          externalPrincipalId: 'external-app-1',
          effectiveScopes: ['app.nimi.desktop.test.chat.read'],
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: 'secret-1',
        }),
      );
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const client = createRuntimeClient(runtimeConfig);

    let missingScopeVersion: unknown = null;
    try {
      await client.appAuth.authorizeExternalPrincipal({
        ...createAuthorizeRequest(),
        scopeCatalogVersion: '',
      });
    } catch (error) {
      missingScopeVersion = error;
    }
    assert.ok(missingScopeVersion);
    assert.equal(
      asNimiError(missingScopeVersion, { source: 'sdk' }).reasonCode,
      'SDK_RUNTIME_APP_AUTH_SCOPE_CATALOG_VERSION_REQUIRED',
    );

    let missingDecisionAt: unknown = null;
    try {
      await client.appAuth.authorizeExternalPrincipal({
        ...createAuthorizeRequest(),
        decisionAt: undefined,
      });
    } catch (error) {
      missingDecisionAt = error;
    }
    assert.ok(missingDecisionAt);
    assert.equal(
      asNimiError(missingDecisionAt, { source: 'sdk' }).reasonCode,
      'SDK_RUNTIME_APP_AUTH_DECISION_AT_REQUIRED',
    );

    assert.equal(invokeCount, 0);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('createRuntimeClient does not inject idempotency key for read unary methods', async () => {
  let captured: RuntimeUnaryCall<RuntimeWireMessage> | null = null;
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      captured = input;
      return ListModelsResponse.toBinary(
        ListModelsResponse.create({
          models: [],
        }),
      );
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const client = createRuntimeClient(runtimeConfig);
    await client.model.list({});
    assert.ok(captured);
    assert.equal(captured.metadata.idempotencyKey, undefined);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('createRuntimeClient decodes stream events and forwards closeStream', async () => {
  let openedCall: RuntimeOpenStreamCall<RuntimeWireMessage> | null = null;
  const closedStreamIds: string[] = [];

  installNodeGrpcBridge({
    invokeUnary: async () => {
      throw new Error('unexpected unary call');
    },
    openStream: async (_config, input) => {
      openedCall = input;
      return {
        async *[Symbol.asyncIterator]() {
          yield StreamGenerateEvent.toBinary(
            StreamGenerateEvent.create({
              eventType: StreamEventType.STREAM_EVENT_DELTA,
              sequence: '1',
              traceId: 'trace-stream',
              payload: {
                oneofKind: 'delta',
                delta: {
                  text: 'hello',
                },
              },
            }),
          );
          yield StreamGenerateEvent.toBinary(
            StreamGenerateEvent.create({
              eventType: StreamEventType.STREAM_EVENT_COMPLETED,
              sequence: '2',
              traceId: 'trace-stream',
              payload: {
                oneofKind: 'completed',
                completed: {
                  finishReason: FinishReason.STOP,
                },
              },
            }),
          );
        },
      };
    },
    closeStream: async (_config, input) => {
      closedStreamIds.push(input.streamId);
    },
  });

  try {
    const client = createRuntimeClient(runtimeConfig);
    const stream = await client.ai.streamGenerate(createStreamGenerateRequest());
    const events: StreamGenerateEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 2);
    assert.equal(events[0]?.payload.oneofKind, 'delta');
    assert.equal(events[1]?.payload.oneofKind, 'completed');
    assert.ok(openedCall);
    assert.ok((openedCall.metadata.idempotencyKey || '').length > 0);

    await client.closeStream('stream-test-1');
    assert.deepEqual(closedStreamIds, ['stream-test-1']);
  } finally {
    clearNodeGrpcBridge();
  }
});
