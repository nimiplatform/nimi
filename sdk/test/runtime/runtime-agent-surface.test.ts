import assert from 'node:assert/strict';
import test from 'node:test';

import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp.js';
import {
  AppMessageEvent,
  AppMessageEventType,
  SendAppMessageRequest,
  SendAppMessageResponse,
} from '../../src/runtime/generated/runtime/v1/app.js';
import { RegisterAppRequest, RegisterAppResponse } from '../../src/runtime/generated/runtime/v1/auth.js';
import {
  AgentEvent,
  AgentEventType,
  AgentExecutionState,
  AgentStateEventFamily,
  ConversationAnchor,
  ConversationAnchorStatus,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  HookAdmissionState,
  HookEffect,
  HookTriggerFamily,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  SubscribeAgentEventsRequest,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
} from '../../src/runtime/generated/runtime/v1/grant.js';
import {
  ReasonCode as RuntimeProtoReasonCode,
} from '../../src/runtime/generated/runtime/v1/common.js';
import {
  Runtime,
} from '../../src/runtime/runtime.js';
import { RuntimeMethodIds } from '../../src/runtime/method-ids.js';
import {
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '../../src/runtime/transports/node-grpc.js';
import type { RuntimeAgentConsumeEvent } from '../../src/runtime/types-runtime-modules.js';

const APP_ID = 'nimi.runtime.agent.surface.test';
const OPEN_CONVERSATION_ANCHOR_METHOD = '/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor';
const GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD = '/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

function createAnchorSnapshot(anchorId: string, agentId: string) {
  return {
    anchor: ConversationAnchor.create({
      conversationAnchorId: anchorId,
      agentId,
      subjectUserId: 'subject-1',
      status: ConversationAnchorStatus.ACTIVE,
      lastTurnId: 'turn-last',
      lastMessageId: 'msg-last',
      updatedAt: Timestamp.create({ seconds: '1700000001', nanos: 0 }),
    }),
    activeTurnId: 'turn-active',
    activeStreamId: 'stream-active',
  };
}

function createAppEvent(messageType: string, payload: Record<string, unknown>): Uint8Array {
  return AppMessageEvent.toBinary(AppMessageEvent.create({
    eventType: AppMessageEventType.APP_MESSAGE_EVENT_RECEIVED,
    sequence: '1',
    messageId: `msg-${messageType}`,
    fromAppId: 'runtime.agent',
    toAppId: APP_ID,
    subjectUserId: 'subject-1',
    messageType,
    payload: Struct.fromJson(payload as never),
    reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
    traceId: `trace-${messageType}`,
    timestamp: Timestamp.create({ seconds: '1700000002', nanos: 0 }),
  }));
}

function createAgentEvent(input: Parameters<typeof AgentEvent.create>[0]): Uint8Array {
  return AgentEvent.toBinary(AgentEvent.create({
    sequence: '1',
    timestamp: Timestamp.create({ seconds: '1700000003', nanos: 0 }),
    ...input,
  }));
}

async function collectRuntimeAgentEvents(
  stream: AsyncIterable<RuntimeAgentConsumeEvent>,
): Promise<RuntimeAgentConsumeEvent[]> {
  const events: RuntimeAgentConsumeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

test('runtime agent anchors project explicit agentId and conversationAnchorId through runtime truth', async () => {
  let capturedOpenRequest: OpenConversationAnchorRequest | null = null;
  let capturedSnapshotRequest: GetConversationAnchorSnapshotRequest | null = null;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === OPEN_CONVERSATION_ANCHOR_METHOD) {
        capturedOpenRequest = OpenConversationAnchorRequest.fromBinary(input.request);
        return OpenConversationAnchorResponse.toBinary(OpenConversationAnchorResponse.create({
          snapshot: createAnchorSnapshot('anchor-1', 'agent-1'),
        }));
      }
      if (input.methodId === GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD) {
        capturedSnapshotRequest = GetConversationAnchorSnapshotRequest.fromBinary(input.request);
        return GetConversationAnchorSnapshotResponse.toBinary(GetConversationAnchorSnapshotResponse.create({
          snapshot: createAnchorSnapshot('anchor-1', 'agent-1'),
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const opened = await runtime.agent.anchors.open({
      agentId: 'agent-1',
      metadata: { source: 'sdk-test' },
    });
    const recovered = await runtime.agent.anchors.getSnapshot({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    });

    assert.equal(opened.anchor?.conversationAnchorId, 'anchor-1');
    assert.equal(recovered.anchor?.conversationAnchorId, 'anchor-1');
    assert.equal(capturedOpenRequest?.agentId, 'agent-1');
    assert.equal(capturedOpenRequest?.subjectUserId, 'subject-1');
    assert.equal(capturedOpenRequest?.context?.appId, APP_ID);
    assert.equal(capturedOpenRequest?.context?.subjectUserId, 'subject-1');
    assert.equal((Struct.toJson(capturedOpenRequest?.metadata as Struct) as { source?: string }).source, 'sdk-test');
    assert.equal(capturedSnapshotRequest?.agentId, 'agent-1');
    assert.equal(capturedSnapshotRequest?.conversationAnchorId, 'anchor-1');
    assert.equal(capturedSnapshotRequest?.context?.appId, APP_ID);
    assert.equal(capturedSnapshotRequest?.context?.subjectUserId, 'subject-1');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent turns subscribe/request/interrupt hard-cut to anchor-native runtime.agent families', async () => {
  const capturedMessages: SendAppMessageRequest[] = [];
  let capturedAgentSubscribeRequest: SubscribeAgentEventsRequest | null = null;
  let registerCalls = 0;
  let authorizeCalls = 0;
  let appSubscribeCalls = 0;
  let agentSubscribeCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        registerCalls += 1;
        const request = RegisterAppRequest.fromBinary(input.request);
        assert.equal(request.appId, APP_ID);
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        authorizeCalls += 1;
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        assert.ok(request.scopes.includes('runtime.agent.chat.read') || request.scopes.includes('runtime.agent.chat.write'));
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: `token-${authorizeCalls}`,
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: request.scopes,
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: `secret-${authorizeCalls}`,
        }));
      }
      if (input.methodId === RuntimeMethodIds.app.sendAppMessage) {
        const request = SendAppMessageRequest.fromBinary(input.request);
        capturedMessages.push(request);
        return SendAppMessageResponse.toBinary(SendAppMessageResponse.create({
          messageId: `ack-${capturedMessages.length}`,
          accepted: true,
          reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        appSubscribeCalls += 1;
        return {
          async *[Symbol.asyncIterator]() {
            yield createAppEvent('runtime.agent.turn.started', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-other',
              turn_id: 'turn-ignored',
              stream_id: 'stream-ignored',
              detail: { track: 'chat' },
            });
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: { request_id: 'req-1' },
            });
            yield createAppEvent('runtime.agent.turn.text_delta', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: { text: 'hello' },
            });
            yield createAppEvent('runtime.agent.presentation.expression_requested', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: { expression_id: 'smile', expected_duration_ms: 1200 },
            });
            yield createAppEvent('runtime.agent.turn.message_committed', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              message_id: 'msg-1',
              detail: { message_id: 'msg-1', text: 'hello world' },
            });
          },
        };
      }
      if (input.methodId === RuntimeMethodIds.agent.subscribeEvents) {
        agentSubscribeCalls += 1;
        capturedAgentSubscribeRequest = SubscribeAgentEventsRequest.fromBinary(input.request);
        return {
          async *[Symbol.asyncIterator]() {
            yield createAgentEvent({
              eventType: AgentEventType.STATE,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'state',
                state: {
                  family: AgentStateEventFamily.STATUS_TEXT_CHANGED,
                  conversationAnchorId: 'anchor-other',
                  currentStatusText: 'ignored',
                },
              },
            });
            yield createAgentEvent({
              eventType: AgentEventType.STATE,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'state',
                state: {
                  family: AgentStateEventFamily.EXECUTION_STATE_CHANGED,
                  conversationAnchorId: 'anchor-1',
                  originatingTurnId: 'turn-1',
                  originatingStreamId: 'stream-1',
                  currentExecutionState: AgentExecutionState.CHAT_ACTIVE,
                  previousExecutionState: AgentExecutionState.IDLE,
                },
              },
            });
            yield createAgentEvent({
              eventType: AgentEventType.HOOK,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'hook',
                hook: {
                  family: HookAdmissionState.RUNNING,
                  intent: {
                    intentId: 'hook-1',
                    agentId: 'agent-1',
                    conversationAnchorId: 'anchor-1',
                    originatingTurnId: 'turn-1',
                    originatingStreamId: 'stream-1',
                    triggerFamily: HookTriggerFamily.TIME,
                    triggerDetail: {
                      detail: {
                        oneofKind: 'time',
                        time: {
                          delay: { seconds: '30', nanos: 0 },
                        },
                      },
                    },
                    effect: HookEffect.FOLLOW_UP_TURN,
                    admissionState: HookAdmissionState.RUNNING,
                  },
                },
              },
            });
          },
        };
      }
      throw new Error(`unexpected stream method: ${input.methodId}`);
    },    
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const stream = await runtime.agent.turns.subscribe({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    });
    await runtime.agent.turns.request({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      messages: [{ role: 'user', content: 'hello' }],
      executionBinding: { route: 'local', modelId: 'local/qwen2.5' },
    });
    await runtime.agent.turns.interrupt({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      reason: 'user_interrupt',
    });

    const events: RuntimeAgentConsumeEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(registerCalls, 1);
    assert.equal(appSubscribeCalls, 1);
    assert.equal(agentSubscribeCalls, 1);
    assert.equal(authorizeCalls, 2);
    assert.equal(capturedMessages.length, 2);
    assert.equal(capturedAgentSubscribeRequest?.agentId, 'agent-1');
    assert.deepEqual(capturedAgentSubscribeRequest?.eventFilters, [
      AgentEventType.HOOK,
      AgentEventType.STATE,
    ]);

    const turnRequestPayload = Struct.toJson(capturedMessages[0]?.payload as Struct) as Record<string, unknown>;
    assert.equal(capturedMessages[0]?.messageType, 'runtime.agent.turn.request');
    assert.equal(turnRequestPayload.agent_id, 'agent-1');
    assert.equal(turnRequestPayload.conversation_anchor_id, 'anchor-1');
    assert.equal('session_id' in turnRequestPayload, false);

    const turnInterruptPayload = Struct.toJson(capturedMessages[1]?.payload as Struct) as Record<string, unknown>;
    assert.equal(capturedMessages[1]?.messageType, 'runtime.agent.turn.interrupt');
    assert.equal(turnInterruptPayload.conversation_anchor_id, 'anchor-1');
    assert.equal(turnInterruptPayload.turn_id, 'turn-1');
    assert.equal('session_id' in turnInterruptPayload, false);

    assert.deepEqual(new Set(events.map((event) => event.eventName)), new Set([
      'runtime.agent.turn.accepted',
      'runtime.agent.turn.text_delta',
      'runtime.agent.presentation.expression_requested',
      'runtime.agent.turn.message_committed',
      'runtime.agent.state.execution_state_changed',
      'runtime.agent.hook.running',
    ]));

    const executionStateChanged = events.find((event) => event.eventName === 'runtime.agent.state.execution_state_changed');
    assert.ok(executionStateChanged);
    if (executionStateChanged?.eventName === 'runtime.agent.state.execution_state_changed') {
      assert.equal(executionStateChanged.conversationAnchorId, 'anchor-1');
      assert.equal(executionStateChanged.originatingTurnId, 'turn-1');
      assert.equal(executionStateChanged.detail.currentExecutionState, 'chat_active');
      assert.equal(executionStateChanged.detail.previousExecutionState, 'idle');
    }

    const hookRunning = events.find((event) => event.eventName === 'runtime.agent.hook.running');
    assert.ok(hookRunning);
    if (hookRunning?.eventName === 'runtime.agent.hook.running') {
      assert.equal(hookRunning.conversationAnchorId, 'anchor-1');
      assert.equal(hookRunning.detail.intentId, 'hook-1');
      assert.equal(hookRunning.detail.triggerFamily, 'time');
      assert.equal(hookRunning.detail.effect, 'follow-up-turn');
      assert.equal(hookRunning.detail.admissionState, 'running');
      assert.deepEqual(hookRunning.detail.triggerDetail, {
        kind: 'time',
        delayMs: 30000,
      });
    }
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent turns subscribe parses Wave 2 hook projection events with origin and rejection detail', async () => {
  let capturedAgentSubscribeRequest: SubscribeAgentEventsRequest | null = null;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        assert.deepEqual(request.scopes, ['runtime.agent.chat.read']);
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: 'token-read',
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: request.scopes,
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: 'secret-read',
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        return {
          async *[Symbol.asyncIterator]() {},
        };
      }
      if (input.methodId === RuntimeMethodIds.agent.subscribeEvents) {
        capturedAgentSubscribeRequest = SubscribeAgentEventsRequest.fromBinary(input.request);
        return {
          async *[Symbol.asyncIterator]() {
            yield createAgentEvent({
              eventType: AgentEventType.HOOK,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'hook',
                hook: {
                  family: HookAdmissionState.PROPOSED,
                  intent: {
                    intentId: 'action-wave2-event',
                    agentId: 'agent-1',
                    conversationAnchorId: 'anchor-1',
                    originatingTurnId: 'turn-wave2',
                    originatingStreamId: 'stream-wave2',
                    triggerFamily: HookTriggerFamily.EVENT,
                    triggerDetail: {
                      detail: {
                        oneofKind: 'eventUserIdle',
                        eventUserIdle: {
                          idleFor: { seconds: '120', nanos: 0 },
                        },
                      },
                    },
                    effect: HookEffect.FOLLOW_UP_TURN,
                    admissionState: HookAdmissionState.PROPOSED,
                  },
                  observedAt: Timestamp.create({ seconds: '1700000100', nanos: 500000000 }),
                },
              },
            });
            yield createAgentEvent({
              eventType: AgentEventType.HOOK,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'hook',
                hook: {
                  family: HookAdmissionState.REJECTED,
                  intent: {
                    intentId: 'action-wave2-event',
                    agentId: 'agent-1',
                    conversationAnchorId: 'anchor-1',
                    originatingTurnId: 'turn-wave2',
                    originatingStreamId: 'stream-wave2',
                    triggerFamily: HookTriggerFamily.EVENT,
                    triggerDetail: {
                      detail: {
                        oneofKind: 'eventUserIdle',
                        eventUserIdle: {
                          idleFor: { seconds: '120', nanos: 0 },
                        },
                      },
                    },
                    effect: HookEffect.FOLLOW_UP_TURN,
                    admissionState: HookAdmissionState.REJECTED,
                    reason: 'continue after idle',
                  },
                  reasonCode: RuntimeProtoReasonCode.AI_OUTPUT_INVALID,
                  message: 'event hook trigger execution is not admitted by runtime public chat follow-up scheduler',
                  reason: 'continue after idle',
                  observedAt: Timestamp.create({ seconds: '1700000101', nanos: 0 }),
                },
              },
            });
          },
        };
      }
      throw new Error(`unexpected stream method: ${input.methodId}`);
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const stream = await runtime.agent.turns.subscribe({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    });
    const events = await collectRuntimeAgentEvents(stream);

    assert.equal(capturedAgentSubscribeRequest?.agentId, 'agent-1');
    assert.deepEqual(capturedAgentSubscribeRequest?.eventFilters, [
      AgentEventType.HOOK,
      AgentEventType.STATE,
    ]);
    assert.deepEqual(events.map((event) => event.eventName), [
      'runtime.agent.hook.intent_proposed',
      'runtime.agent.hook.rejected',
    ]);

    const proposed = events[0];
    assert.equal(proposed?.eventName, 'runtime.agent.hook.intent_proposed');
    if (proposed?.eventName === 'runtime.agent.hook.intent_proposed') {
      assert.equal(proposed.conversationAnchorId, 'anchor-1');
      assert.equal(proposed.originatingTurnId, 'turn-wave2');
      assert.equal(proposed.originatingStreamId, 'stream-wave2');
      assert.equal(proposed.detail.intentId, 'action-wave2-event');
      assert.equal(proposed.detail.triggerFamily, 'event');
      assert.equal(proposed.detail.effect, 'follow-up-turn');
      assert.equal(proposed.detail.admissionState, 'proposed');
      assert.deepEqual(proposed.detail.triggerDetail, {
        kind: 'event_user_idle',
        idleForMs: 120000,
      });
      assert.equal(proposed.detail.observedAt, '2023-11-14T22:15:00.500Z');
    }

    const rejected = events[1];
    assert.equal(rejected?.eventName, 'runtime.agent.hook.rejected');
    if (rejected?.eventName === 'runtime.agent.hook.rejected') {
      assert.equal(rejected.conversationAnchorId, 'anchor-1');
      assert.equal(rejected.originatingTurnId, 'turn-wave2');
      assert.equal(rejected.originatingStreamId, 'stream-wave2');
      assert.equal(rejected.detail.intentId, 'action-wave2-event');
      assert.equal(rejected.detail.triggerFamily, 'event');
      assert.equal(rejected.detail.admissionState, 'rejected');
      assert.equal(rejected.detail.reasonCode, 'AI_OUTPUT_INVALID');
      assert.equal(rejected.detail.message, 'event hook trigger execution is not admitted by runtime public chat follow-up scheduler');
      assert.equal(rejected.detail.reason, 'continue after idle');
      assert.deepEqual(rejected.detail.triggerDetail, {
        kind: 'event_user_idle',
        idleForMs: 120000,
      });
      assert.equal(rejected.detail.observedAt, '2023-11-14T22:15:01.000Z');
    }
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent session snapshot recovery stays anchor-native and consumer-owned', async () => {
  const capturedMessages: SendAppMessageRequest[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: 'token-1',
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: ['runtime.agent.chat.read', 'runtime.agent.chat.write'],
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: 'secret-1',
        }));
      }
      if (input.methodId === RuntimeMethodIds.app.sendAppMessage) {
        const request = SendAppMessageRequest.fromBinary(input.request);
        capturedMessages.push(request);
        return SendAppMessageResponse.toBinary(SendAppMessageResponse.create({
          messageId: 'ack-1',
          accepted: true,
          reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.app.subscribeAppMessages) {
        throw new Error(`unexpected stream method: ${input.methodId}`);
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield createAppEvent('runtime.agent.session.snapshot', {
            agent_id: 'agent-2',
            conversation_anchor_id: 'anchor-other',
            detail: {
              snapshot: {
                request_id: 'req-1',
              },
            },
          });
          yield createAppEvent('runtime.agent.session.snapshot', {
            agent_id: 'agent-1',
            conversation_anchor_id: 'anchor-1',
            detail: {
              snapshot: {
                request_id: 'req-1',
                thread_id: 'thread-1',
                subject_user_id: 'subject-1',
                session_status: 'active',
                transcript_message_count: 2,
                transcript: [
                  {
                    role: 'user',
                    content: 'hello',
                  },
                  {
                    role: 'assistant',
                    content: 'hi there',
                  },
                ],
                execution_binding: {
                  route: 'local',
                  model_id: 'local/qwen2.5',
                },
                active_turn: {
                  turn_id: 'turn-1',
                  status: 'running',
                  stream_sequence: 3,
                },
              },
            },
          });
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const snapshot = await runtime.agent.turns.getSessionSnapshot({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      requestId: 'req-1',
    });

    const requestPayload = Struct.toJson(capturedMessages[0]?.payload as Struct) as Record<string, unknown>;
    assert.equal(capturedMessages[0]?.messageType, 'runtime.agent.session.snapshot.request');
    assert.equal(requestPayload.conversation_anchor_id, 'anchor-1');
    assert.equal('session_id' in requestPayload, false);
    assert.equal(snapshot.requestId, 'req-1');
    assert.equal(snapshot.threadId, 'thread-1');
    assert.equal(snapshot.sessionStatus, 'active');
    assert.deepEqual(snapshot.transcript, [
      {
        role: 'user',
        content: 'hello',
      },
      {
        role: 'assistant',
        content: 'hi there',
      },
    ]);
    assert.equal(snapshot.executionBinding?.modelId, 'local/qwen2.5');
    assert.equal(snapshot.activeTurn?.turnId, 'turn-1');
    assert.equal(snapshot.activeTurn?.streamSequence, 3);
    assert.equal('sessionId' in (snapshot as Record<string, unknown>), false);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent turns subscribe can skip agent event stream for app-only turn consumers', async () => {
  let registerCalls = 0;
  let authorizeCalls = 0;
  let appSubscribeCalls = 0;
  let agentSubscribeCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        registerCalls += 1;
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        authorizeCalls += 1;
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: `token-${authorizeCalls}`,
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: ['runtime.agent.chat.read'],
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: `secret-${authorizeCalls}`,
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        appSubscribeCalls += 1;
        return {
          async *[Symbol.asyncIterator]() {
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: { request_id: 'req-1' },
            });
            yield createAppEvent('runtime.agent.turn.completed', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: { terminal_reason: 'stop' },
            });
          },
        };
      }
      if (input.methodId === RuntimeMethodIds.agent.subscribeEvents) {
        agentSubscribeCalls += 1;
        throw new Error('agent.subscribeEvents should not be opened when includeAgentEvents=false');
      }
      throw new Error(`unexpected stream method: ${input.methodId}`);
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const stream = await runtime.agent.turns.subscribe({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      includeAgentEvents: false,
    });

    const events: RuntimeAgentConsumeEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(registerCalls, 1);
    assert.equal(authorizeCalls, 1);
    assert.equal(appSubscribeCalls, 1);
    assert.equal(agentSubscribeCalls, 0);
    assert.deepEqual(events.map((event) => event.eventName), [
      'runtime.agent.turn.accepted',
      'runtime.agent.turn.completed',
    ]);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent consume surface admits agent-scoped no-origin state and hook projection', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: 'token-1',
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: ['runtime.agent.chat.read'],
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: 'secret-1',
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        return {
          async *[Symbol.asyncIterator]() {
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-2',
              turn_id: 'turn-2',
              stream_id: 'stream-2',
              detail: { request_id: 'req-2' },
            });
          },
        };
      }
      if (input.methodId === RuntimeMethodIds.agent.subscribeEvents) {
        return {
          async *[Symbol.asyncIterator]() {
            yield createAgentEvent({
              eventType: AgentEventType.STATE,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'state',
                state: {
                  family: AgentStateEventFamily.STATUS_TEXT_CHANGED,
                  currentStatusText: 'available',
                },
              },
            });
            yield createAgentEvent({
              eventType: AgentEventType.HOOK,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'hook',
                hook: {
                  family: HookAdmissionState.PENDING,
                  intent: {
                    intentId: 'hook-no-origin',
                    agentId: 'agent-1',
                    triggerFamily: HookTriggerFamily.EVENT,
                    triggerDetail: {
                      detail: {
                        oneofKind: 'eventChatEnded',
                        eventChatEnded: {},
                      },
                    },
                    effect: HookEffect.FOLLOW_UP_TURN,
                    admissionState: HookAdmissionState.PENDING,
                  },
                },
              },
            });
            yield createAgentEvent({
              eventType: AgentEventType.STATE,
              agentId: 'agent-1',
              detail: {
                oneofKind: 'state',
                state: {
                  family: AgentStateEventFamily.EMOTION_CHANGED,
                  conversationAnchorId: 'anchor-3',
                  currentEmotion: 'curious',
                  emotionSource: 'runtime',
                },
              },
            });
            yield createAgentEvent({
              eventType: AgentEventType.STATE,
              agentId: 'agent-other',
              detail: {
                oneofKind: 'state',
                state: {
                  family: AgentStateEventFamily.STATUS_TEXT_CHANGED,
                  currentStatusText: 'ignored',
                },
              },
            });
          },
        };
      }
      throw new Error(`unexpected stream method: ${input.methodId}`);
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const stream = await runtime.agent.turns.subscribe({
      agentId: 'agent-1',
    });

    const events: RuntimeAgentConsumeEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.deepEqual(new Set(events.map((event) => event.eventName)), new Set([
      'runtime.agent.turn.accepted',
      'runtime.agent.state.status_text_changed',
      'runtime.agent.hook.pending',
      'runtime.agent.state.emotion_changed',
    ]));

    const statusChanged = events.find((event) => event.eventName === 'runtime.agent.state.status_text_changed');
    assert.ok(statusChanged);
    if (statusChanged?.eventName === 'runtime.agent.state.status_text_changed') {
      assert.equal(statusChanged.conversationAnchorId, undefined);
      assert.equal(statusChanged.detail.currentStatusText, 'available');
    }

    const hookPending = events.find((event) => event.eventName === 'runtime.agent.hook.pending');
    assert.ok(hookPending);
    if (hookPending?.eventName === 'runtime.agent.hook.pending') {
      assert.equal(hookPending.conversationAnchorId, undefined);
      assert.equal(hookPending.detail.intentId, 'hook-no-origin');
      assert.equal(hookPending.detail.triggerFamily, 'event');
      assert.equal(hookPending.detail.admissionState, 'pending');
      assert.deepEqual(hookPending.detail.triggerDetail, {
        kind: 'event_chat_ended',
      });
    }

    const emotionChanged = events.find((event) => event.eventName === 'runtime.agent.state.emotion_changed');
    assert.ok(emotionChanged);
    if (emotionChanged?.eventName === 'runtime.agent.state.emotion_changed') {
      assert.equal(emotionChanged.conversationAnchorId, 'anchor-3');
      assert.equal(emotionChanged.detail.currentEmotion, 'curious');
      assert.equal(emotionChanged.detail.source, 'runtime');
    }
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent consume surface keeps multi-agent and same-agent different-anchor subscriptions isolated', async () => {
  const capturedSubscribeRequests: SubscribeAgentEventsRequest[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: 'token-1',
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: ['runtime.agent.chat.read'],
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: 'secret-1',
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        return {
          async *[Symbol.asyncIterator]() {
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-a1',
              stream_id: 'stream-a1',
              detail: { request_id: 'req-a1' },
            });
            yield createAppEvent('runtime.agent.turn.text_delta', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-a1',
              stream_id: 'stream-a1',
              detail: { text: 'alpha one' },
            });
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-2',
              turn_id: 'turn-a2',
              stream_id: 'stream-a2',
              detail: { request_id: 'req-a2' },
            });
            yield createAppEvent('runtime.agent.turn.text_delta', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-2',
              turn_id: 'turn-a2',
              stream_id: 'stream-a2',
              detail: { text: 'alpha two' },
            });
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-2',
              conversation_anchor_id: 'anchor-b1',
              turn_id: 'turn-b1',
              stream_id: 'stream-b1',
              detail: { request_id: 'req-b1' },
            });
            yield createAppEvent('runtime.agent.turn.text_delta', {
              agent_id: 'agent-2',
              conversation_anchor_id: 'anchor-b1',
              turn_id: 'turn-b1',
              stream_id: 'stream-b1',
              detail: { text: 'beta one' },
            });
          },
        };
      }
      if (input.methodId === RuntimeMethodIds.agent.subscribeEvents) {
        const request = SubscribeAgentEventsRequest.fromBinary(input.request);
        capturedSubscribeRequests.push(request);
        if (request.agentId === 'agent-1') {
          return {
            async *[Symbol.asyncIterator]() {
              yield createAgentEvent({
                eventType: AgentEventType.STATE,
                agentId: 'agent-1',
                detail: {
                  oneofKind: 'state',
                  state: {
                    family: AgentStateEventFamily.EXECUTION_STATE_CHANGED,
                    conversationAnchorId: 'anchor-1',
                    originatingTurnId: 'turn-a1',
                    originatingStreamId: 'stream-a1',
                    currentExecutionState: AgentExecutionState.CHAT_ACTIVE,
                    previousExecutionState: AgentExecutionState.IDLE,
                  },
                },
              });
              yield createAgentEvent({
                eventType: AgentEventType.STATE,
                agentId: 'agent-1',
                detail: {
                  oneofKind: 'state',
                  state: {
                    family: AgentStateEventFamily.EXECUTION_STATE_CHANGED,
                    conversationAnchorId: 'anchor-2',
                    originatingTurnId: 'turn-a2',
                    originatingStreamId: 'stream-a2',
                    currentExecutionState: AgentExecutionState.LIFE_PENDING,
                    previousExecutionState: AgentExecutionState.IDLE,
                  },
                },
              });
            },
          };
        }
        if (request.agentId === 'agent-2') {
          return {
            async *[Symbol.asyncIterator]() {
              yield createAgentEvent({
                eventType: AgentEventType.STATE,
                agentId: 'agent-2',
                detail: {
                  oneofKind: 'state',
                  state: {
                    family: AgentStateEventFamily.EXECUTION_STATE_CHANGED,
                    conversationAnchorId: 'anchor-b1',
                    originatingTurnId: 'turn-b1',
                    originatingStreamId: 'stream-b1',
                    currentExecutionState: AgentExecutionState.CHAT_ACTIVE,
                    previousExecutionState: AgentExecutionState.IDLE,
                  },
                },
              });
            },
          };
        }
      }
      throw new Error(`unexpected stream method: ${input.methodId}`);
    },
    closeStream: async () => {},
  });

  try {
    const runtimeAlphaAnchorOne = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });
    const runtimeAlphaAnchorTwo = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });
    const runtimeBetaAnchorOne = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const alphaAnchorOneEvents = await collectRuntimeAgentEvents(
      await runtimeAlphaAnchorOne.agent.turns.subscribe({
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
      }),
    );
    const alphaAnchorTwoEvents = await collectRuntimeAgentEvents(
      await runtimeAlphaAnchorTwo.agent.turns.subscribe({
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-2',
      }),
    );
    const betaAnchorOneEvents = await collectRuntimeAgentEvents(
      await runtimeBetaAnchorOne.agent.turns.subscribe({
        agentId: 'agent-2',
        conversationAnchorId: 'anchor-b1',
      }),
    );

    assert.deepEqual(
      new Set(alphaAnchorOneEvents.map((event) => `${event.agentId}:${event.conversationAnchorId}`)),
      new Set(['agent-1:anchor-1']),
    );
    assert.deepEqual(
      new Set(alphaAnchorTwoEvents.map((event) => `${event.agentId}:${event.conversationAnchorId}`)),
      new Set(['agent-1:anchor-2']),
    );
    assert.deepEqual(
      new Set(betaAnchorOneEvents.map((event) => `${event.agentId}:${event.conversationAnchorId}`)),
      new Set(['agent-2:anchor-b1']),
    );

    assert.ok(alphaAnchorOneEvents.some((event) => event.eventName === 'runtime.agent.turn.accepted'));
    assert.ok(alphaAnchorOneEvents.some((event) => event.eventName === 'runtime.agent.state.execution_state_changed'));
    assert.ok(alphaAnchorTwoEvents.some((event) => event.eventName === 'runtime.agent.turn.text_delta'));
    assert.ok(betaAnchorOneEvents.some((event) => event.eventName === 'runtime.agent.turn.text_delta'));

    assert.deepEqual(
      capturedSubscribeRequests.map((request) => request.agentId),
      ['agent-1', 'agent-1', 'agent-2'],
    );
  } finally {
    clearNodeGrpcBridge();
  }
});
