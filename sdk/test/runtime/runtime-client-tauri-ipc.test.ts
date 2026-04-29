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
import {
  OpenSessionResponse,
  RegisterAppResponse,
} from '../../src/runtime/generated/runtime/v1/auth';
import {
  SendAppMessageResponse,
} from '../../src/runtime/generated/runtime/v1/app';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
} from '../../src/runtime/generated/runtime/v1/grant';
import {
  ConversationAnchor,
  ConversationAnchorStatus,
  GetPublicChatSessionSnapshotResponse,
  OpenConversationAnchorResponse,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';
import { ListModelsResponse } from '../../src/runtime/generated/runtime/v1/model';
import { RuntimeUnaryMethodCodecs } from '../../src/runtime/core/method-codecs';
import { Runtime } from '../../src/runtime/runtime.js';
import {
  isRuntimeWriteMethod,
  RuntimeMethodIds,
  RuntimeStreamMethodIds,
} from '../../src/runtime/method-ids';
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
import { textDelta } from '../helpers/runtime-ai-shapes.js';

test('node-grpc and tauri-ipc cover runtime.local unary contract surface', async () => {
  const localMethodEntries = Object.entries(RuntimeMethodIds.local) as Array<
    [keyof typeof RuntimeMethodIds.local, string]
  >;
  const unaryLocalMethodEntries = localMethodEntries.filter(([, methodId]) => !RuntimeStreamMethodIds.includes(methodId));

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

    for (const [methodName, methodId] of unaryLocalMethodEntries) {
      const nodeInvoker = nodeClient.local[methodName] as (request: Record<string, unknown>) => Promise<unknown>;
      const tauriInvoker = tauriClient.local[methodName] as (request: Record<string, unknown>) => Promise<unknown>;

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

    assert.equal(nodeCalls.length, unaryLocalMethodEntries.length);
    assert.equal(tauriCalls.length, unaryLocalMethodEntries.length);
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
                  routeDecision: RoutePolicy.LOCAL,
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
        protectedAccessToken: () => ({
          tokenId: 'protected-token-id',
          secret: 'protected-token-secret',
        }),
      },
    });

    const response = await client.ai.executeScenario({
      ...createGenerateRequest(),
      head: {
        ...createGenerateRequest().head,
        modelId: 'cloud/model',
        routePolicy: RoutePolicy.CLOUD,
      },
    });
    assert.equal(response.traceId, 'trace-tauri-write');
    assert.ok(capturedPayload);
    assert.equal(capturedPayload.methodId, RuntimeMethodIds.ai.executeScenario);

    const metadata = (capturedPayload.metadata || {}) as Record<string, unknown>;
    assert.equal(metadata.appId, APP_ID);
    assert.equal(typeof metadata.idempotencyKey, 'string');
    assert.ok(String(metadata.idempotencyKey || '').length > 0);
    assert.equal(capturedPayload.authorization, 'Bearer token-tauri-unary');
    assert.deepEqual(capturedPayload.protectedAccessToken, {
      tokenId: 'protected-token-id',
      secret: 'protected-token-secret',
    });
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc per-call protected access token suppresses stale bearer authorization', async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_unary') {
          capturedPayload = unwrapTauriInvokePayload(payload);
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
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      auth: {
        accessToken: () => 'stale-realm-token',
      },
    });

    await client.model.list({}, {
      protectedAccessToken: {
        tokenId: 'protected-token-id',
        secret: 'protected-token-secret',
      },
    });

    assert.ok(capturedPayload);
    assert.equal(capturedPayload.authorization, undefined);
    assert.deepEqual(capturedPayload.protectedAccessToken, {
      tokenId: 'protected-token-id',
      secret: 'protected-token-secret',
    });
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc runtime app session bootstrap suppresses stale bearer authorization', async () => {
  const capturedPayloads: Record<string, unknown>[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_unary') {
          const captured = unwrapTauriInvokePayload(payload);
          capturedPayloads.push(captured);
          if (captured.methodId === RuntimeMethodIds.auth.registerApp) {
            return {
              responseBytesBase64: Buffer.from(
                RegisterAppResponse.toBinary(RegisterAppResponse.create({ accepted: true })),
              ).toString('base64'),
            };
          }
          if (captured.methodId === RuntimeMethodIds.auth.openSession) {
            return {
              responseBytesBase64: Buffer.from(
                OpenSessionResponse.toBinary(OpenSessionResponse.create({
                  sessionId: 'runtime-session-id',
                  sessionToken: 'runtime-session-token',
                })),
              ).toString('base64'),
            };
          }
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
        accessToken: () => 'stale-realm-token',
      },
    });

    await client.auth.registerApp({
      appId: APP_ID,
      appInstanceId: 'desktop-session',
      deviceId: 'desktop-session',
      appVersion: '1',
    });
    await client.auth.openSession({
      appId: APP_ID,
      appInstanceId: 'desktop-session',
      deviceId: 'desktop-session',
      subjectUserId: 'user-1',
    });

    assert.equal(capturedPayloads.length, 2);
    assert.equal(capturedPayloads[0]?.methodId, RuntimeMethodIds.auth.registerApp);
    assert.equal(capturedPayloads[0]?.authorization, undefined);
    assert.equal(capturedPayloads[1]?.methodId, RuntimeMethodIds.auth.openSession);
    assert.equal(capturedPayloads[1]?.authorization, undefined);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc app unary request includes runtime app session', async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_unary') {
          capturedPayload = unwrapTauriInvokePayload(payload);
          return {
            responseBytesBase64: '',
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
        appSession: () => ({
          sessionId: 'runtime-session-id',
          sessionToken: 'runtime-session-token',
        }),
      },
    });

    await client.app.sendAppMessage({
      fromAppId: APP_ID,
      toAppId: 'runtime.agent',
      subjectUserId: 'user-1',
      messageType: 'runtime.agent.turn.request',
      requireAck: false,
    });

    assert.ok(capturedPayload);
    assert.equal(capturedPayload.methodId, RuntimeMethodIds.app.sendAppMessage);
    assert.deepEqual(capturedPayload.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc runtime agent anchor unary request includes runtime app session', async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_unary') {
          capturedPayload = unwrapTauriInvokePayload(payload);
          return {
            responseBytesBase64: Buffer.from(
              OpenConversationAnchorResponse.toBinary(
                OpenConversationAnchorResponse.create({
                  snapshot: {
                    anchor: ConversationAnchor.create({
                      conversationAnchorId: 'anchor-1',
                      agentId: 'agent-1',
                      subjectUserId: 'user-1',
                      status: ConversationAnchorStatus.ACTIVE,
                    }),
                  },
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
        appSession: () => ({
          sessionId: 'runtime-session-id',
          sessionToken: 'runtime-session-token',
        }),
      },
    });

    await client.agent.openConversationAnchor({
      agentId: 'agent-1',
      subjectUserId: 'user-1',
    });

    assert.ok(capturedPayload);
    assert.equal(capturedPayload.methodId, RuntimeMethodIds.agent.openConversationAnchor);
    assert.deepEqual(capturedPayload.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc Runtime agent anchor surface includes protected token and app session', async () => {
  const capturedPayloads: Record<string, unknown>[] = [];
  const authorizeRequests: AuthorizeExternalPrincipalRequest[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_bridge_unary') {
          const captured = unwrapTauriInvokePayload(payload);
          capturedPayloads.push(captured);
          if (captured.methodId === RuntimeMethodIds.auth.registerApp) {
            return {
              responseBytesBase64: Buffer.from(
                RegisterAppResponse.toBinary(RegisterAppResponse.create({ accepted: true })),
              ).toString('base64'),
            };
          }
          if (captured.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
            authorizeRequests.push(AuthorizeExternalPrincipalRequest.fromBinary(
              Buffer.from(String(captured.requestBytesBase64 || ''), 'base64'),
            ));
            return {
              responseBytesBase64: Buffer.from(
                AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
                  tokenId: 'runtime-agent-anchor-token',
                  secret: 'runtime-agent-anchor-secret',
                  appId: APP_ID,
                  subjectUserId: 'user-1',
                  externalPrincipalId: APP_ID,
                  effectiveScopes: ['runtime.agent.turn.write'],
                  policyVersion: 'runtime-protected-access-v1',
                  issuedScopeCatalogVersion: 'sdk-v2',
                })),
              ).toString('base64'),
            };
          }
          if (captured.methodId === RuntimeMethodIds.agent.openConversationAnchor) {
            return {
              responseBytesBase64: Buffer.from(
                OpenConversationAnchorResponse.toBinary(
                  OpenConversationAnchorResponse.create({
                    snapshot: {
                      anchor: ConversationAnchor.create({
                        conversationAnchorId: 'anchor-1',
                        agentId: 'agent-1',
                        subjectUserId: 'user-1',
                        status: ConversationAnchorStatus.ACTIVE,
                      }),
                    },
                  }),
                ),
              ).toString('base64'),
            };
          }
        }
        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      auth: {
        appSession: () => ({
          sessionId: 'runtime-session-id',
          sessionToken: 'runtime-session-token',
        }),
      },
      subjectContext: {
        subjectUserId: 'user-1',
      },
    });

    await runtime.agent.anchors.open({
      agentId: 'agent-1',
    });

    const openPayload = capturedPayloads.find((captured) => captured.methodId === RuntimeMethodIds.agent.openConversationAnchor);
    assert.ok(openPayload);
    assert.deepEqual(openPayload.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
    assert.deepEqual(openPayload.protectedAccessToken, {
      tokenId: 'runtime-agent-anchor-token',
      secret: 'runtime-agent-anchor-secret',
    });
    assert.deepEqual(authorizeRequests.map((request) => request.scopes), [
      ['runtime.agent.turn.write'],
    ]);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc Runtime agent turns surface includes protected tokens for streams and writes', async () => {
  const capturedPayloads: Record<string, unknown>[] = [];
  const authorizeRequests: AuthorizeExternalPrincipalRequest[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        const captured = unwrapTauriInvokePayload(payload);
        if (command === 'runtime_bridge_unary') {
          capturedPayloads.push(captured);
          if (captured.methodId === RuntimeMethodIds.auth.registerApp) {
            return {
              responseBytesBase64: Buffer.from(
                RegisterAppResponse.toBinary(RegisterAppResponse.create({ accepted: true })),
              ).toString('base64'),
            };
          }
          if (captured.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
            const request = AuthorizeExternalPrincipalRequest.fromBinary(
              Buffer.from(String(captured.requestBytesBase64 || ''), 'base64'),
            );
            authorizeRequests.push(request);
            const scopeKey = request.scopes.join('+').replaceAll('.', '-');
            return {
              responseBytesBase64: Buffer.from(
                AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
                  tokenId: `${scopeKey}-token`,
                  secret: `${scopeKey}-secret`,
                  appId: APP_ID,
                  subjectUserId: 'user-1',
                  externalPrincipalId: APP_ID,
                  effectiveScopes: request.scopes,
                  policyVersion: 'runtime-protected-access-v1',
                  issuedScopeCatalogVersion: 'sdk-v2',
                })),
              ).toString('base64'),
            };
          }
          if (captured.methodId === RuntimeMethodIds.app.sendAppMessage) {
            return {
              responseBytesBase64: Buffer.from(
                SendAppMessageResponse.toBinary(SendAppMessageResponse.create({
                  messageId: 'turn-request-ack',
                  accepted: true,
                })),
              ).toString('base64'),
            };
          }
          if (captured.methodId === RuntimeMethodIds.agent.getPublicChatSessionSnapshot) {
            return {
              responseBytesBase64: Buffer.from(
                GetPublicChatSessionSnapshotResponse.toBinary(GetPublicChatSessionSnapshotResponse.create({})),
              ).toString('base64'),
            };
          }
        }
        if (command === 'runtime_bridge_stream_open') {
          capturedPayloads.push(captured);
          return { streamId: `stream-${capturedPayloads.length}` };
        }
        if (command === 'runtime_bridge_stream_close') {
          return {};
        }
        throw new Error(`unexpected tauri command: ${command}`);
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      auth: {
        appSession: () => ({
          sessionId: 'runtime-session-id',
          sessionToken: 'runtime-session-token',
        }),
      },
      subjectContext: {
        subjectUserId: 'user-1',
      },
    });

    await runtime.agent.turns.getSessionSnapshot({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    });
    await runtime.agent.turns.subscribe({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    });
    await runtime.agent.turns.request({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      messages: [{ role: 'user', content: 'hello' }],
      executionBinding: { route: 'local', modelId: 'local/qwen2.5' },
    });

    const appSubscribePayload = capturedPayloads.find((captured) => captured.methodId === RuntimeMethodIds.app.subscribeAppMessages);
    const agentSubscribePayload = capturedPayloads.find((captured) => captured.methodId === RuntimeMethodIds.agent.subscribeEvents);
    const snapshotPayload = capturedPayloads.find((captured) => captured.methodId === RuntimeMethodIds.agent.getPublicChatSessionSnapshot);
    const sendPayload = capturedPayloads.find((captured) => captured.methodId === RuntimeMethodIds.app.sendAppMessage);

    assert.ok(appSubscribePayload);
    assert.ok(agentSubscribePayload);
    assert.ok(snapshotPayload);
    assert.ok(sendPayload);
    assert.deepEqual(authorizeRequests.map((request) => request.scopes), [
      ['runtime.agent.turn.read'],
      ['runtime.agent.read'],
      ['runtime.agent.turn.write'],
    ]);
    assert.deepEqual(appSubscribePayload.protectedAccessToken, {
      tokenId: 'runtime-agent-turn-read-token',
      secret: 'runtime-agent-turn-read-secret',
    });
    assert.deepEqual(snapshotPayload.protectedAccessToken, {
      tokenId: 'runtime-agent-turn-read-token',
      secret: 'runtime-agent-turn-read-secret',
    });
    assert.deepEqual(snapshotPayload.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
    assert.deepEqual(agentSubscribePayload.protectedAccessToken, {
      tokenId: 'runtime-agent-read-token',
      secret: 'runtime-agent-read-secret',
    });
    assert.deepEqual(sendPayload.protectedAccessToken, {
      tokenId: 'runtime-agent-turn-write-token',
      secret: 'runtime-agent-turn-write-secret',
    });
    assert.deepEqual(sendPayload.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
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
