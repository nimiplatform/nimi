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
  let capturedSessionSnapshotRequest: GetPublicChatSessionSnapshotRequest | null = null;

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
      if (input.methodId === RuntimeMethodIds.agent.getPublicChatSessionSnapshot) {
        capturedSessionSnapshotRequest = GetPublicChatSessionSnapshotRequest.fromBinary(input.request);
        return GetPublicChatSessionSnapshotResponse.toBinary(GetPublicChatSessionSnapshotResponse.create({
          snapshot: Struct.fromJson({ request_id: 'snapshot-1', session_status: 'idle' } as never),
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        capturedAppSubscribeRequest = SubscribeAppMessagesRequest.fromBinary(input.request);
        return {
          async *[Symbol.asyncIterator]() {},
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
    assert.equal(capturedSessionSnapshotRequest?.context?.subjectUserId, '');
    assert.equal(capturedSessionSnapshotRequest?.context?.scopedBinding?.bindingId, 'binding-1');
    assert.equal(capturedSessionSnapshotRequest?.agentId, 'agent-1');
    assert.equal(capturedSessionSnapshotRequest?.conversationAnchorId, 'anchor-1');
    assert.equal(capturedSessionSnapshotRequest?.worldId, 'world-1');
    assert.equal(capturedMessages.length, 2);
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
