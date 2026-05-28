import {
  assert,
  test,
  Struct,
  Timestamp,
  AppMessageEvent,
  AppMessageEventType,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
  RegisterAppRequest,
  RegisterAppResponse,
  AgentEvent,
  AgentEventType,
  AgentExecutionState,
  AgentPresentationEventFamily,
  AgentStateEventFamily,
  ConversationAnchor,
  ConversationAnchorStatus,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  HookAdmissionState,
  HookEffect,
  HookTriggerFamily,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  SubscribeAgentEventsRequest,
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  RuntimeProtoReasonCode,
  Runtime,
  parseAgentConsumeEvent,
  parseAppConsumeEvent,
  RuntimeMethodIds,
  APP_ID,
  LOCAL_AGENT_REF,
  LOCAL_AGENT_IDENTITY,
  OPEN_CONVERSATION_ANCHOR_METHOD,
  GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD,
  TIMELINE_STARTED_AT,
  timelineChannelForTestEvent,
  withRuntimeTimeline,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
  createAnchorSnapshot,
  createAppEvent,
  createAgentEvent,
  collectRuntimeAgentEvents,
} from './runtime-agent-surface-test-utils.js';
import type { RuntimeAgentConsumeEvent } from './runtime-agent-surface-test-utils.js';

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
              ...LOCAL_AGENT_IDENTITY,
              detail: {
                oneofKind: 'hook',
                hook: {
                  family: HookAdmissionState.PROPOSED,
                  intent: {
                    intentId: 'action-wave2-event',
                    agentId: LOCAL_AGENT_REF,
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
              ...LOCAL_AGENT_IDENTITY,
              detail: {
                oneofKind: 'hook',
                hook: {
                  family: HookAdmissionState.REJECTED,
                  intent: {
                    intentId: 'action-wave2-event',
                    agentId: LOCAL_AGENT_REF,
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
      ...LOCAL_AGENT_IDENTITY,
      conversationAnchorId: 'anchor-1',
    });
    const events = await collectRuntimeAgentEvents(stream);

    assert.equal(capturedAgentSubscribeRequest?.agentId, '');
    assert.equal(capturedAgentSubscribeRequest?.context?.localAgentRef, LOCAL_AGENT_REF);
    assert.deepEqual(capturedAgentSubscribeRequest?.eventFilters, [
      AgentEventType.HOOK,
      AgentEventType.STATE,
      AgentEventType.PRESENTATION,
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

test('runtime agent turns subscribe consumes presentation AgentEvent projections', async () => {
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
              eventType: AgentEventType.PRESENTATION,
              ...LOCAL_AGENT_IDENTITY,
              detail: {
                oneofKind: 'presentation',
                presentation: {
                  family: AgentPresentationEventFamily.EXPRESSION_REQUESTED,
                  conversationAnchorId: 'anchor-1',
                  turnId: 'turn-presentation',
                  streamId: 'stream-presentation',
                  expressionId: 'joy',
                  expressionExpectedDurationMs: '800',
                },
              },
            });
            yield createAgentEvent({
              eventType: AgentEventType.PRESENTATION,
              ...LOCAL_AGENT_IDENTITY,
              detail: {
                oneofKind: 'presentation',
                presentation: {
                  family: AgentPresentationEventFamily.ACTIVITY_REQUESTED,
                  conversationAnchorId: 'anchor-1',
                  turnId: 'turn-presentation',
                  streamId: 'stream-presentation',
                  activityName: 'greet',
                  activityCategory: 'interaction',
                  activityIntensity: 'moderate',
                  activitySource: 'apml_output',
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
      ...LOCAL_AGENT_IDENTITY,
      conversationAnchorId: 'anchor-1',
    });
    const events = await collectRuntimeAgentEvents(stream);

    assert.deepEqual(capturedAgentSubscribeRequest?.eventFilters, [
      AgentEventType.HOOK,
      AgentEventType.STATE,
      AgentEventType.PRESENTATION,
    ]);
    assert.deepEqual(events.map((event) => event.eventName), [
      'runtime.agent.presentation.expression_requested',
      'runtime.agent.presentation.activity_requested',
    ]);

    const expression = events[0];
    assert.equal(expression?.eventName, 'runtime.agent.presentation.expression_requested');
    if (expression?.eventName === 'runtime.agent.presentation.expression_requested') {
      assert.equal(expression.conversationAnchorId, 'anchor-1');
      assert.equal(expression.turnId, 'turn-presentation');
      assert.equal(expression.streamId, 'stream-presentation');
      assert.equal(expression.detail.expressionId, 'joy');
      assert.equal(expression.detail.expectedDurationMs, 800);
    }

    const activity = events[1];
    assert.equal(activity?.eventName, 'runtime.agent.presentation.activity_requested');
    if (activity?.eventName === 'runtime.agent.presentation.activity_requested') {
      assert.equal(activity.conversationAnchorId, 'anchor-1');
      assert.equal(activity.detail.activityName, 'greet');
      assert.equal(activity.detail.category, 'interaction');
      assert.equal(activity.detail.intensity, 'moderate');
      assert.equal(activity.detail.source, 'apml_output');
    }
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime agent session snapshot recovery stays anchor-native and consumer-owned', async () => {
  const capturedMessages: SendAppMessageRequest[] = [];
  const protectedTokens: Array<{ methodId: string; tokenId: string; secret: string }> = [];
  let capturedSessionSnapshotRequest: GetPublicChatSessionSnapshotRequest | null = null;

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
      if (input.methodId === RuntimeMethodIds.agent.getPublicChatSessionSnapshot) {
        capturedSessionSnapshotRequest = GetPublicChatSessionSnapshotRequest.fromBinary(input.request);
        protectedTokens.push({
          methodId: input.methodId,
          tokenId: input.protectedAccessToken?.tokenId || '',
          secret: input.protectedAccessToken?.secret || '',
        });
        return GetPublicChatSessionSnapshotResponse.toBinary(GetPublicChatSessionSnapshotResponse.create({
          snapshot: Struct.fromJson({
            request_id: 'req-1',
            thread_id: 'thread-1',
            subject_user_id: 'subject-1',
            session_status: 'active',
            transcript_message_count: 2,
            transcript: [
              {
                id: 'anchor-1:transcript:0',
                role: 'user',
                content: 'hello',
                status: 'complete',
                kind: 'text',
                created_at: '2026-05-27T00:00:00Z',
                updated_at: '2026-05-27T00:00:00Z',
              },
              {
                id: 'anchor-1:transcript:1',
                role: 'assistant',
                content: 'hi there',
                status: 'complete',
                kind: 'text',
                created_at: '2026-05-27T00:00:00.001Z',
                updated_at: '2026-05-27T00:00:00.001Z',
                trace_id: 'trace-1',
                reasoning_text: 'thinking',
                metadata: { source: 'runtime' },
              },
            ],
            execution_binding: { route: 'local', model_id: 'local/qwen2.5' },
            active_turn: { turn_id: 'turn-1', stream_id: 'stream-1', status: 'running', stream_sequence: 3 },
          } as never),
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
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

    const snapshot = await runtime.agent.turns.getSessionSnapshot({
      ...LOCAL_AGENT_IDENTITY,
      conversationAnchorId: 'anchor-1',
      requestId: 'req-1',
    });

    assert.equal(capturedSessionSnapshotRequest?.agentId, LOCAL_AGENT_REF);
    assert.equal(capturedSessionSnapshotRequest?.conversationAnchorId, 'anchor-1');
    assert.equal(capturedSessionSnapshotRequest?.requestId, 'req-1');
    assert.equal(capturedSessionSnapshotRequest?.worldId, '');
    assert.equal(capturedSessionSnapshotRequest?.context?.appId, APP_ID);
    assert.equal(capturedSessionSnapshotRequest?.context?.subjectUserId, 'subject-1');
    assert.equal(capturedSessionSnapshotRequest?.context?.localAgentRef, LOCAL_AGENT_REF);
    assert.deepEqual(protectedTokens, [
      {
        methodId: RuntimeMethodIds.agent.getPublicChatSessionSnapshot,
        tokenId: 'read-token',
        secret: 'read-secret',
      },
    ]);
    assert.equal(snapshot.requestId, 'req-1');
    assert.equal(snapshot.threadId, 'thread-1');
    assert.equal(snapshot.sessionStatus, 'active');
    assert.deepEqual(snapshot.transcript, [
      {
        id: 'anchor-1:transcript:0',
        role: 'user',
        content: 'hello',
        status: 'complete',
        kind: 'text',
        createdAt: '2026-05-27T00:00:00Z',
        updatedAt: '2026-05-27T00:00:00Z',
      },
      {
        id: 'anchor-1:transcript:1',
        role: 'assistant',
        content: 'hi there',
        status: 'complete',
        kind: 'text',
        createdAt: '2026-05-27T00:00:00.001Z',
        updatedAt: '2026-05-27T00:00:00.001Z',
        traceId: 'trace-1',
        reasoningText: 'thinking',
        metadata: { source: 'runtime' },
      },
    ]);
    assert.equal(snapshot.executionBinding?.modelId, 'local/qwen2.5');
    assert.equal(snapshot.activeTurn?.turnId, 'turn-1');
    assert.equal(snapshot.activeTurn?.streamId, 'stream-1');
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
              agent_id: LOCAL_AGENT_REF,
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              detail: { request_id: 'req-1' },
            });
            yield createAppEvent('runtime.agent.turn.completed', {
              agent_id: LOCAL_AGENT_REF,
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
      ...LOCAL_AGENT_IDENTITY,
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
              agent_id: LOCAL_AGENT_REF,
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
              ...LOCAL_AGENT_IDENTITY,
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
              ...LOCAL_AGENT_IDENTITY,
              detail: {
                oneofKind: 'hook',
                hook: {
                  family: HookAdmissionState.PENDING,
                  intent: {
                    intentId: 'hook-no-origin',
                    agentId: LOCAL_AGENT_REF,
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
              ...LOCAL_AGENT_IDENTITY,
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
              localAgentRef: 'local-agent:subject-1:agent-other', ownerUserId: 'subject-1', realmAgentId: 'agent-other',
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
      ...LOCAL_AGENT_IDENTITY,
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
    ...LOCAL_AGENT_IDENTITY,
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
    ...LOCAL_AGENT_IDENTITY,
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
