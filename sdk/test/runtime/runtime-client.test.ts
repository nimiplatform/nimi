import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';

import { asNimiError } from '../../src/runtime/errors';
import { createRuntimeClient } from '../../src/runtime/core/client';
import { mergeRuntimeMetadata } from '../../src/runtime/core/metadata';
import { setNodeGrpcBridge, type NodeGrpcBridge } from '../../src/runtime/transports/node-grpc/index';
import type {
  RuntimeClientConfig,
  RuntimeOpenStreamCall,
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '../../src/runtime/types';
import {
  AuthorizationPreset,
  AuthorizeExternalPrincipalResponse,
  PolicyMode,
} from '../../src/runtime/generated/runtime/v1/grant';
import { ExternalPrincipalType } from '../../src/runtime/generated/runtime/v1/common';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp';
import {
  FallbackPolicy,
  FinishReason,
  GenerateRequest,
  GenerateResponse,
  Modal,
  RoutePolicy,
  StreamEventType,
  StreamGenerateEvent,
  type StreamGenerateRequest,
} from '../../src/runtime/generated/runtime/v1/ai';
import { ListModelsResponse } from '../../src/runtime/generated/runtime/v1/model';
import { RuntimeUnaryMethodCodecs } from '../../src/runtime/core/method-codecs';
import { isRuntimeWriteMethod, RuntimeMethodIds } from '../../src/runtime/method-ids';

const APP_ID = 'nimi.desktop.test';

const runtimeConfig: RuntimeClientConfig = {
  appId: APP_ID,
  transport: {
    type: 'node-grpc',
    endpoint: '127.0.0.1:46371',
  },
};

function createGenerateRequest(): GenerateRequest {
  return {
    appId: APP_ID,
    subjectUserId: 'mod:local-chat',
    modelId: 'local-model',
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

function createStreamGenerateRequest(): StreamGenerateRequest {
  return {
    ...createGenerateRequest(),
  };
}

function createAuthorizeRequest() {
  return {
    domain: 'app-auth',
    appId: APP_ID,
    externalPrincipalId: 'external-app-1',
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId: 'user-1',
    consentId: 'consent-1',
    consentVersion: '1.0',
    decisionAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
    policyVersion: '1.0.0',
    policyMode: PolicyMode.PRESET,
    preset: AuthorizationPreset.READ_ONLY,
    scopes: ['app.nimi.desktop.test.chat.read'],
    resourceSelectors: undefined,
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: 3600,
    scopeCatalogVersion: '1.0.0',
    policyOverride: false,
  };
}

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void> | (() => void);

type TauriRuntime = {
  core: { invoke: TauriInvoke };
  event: { listen: TauriListen };
};

type MutableGlobalTauri = typeof globalThis & {
  __TAURI__?: TauriRuntime;
  window?: { __TAURI__?: TauriRuntime };
};

function installTauriRuntime(runtime: TauriRuntime): () => void {
  const target = globalThis as MutableGlobalTauri;
  const previousRoot = target.__TAURI__;
  const previousWindow = target.window;
  const windowObject = previousWindow || {};

  windowObject.__TAURI__ = runtime;
  target.__TAURI__ = runtime;
  target.window = windowObject;

  return () => {
    if (typeof previousRoot === 'undefined') {
      delete target.__TAURI__;
    } else {
      target.__TAURI__ = previousRoot;
    }

    if (typeof previousWindow === 'undefined') {
      delete target.window;
    } else {
      target.window = previousWindow;
    }
  };
}

function unwrapTauriInvokePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const root = payload as Record<string, unknown>;
  const nested = root.payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return {};
  }
  return nested as Record<string, unknown>;
}

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

test('mergeRuntimeMetadata applies defaults and per-call overrides', () => {
  const metadata = mergeRuntimeMetadata(
    {
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      defaults: {
        protocolVersion: '1.2.3',
        participantProtocolVersion: '1.2.4',
        participantId: 'desktop:core',
        callerKind: 'desktop-core',
        callerId: 'app:nimi.desktop',
        surfaceId: 'renderer',
      },
    },
    {
      idempotencyKey: 'idem-1',
      metadata: {
        domain: 'runtime.test',
        traceId: 'trace-meta',
        extra: {
          'x-nimi-test': 'yes',
        },
      },
    },
  );

  assert.equal(metadata.protocolVersion, '1.2.3');
  assert.equal(metadata.participantProtocolVersion, '1.2.4');
  assert.equal(metadata.participantId, 'desktop:core');
  assert.equal(metadata.callerKind, 'desktop-core');
  assert.equal(metadata.callerId, 'app:nimi.desktop');
  assert.equal(metadata.surfaceId, 'renderer');
  assert.equal(metadata.domain, 'runtime.test');
  assert.equal(metadata.traceId, 'trace-meta');
  assert.equal(metadata.idempotencyKey, 'idem-1');
  assert.deepEqual(metadata.extra, { 'x-nimi-test': 'yes' });
});

test('asNimiError parses embedded runtime JSON payload', () => {
  const error = asNimiError(
    JSON.stringify({
      reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
      actionHint: 'retry',
      traceId: 'trace-json',
      retryable: true,
      message: 'provider timeout',
      details: {
        provider: 'localai',
        rawReasonCode: 'UPSTREAM_504',
      },
    }),
    { source: 'runtime' },
  );

  assert.equal(error.reasonCode, 'AI_PROVIDER_TIMEOUT');
  assert.equal(error.code, 'AI_PROVIDER_TIMEOUT');
  assert.equal(error.actionHint, 'retry');
  assert.equal(error.traceId, 'trace-json');
  assert.equal(error.retryable, true);
  assert.equal(error.source, 'runtime');
  assert.equal(error.message, 'provider timeout');
  assert.deepEqual(error.details, {
    provider: 'localai',
    rawReasonCode: 'UPSTREAM_504',
  });
});

test('asNimiError keeps provided defaults for plain Error objects', () => {
  const error = asNimiError(new Error('permission denied'), {
    reasonCode: ReasonCode.RUNTIME_GRPC_PERMISSION_DENIED,
    actionHint: 'check_request_and_app_auth',
    source: 'runtime',
  });

  assert.equal(error.reasonCode, 'RUNTIME_GRPC_PERMISSION_DENIED');
  assert.equal(error.code, 'RUNTIME_GRPC_PERMISSION_DENIED');
  assert.equal(error.actionHint, 'check_request_and_app_auth');
  assert.equal(error.source, 'runtime');
  assert.equal(error.message, 'permission denied');
});

test('node-grpc and tauri-ipc unary transports decode equivalent payloads', async () => {
  installNodeGrpcBridge({
    invokeUnary: async () => ListModelsResponse.toBinary(
      ListModelsResponse.create({
        models: [{
          modelId: 'llama3',
          provider: 'local',
          modal: [],
        }],
      }),
    ),
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command !== 'runtime_bridge_unary') {
          throw new Error(`unexpected tauri command: ${command}`);
        }
        return {
          responseBytesBase64: Buffer.from(
            ListModelsResponse.toBinary(
              ListModelsResponse.create({
                models: [{
                  modelId: 'llama3',
                  provider: 'local',
                  modal: [],
                }],
              }),
            ),
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

    const nodeResponse = await nodeClient.model.list({});
    const tauriResponse = await tauriClient.model.list({});

    assert.deepEqual(tauriResponse, nodeResponse);
  } finally {
    restoreTauri();
    clearNodeGrpcBridge();
  }
});

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
              GenerateResponse.toBinary(
                GenerateResponse.create({
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
    });

    const response = await client.ai.generate(createGenerateRequest());
    assert.equal(response.traceId, 'trace-tauri-write');
    assert.ok(capturedPayload);
    assert.equal(capturedPayload.methodId, RuntimeMethodIds.ai.generate);

    const metadata = (capturedPayload.metadata || {}) as Record<string, unknown>;
    assert.equal(metadata.appId, APP_ID);
    assert.equal(typeof metadata.idempotencyKey, 'string');
    assert.ok(String(metadata.idempotencyKey || '').length > 0);
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

    const stream = await client.ai.streamGenerate(createStreamGenerateRequest());
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
                  StreamGenerateEvent.toBinary(
                    StreamGenerateEvent.create({
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

    const stream = await client.ai.streamGenerate(createStreamGenerateRequest());
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
    });

    const stream = await client.ai.streamGenerate(createStreamGenerateRequest());
    for await (const _event of stream) {
      // no-op; this stream completes without payload events
    }

    assert.ok(streamOpenPayload);
    assert.equal(streamOpenPayload.eventNamespace, 'custom_events');
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
    const stream = await client.ai.streamGenerate(createStreamGenerateRequest(), {
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

    const stream = await client.ai.streamGenerate(createStreamGenerateRequest(), { signal });
    assert.equal(abortHandlers.size, 1);

    for await (const _event of stream) {
      // no-op; completion ends stream
    }

    assert.equal(abortHandlers.size, 0);
  } finally {
    restoreTauri();
  }
});
