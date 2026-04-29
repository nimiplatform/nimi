import assert from 'node:assert/strict';
import test from 'node:test';

import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp.js';
import {
  AppMessageEvent,
  AppMessageEventType,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
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
import { ReasonCode as RuntimeProtoReasonCode } from '../../src/runtime/generated/runtime/v1/common.js';
import { Runtime } from '../../src/runtime/runtime.js';
import { parseAgentConsumeEvent, parseAppConsumeEvent } from '../../src/runtime/runtime-agent-surface-parsers.js';
import { RuntimeMethodIds } from '../../src/runtime/method-ids.js';
import { setNodeGrpcBridge, type NodeGrpcBridge } from '../../src/runtime/transports/node-grpc.js';
import type { RuntimeAgentConsumeEvent } from '../../src/runtime/types-runtime-modules.js';

const APP_ID = 'nimi.runtime.agent.surface.test';
const OPEN_CONVERSATION_ANCHOR_METHOD = '/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor';
const GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD = '/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot';
const TIMELINE_STARTED_AT = '2026-04-25T00:00:00.000Z';

function timelineChannelForTestEvent(messageType: string): 'text' | 'state' | '' {
  switch (messageType) {
    case 'runtime.agent.turn.text_delta':
    case 'runtime.agent.turn.reasoning_delta':
    case 'runtime.agent.turn.structured':
    case 'runtime.agent.turn.message_committed':
      return 'text';
    case 'runtime.agent.turn.accepted':
    case 'runtime.agent.turn.started':
    case 'runtime.agent.turn.post_turn':
    case 'runtime.agent.turn.completed':
    case 'runtime.agent.turn.failed':
    case 'runtime.agent.turn.interrupted':
    case 'runtime.agent.turn.interrupt_ack':
      return 'state';
    default:
      return '';
  }
}

function withRuntimeTimeline(messageType: string, payload: Record<string, unknown>): Record<string, unknown> {
  const channel = timelineChannelForTestEvent(messageType);
  if (!channel || payload.timeline) {
    return payload;
  }
  return {
    ...payload,
    timeline: {
      turn_id: payload.turn_id,
      stream_id: payload.stream_id,
      channel,
      offset_ms: 12,
      sequence: 1,
      started_at_wall: TIMELINE_STARTED_AT,
      observed_at_wall: '2026-04-25T00:00:00.012Z',
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    },
  };
}

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
    payload: Struct.fromJson(withRuntimeTimeline(messageType, payload) as never),
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
  const authorizeRequests: AuthorizeExternalPrincipalRequest[] = [];
  const protectedTokens: Array<{ methodId: string; tokenId: string; secret: string }> = [];
  let registerCalls = 0;

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
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        authorizeRequests.push(request);
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: `anchor-token-${authorizeRequests.length}`,
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: request.scopes,
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: `anchor-secret-${authorizeRequests.length}`,
        }));
      }
      if (input.methodId === OPEN_CONVERSATION_ANCHOR_METHOD) {
        capturedOpenRequest = OpenConversationAnchorRequest.fromBinary(input.request);
        protectedTokens.push({
          methodId: input.methodId,
          tokenId: input.protectedAccessToken?.tokenId || '',
          secret: input.protectedAccessToken?.secret || '',
        });
        return OpenConversationAnchorResponse.toBinary(OpenConversationAnchorResponse.create({
          snapshot: createAnchorSnapshot('anchor-1', 'agent-1'),
        }));
      }
      if (input.methodId === GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD) {
        capturedSnapshotRequest = GetConversationAnchorSnapshotRequest.fromBinary(input.request);
        protectedTokens.push({
          methodId: input.methodId,
          tokenId: input.protectedAccessToken?.tokenId || '',
          secret: input.protectedAccessToken?.secret || '',
        });
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
    assert.equal(registerCalls, 1);
    assert.deepEqual(authorizeRequests.map((request) => request.scopes), [
      ['runtime.agent.turn.write'],
      ['runtime.agent.turn.read'],
    ]);
    assert.deepEqual(protectedTokens, [
      {
        methodId: OPEN_CONVERSATION_ANCHOR_METHOD,
        tokenId: 'anchor-token-1',
        secret: 'anchor-secret-1',
      },
      {
        methodId: GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD,
        tokenId: 'anchor-token-2',
        secret: 'anchor-secret-2',
      },
    ]);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent turns subscribe/request/interrupt hard-cut to anchor-native runtime.agent families', async () => {
  const capturedMessages: SendAppMessageRequest[] = [];
  const protectedTokens: Array<{ methodId: string; tokenId: string; secret: string }> = [];
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
        assert.ok(
          request.scopes.includes('runtime.agent.turn.read')
          || request.scopes.includes('runtime.agent.turn.write')
          || request.scopes.includes('runtime.agent.read'),
        );
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
        protectedTokens.push({
          methodId: input.methodId,
          tokenId: input.protectedAccessToken?.tokenId || '',
          secret: input.protectedAccessToken?.secret || '',
        });
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
        protectedTokens.push({
          methodId: input.methodId,
          tokenId: input.protectedAccessToken?.tokenId || '',
          secret: input.protectedAccessToken?.secret || '',
        });
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
            yield createAppEvent('runtime.agent.presentation.activity_requested', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: {
                activity_name: 'thinking',
                category: 'interaction',
                source: 'apml_output',
              },
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
        protectedTokens.push({
          methodId: input.methodId,
          tokenId: input.protectedAccessToken?.tokenId || '',
          secret: input.protectedAccessToken?.secret || '',
        });
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
    assert.equal(authorizeCalls, 3);
    assert.equal(capturedMessages.length, 2);
    assert.deepEqual(protectedTokens, [
      {
        methodId: RuntimeMethodIds.app.subscribeAppMessages,
        tokenId: 'token-1',
        secret: 'secret-1',
      },
      {
        methodId: RuntimeMethodIds.agent.subscribeEvents,
        tokenId: 'token-2',
        secret: 'secret-2',
      },
      {
        methodId: RuntimeMethodIds.app.sendAppMessage,
        tokenId: 'token-3',
        secret: 'secret-3',
      },
      {
        methodId: RuntimeMethodIds.app.sendAppMessage,
        tokenId: 'token-3',
        secret: 'secret-3',
      },
    ]);
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
      'runtime.agent.presentation.activity_requested',
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

    const activityRequested = events.find((event) => event.eventName === 'runtime.agent.presentation.activity_requested');
    assert.ok(activityRequested);
    if (activityRequested?.eventName === 'runtime.agent.presentation.activity_requested') {
      assert.equal(activityRequested.detail.activityName, 'thinking');
      assert.equal(activityRequested.detail.category, 'interaction');
      assert.equal(activityRequested.detail.source, 'apml_output');
    }

    const textDelta = events.find((event) => event.eventName === 'runtime.agent.turn.text_delta');
    assert.ok(textDelta);
    if (textDelta?.eventName === 'runtime.agent.turn.text_delta') {
      assert.equal(textDelta.timeline?.turnId, 'turn-1');
      assert.equal(textDelta.timeline?.streamId, 'stream-1');
      assert.equal(textDelta.timeline?.channel, 'text');
      assert.equal(textDelta.timeline?.projectionRuleId, 'K-AGCORE-051');
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

test('runtime agent turns binding-only mode sends scoped binding and does not resolve subject user', async () => {
  const binding = {
    bindingId: 'binding-1',
    bindingHandle: 'handle-1',
    runtimeAppId: APP_ID,
    avatarInstanceId: 'avatar-instance-1',
    agentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    worldId: 'world-1',
  };
  const capturedMessages: SendAppMessageRequest[] = [];
  let capturedAppSubscribeRequest: SubscribeAppMessagesRequest | null = null;
  let capturedAgentSubscribeRequest: SubscribeAgentEventsRequest | null = null;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      // Binding mode still goes through the protected access surface for the
      // gRPC authz interceptor token check; only the app-level subjectUserId
      // in SendAppMessage / SubscribeAppMessages is suppressed.
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
          reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: 'binding-mode-token',
          secret: 'binding-mode-secret',
          reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
        }));
      }
      if (input.methodId === RuntimeMethodIds.app.sendAppMessage) {
        const request = SendAppMessageRequest.fromBinary(input.request);
        capturedMessages.push(request);
        return SendAppMessageResponse.toBinary(SendAppMessageResponse.create({
          messageId: `ack-binding-${capturedMessages.length}`,
          accepted: true,
          reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        capturedAppSubscribeRequest = SubscribeAppMessagesRequest.fromBinary(input.request);
        return {
          async *[Symbol.asyncIterator]() {
            yield createAppEvent('runtime.agent.session.snapshot', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: {
                snapshot: {
                  request_id: 'snapshot-1',
                  session_status: 'idle',
                },
              },
            });
          },
        };
      }
      if (input.methodId === RuntimeMethodIds.agent.subscribeEvents) {
        capturedAgentSubscribeRequest = SubscribeAgentEventsRequest.fromBinary(input.request);
        return {
          async *[Symbol.asyncIterator]() {},
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
        subjectUserId: 'binding-mode-subject',
      },
    });

    await runtime.agent.turns.subscribe({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      scopedBinding: binding,
    });
    await runtime.agent.turns.request({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      worldId: 'world-1',
      messages: [{ role: 'user', content: 'hello' }],
      executionBinding: { route: 'local', modelId: 'local/qwen2.5' },
      scopedBinding: binding,
    });
    await runtime.agent.turns.interrupt({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      worldId: 'world-1',
      turnId: 'turn-1',
      scopedBinding: binding,
    });
    const snapshot = await runtime.agent.turns.getSessionSnapshot({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      worldId: 'world-1',
      requestId: 'snapshot-1',
      scopedBinding: binding,
    });

    assert.equal(snapshot.requestId, 'snapshot-1');
    assert.equal(capturedAppSubscribeRequest?.subjectUserId, '');
    assert.equal(capturedAppSubscribeRequest?.scopedBinding?.bindingId, 'binding-1');
    assert.equal(capturedAppSubscribeRequest?.scopedBinding?.avatarInstanceId, 'avatar-instance-1');
    assert.equal(capturedAgentSubscribeRequest?.context?.subjectUserId, '');
    assert.equal(capturedAgentSubscribeRequest?.context?.scopedBinding?.bindingId, 'binding-1');
    assert.equal(capturedMessages.length, 3);
    for (const message of capturedMessages) {
      assert.equal(message.subjectUserId, '');
      assert.equal(message.scopedBinding?.bindingId, 'binding-1');
      assert.equal(message.scopedBinding?.agentId, 'agent-1');
      assert.equal(message.scopedBinding?.conversationAnchorId, 'anchor-1');
      assert.equal(message.scopedBinding?.worldId, 'world-1');
    }
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent consume surface rejects invalid activity projection category', () => {
  assert.throws(() => parseAppConsumeEvent('runtime.agent.presentation.activity_requested', {
    agent_id: 'agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      activity_name: 'thinking',
      category: 'status',
      source: 'apml_output',
    },
  }), /detail\.category must be emotion, interaction, or state/);
});

test('runtime agent consume surface preserves runtime-owned turn timeline envelope', () => {
  const event = parseAppConsumeEvent('runtime.agent.turn.text_delta', withRuntimeTimeline('runtime.agent.turn.text_delta', {
    agent_id: 'agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: { text: 'hello' },
  }));

  assert.equal(event.eventName, 'runtime.agent.turn.text_delta');
  assert.equal(event.timeline?.turnId, 'turn-1');
  assert.equal(event.timeline?.streamId, 'stream-1');
  assert.equal(event.timeline?.channel, 'text');
  assert.equal(event.timeline?.timebaseOwner, 'runtime');
  assert.equal(event.timeline?.projectionRuleId, 'K-AGCORE-051');
  assert.equal(event.timeline?.clockBasis, 'monotonic_with_wall_anchor');
  assert.equal(event.timeline?.providerNeutral, true);
  assert.equal(event.timeline?.appLocalAuthority, false);
});

test('runtime agent consume surface rejects malformed turn timeline envelopes', () => {
  const base = withRuntimeTimeline('runtime.agent.turn.accepted', {
    agent_id: 'agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: { request_id: 'req-1' },
  });
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: undefined,
  }), /requires timeline\.turn_id/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: {
      ...(base.timeline as Record<string, unknown>),
      channel: 'lipsync',
    },
  }), /timeline\.channel must be state/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: {
      ...(base.timeline as Record<string, unknown>),
      stream_id: 'stream-other',
    },
  }), /timeline turn_id and stream_id must match/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: {
      ...(base.timeline as Record<string, unknown>),
      offset_ms: -1,
    },
  }), /timeline\.offset_ms must be non-negative/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: {
      ...(base.timeline as Record<string, unknown>),
      sequence: 0,
    },
  }), /timeline\.sequence must be a positive integer/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: {
      ...(base.timeline as Record<string, unknown>),
      sequence: 'not-a-number',
    },
  }), /timeline\.sequence must be a finite number/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: {
      ...(base.timeline as Record<string, unknown>),
      app_local_authority: true,
    },
  }), /timeline\.app_local_authority must be false/);
  assert.throws(() => parseAppConsumeEvent('runtime.agent.turn.accepted', {
    ...base,
    timeline: {
      ...(base.timeline as Record<string, unknown>),
      extra_field: 'parallel truth',
    },
  }), /timeline contains unknown fields: extra_field/);
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
        assert.ok(
          request.scopes.length === 1
          && (request.scopes[0] === 'runtime.agent.turn.read' || request.scopes[0] === 'runtime.agent.read'),
        );
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
  const protectedTokens: Array<{ methodId: string; tokenId: string; secret: string }> = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: request.scopes.includes('runtime.agent.turn.write') ? 'write-token' : 'read-token',
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: request.scopes,
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: request.scopes.includes('runtime.agent.turn.write') ? 'write-secret' : 'read-secret',
        }));
      }
      if (input.methodId === RuntimeMethodIds.app.sendAppMessage) {
        const request = SendAppMessageRequest.fromBinary(input.request);
        capturedMessages.push(request);
        protectedTokens.push({
          methodId: input.methodId,
          tokenId: input.protectedAccessToken?.tokenId || '',
          secret: input.protectedAccessToken?.secret || '',
        });
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
      protectedTokens.push({
        methodId: input.methodId,
        tokenId: input.protectedAccessToken?.tokenId || '',
        secret: input.protectedAccessToken?.secret || '',
      });
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
    assert.equal('agent_id' in requestPayload, false);
    assert.equal('world_id' in requestPayload, false);
    assert.equal('session_id' in requestPayload, false);
    assert.deepEqual(protectedTokens, [
      {
        methodId: RuntimeMethodIds.app.subscribeAppMessages,
        tokenId: 'read-token',
        secret: 'read-secret',
      },
      {
        methodId: RuntimeMethodIds.app.sendAppMessage,
        tokenId: 'write-token',
        secret: 'write-secret',
      },
    ]);
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
          effectiveScopes: ['runtime.agent.turn.read'],
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
          effectiveScopes: ['runtime.agent.turn.read'],
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
                  currentEmotion: 'calm',
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
      assert.equal(emotionChanged.detail.currentEmotion, 'calm');
      assert.equal(emotionChanged.detail.source, 'runtime');
    }
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent consume surface rejects invalid emotion projection', () => {
  assert.throws(() => parseAgentConsumeEvent(AgentEvent.fromBinary(createAgentEvent({
    eventType: AgentEventType.STATE,
    agentId: 'agent-1',
    detail: {
      oneofKind: 'state',
      state: {
        family: AgentStateEventFamily.EMOTION_CHANGED,
        currentEmotion: 'curious',
        emotionSource: 'runtime',
      },
    },
  }))), /current_emotion is not an admitted current emotion/);

  assert.throws(() => parseAgentConsumeEvent(AgentEvent.fromBinary(createAgentEvent({
    eventType: AgentEventType.STATE,
    agentId: 'agent-1',
    detail: {
      oneofKind: 'state',
      state: {
        family: AgentStateEventFamily.EMOTION_CHANGED,
        currentEmotion: 'calm',
        emotionSource: '',
      },
    },
  }))), /requires source/);
});
