import {
  assert,
  test,
  clearDesktopTestNimiClientSession,
  createDesktopTestNimiClientSession,
  streamChatAgentRuntimeAgentTurn,
  buildAgentEffectiveCapabilityResolution,
  createNimiConversationAISnapshot,
  createEmptyNimiAIConfig,
  createRuntimeTurnTimeline,
  createLocalTextProjection,
} from './chat-agent-local-mode-test-utils.js';

test('agent runtime turn recovers terminal projection from authoritative runtime snapshot when subscription misses commit events', async () => {
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-agent-snapshot-recovery',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const requestCalls: Array<{
    agentId: string;
    conversationAnchorId: string;
    requestId?: string;
    threadId: string;
  }> = [];
  const snapshotCalls: Array<{
    agentId: string;
    conversationAnchorId: string;
    requestId?: string;
  }> = [];
  (client as unknown as { runtime: unknown }).runtime = {
    local: {
      listLocalAssets: async () => ({
        assets: [{
          localAssetId: 'local-model-1',
          assetId: 'llama3',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:11434/v1',
          updatedAt: '2026-04-23T00:00:00.000Z',
          status: 2,
        }],
        nextPageToken: '',
      }),
      warmLocalAsset: async () => ({
        asset: {
          localAssetId: 'local-model-1',
        },
      }),
    },
    agent: {
      turns: {
        subscribe: async () => ({
          async *[Symbol.asyncIterator]() {
            while (!requestCalls[0]?.requestId) {
              await Promise.resolve();
            }
            const requestId = requestCalls[0]?.requestId || '';
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              turnId: 'turn-snapshot',
              streamId: 'stream-snapshot',
              detail: { requestId },
            };
            yield {
              eventName: 'runtime.agent.turn.started' as const,
              turnId: 'turn-snapshot',
              streamId: 'stream-snapshot',
              detail: {},
            };
          },
        }),
        getSessionSnapshot: async (request: {
          agentId: string;
          conversationAnchorId: string;
          requestId?: string;
        }) => {
          snapshotCalls.push(request);
          return {
            requestId: request.requestId,
            threadId: 'thread-snapshot',
            lastTurn: {
              turnId: 'turn-snapshot',
              status: 'completed',
              messageId: 'assistant-snapshot',
              text: 'snapshot recovered response',
              finishReason: 'stop',
              structured: {
                schema_id: 'nimi.agent.chat.message-action.v1',
                message: {
                  message_id: 'assistant-snapshot',
                  text: 'snapshot recovered response',
                },
                actions: [],
              },
            },
          };
        },
        request: async (request: {
          agentId: string;
          conversationAnchorId: string;
          requestId?: string;
          threadId: string;
        }) => {
          requestCalls.push(request);
          return { messageId: 'runtime-request-message-snapshot' };
        },
        interrupt: async () => undefined,
      },
    },
  };

  try {
    const projection = createLocalTextProjection();
    const agentResolution = buildAgentEffectiveCapabilityResolution({
      textProjection: projection,
    });
    const executionSnapshot = createNimiConversationAISnapshot({
      config: createEmptyNimiAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const result = await streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-snapshot',
      threadId: 'thread-snapshot',
      userMessageId: 'user-snapshot-1',
      userText: 'hello snapshot',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    });
    const parts: Array<{
      type: string;
      outputText?: string;
    }> = [];
    for await (const part of result.stream) {
      parts.push(part as {
        type: string;
        outputText?: string;
      });
    }

    assert.equal(requestCalls.length, 1);
    assert.equal(snapshotCalls.length >= 1, true);
    assert.equal(snapshotCalls[0]?.requestId, requestCalls[0]?.requestId);
    assert.deepEqual(
      parts.map((part) => part.type),
      ['message-sealed', 'turn-completed'],
    );
    assert.equal(parts[1]?.outputText, 'snapshot recovered response');
  } finally {
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime turn binds current active turn from snapshot when accepted event is missed', async () => {
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-agent-snapshot-active-bind',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const requestCalls: Array<{
    agentId: string;
    conversationAnchorId: string;
    requestId?: string;
    threadId: string;
  }> = [];
  let snapshotCallCount = 0;
  (client as unknown as { runtime: unknown }).runtime = {
    local: {
      listLocalAssets: async () => ({
        assets: [{
          localAssetId: 'local-model-1',
          assetId: 'llama3',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:11434/v1',
          updatedAt: '2026-04-23T00:00:00.000Z',
          status: 2,
        }],
        nextPageToken: '',
      }),
      warmLocalAsset: async () => ({
        asset: {
          localAssetId: 'local-model-1',
        },
      }),
    },
    agent: {
      turns: {
        subscribe: async () => ({
          async *[Symbol.asyncIterator]() {
            while (!requestCalls[0]?.requestId) {
              await Promise.resolve();
            }
            yield* [];
          },
        }),
        getSessionSnapshot: async () => {
          snapshotCallCount += 1;
          if (snapshotCallCount === 1) {
            return {
              requestId: requestCalls[0]?.requestId,
              threadId: 'thread-active-bind',
              activeTurn: {
                turnId: 'turn-active-bind',
                status: 'started',
              },
              lastTurn: {
                turnId: 'turn-previous',
                status: 'completed',
                messageId: 'assistant-previous',
                text: 'previous response',
                finishReason: 'stop',
                structured: {
                  schema_id: 'nimi.agent.chat.message-action.v1',
                  message: {
                    message_id: 'assistant-previous',
                    text: 'previous response',
                  },
                  actions: [],
                },
              },
            };
          }
          return {
            requestId: requestCalls[0]?.requestId,
            threadId: 'thread-active-bind',
            lastTurn: {
              turnId: 'turn-active-bind',
              status: 'completed',
              messageId: 'assistant-active-bind',
              text: 'active bind recovered response',
              finishReason: 'stop',
              structured: {
                schema_id: 'nimi.agent.chat.message-action.v1',
                message: {
                  message_id: 'assistant-active-bind',
                  text: 'active bind recovered response',
                },
                actions: [],
              },
            },
          };
        },
        request: async (request: {
          agentId: string;
          conversationAnchorId: string;
          requestId?: string;
          threadId: string;
        }) => {
          requestCalls.push(request);
          return { messageId: 'runtime-request-message-active-bind' };
        },
        interrupt: async () => undefined,
      },
    },
  };

  try {
    const projection = createLocalTextProjection();
    const agentResolution = buildAgentEffectiveCapabilityResolution({
      textProjection: projection,
    });
    const executionSnapshot = createNimiConversationAISnapshot({
      config: createEmptyNimiAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const result = await streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-active-bind',
      threadId: 'thread-active-bind',
      userMessageId: 'user-active-bind-1',
      userText: 'hello active bind',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    });
    const parts: Array<{
      type: string;
      outputText?: string;
    }> = [];
    for await (const part of result.stream) {
      parts.push(part as {
        type: string;
        outputText?: string;
      });
    }

    assert.equal(requestCalls.length, 1);
    assert.equal(snapshotCallCount >= 2, true);
    assert.deepEqual(
      parts.map((part) => part.type),
      ['message-sealed', 'turn-completed'],
    );
    assert.equal(parts[1]?.outputText, 'active bind recovered response');
  } finally {
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime turn consumes runtime-owned projection events from anchor app messages', async () => {
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-agent-projection',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const subscribeCalls: Array<{
    agentId: string;
    conversationAnchorId?: string;
    includeAgentEvents?: boolean;
  }> = [];
  const requestCalls: Array<{
    agentId: string;
    conversationAnchorId: string;
    requestId?: string;
    threadId: string;
  }> = [];
  (client as unknown as { runtime: unknown }).runtime = {
    local: {
      listLocalAssets: async () => ({
        assets: [{
          localAssetId: 'local-model-1',
          assetId: 'llama3',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:11434/v1',
          updatedAt: '2026-04-23T00:00:00.000Z',
          status: 2,
        }],
        nextPageToken: '',
      }),
      warmLocalAsset: async () => ({
        asset: {
          localAssetId: 'local-model-1',
        },
      }),
    },
    agent: {
      turns: {
        subscribe: async (request: {
          agentId: string;
          conversationAnchorId?: string;
          includeAgentEvents?: boolean;
        }) => {
          subscribeCalls.push(request);
          return {
            async *[Symbol.asyncIterator]() {
              while (!requestCalls[0]?.requestId) {
                await Promise.resolve();
              }
              yield {
                eventName: 'runtime.agent.turn.accepted' as const,
                agentId: 'agent-1',
                conversationAnchorId: 'anchor-projection',
                turnId: 'turn-projection',
                streamId: 'stream-projection',
                timeline: createRuntimeTurnTimeline({
                  turnId: 'turn-projection',
                  streamId: 'stream-projection',
                  channel: 'state',
                  sequence: 1,
                }),
                detail: { requestId: requestCalls[0]?.requestId || '' },
              };
              yield {
                eventName: 'runtime.agent.state.status_text_changed' as const,
                agentId: 'agent-1',
                conversationAnchorId: 'other-anchor',
                detail: {
                  currentStatusText: 'wrong anchor',
                },
              };
              yield {
                eventName: 'runtime.agent.state.status_text_changed' as const,
                agentId: 'agent-1',
                conversationAnchorId: 'anchor-projection',
                originatingTurnId: 'turn-projection',
                originatingStreamId: 'stream-projection',
                detail: {
                  currentStatusText: 'thinking',
                  previousStatusText: 'idle',
                },
              };
              yield {
                eventName: 'runtime.agent.hook.intent_proposed' as const,
                agentId: 'agent-1',
                conversationAnchorId: 'anchor-projection',
                originatingTurnId: 'turn-projection',
                originatingStreamId: 'stream-projection',
                detail: {
                  intentId: 'hook-1',
                  triggerFamily: 'event',
                  triggerDetail: { eventKind: 'user-idle' },
                  effect: 'follow-up-turn',
                  admissionState: 'proposed',
                },
              };
              yield {
                eventName: 'runtime.agent.presentation.activity_requested' as const,
                agentId: 'agent-1',
                conversationAnchorId: 'anchor-projection',
                turnId: 'turn-projection',
                streamId: 'stream-projection',
                detail: {
                  activityName: 'thinking',
                  category: 'interaction',
                  source: 'apml_output',
                },
              };
              yield {
                eventName: 'runtime.agent.turn.structured' as const,
                turnId: 'turn-projection',
                streamId: 'stream-projection',
                timeline: createRuntimeTurnTimeline({
                  turnId: 'turn-projection',
                  streamId: 'stream-projection',
                  channel: 'text',
                  sequence: 2,
                  offsetMs: 20,
                }),
                detail: {
                  kind: 'agent_resolved_message_action_envelope',
                  payload: {
                    message: {
                      message_id: 'assistant-1',
                      text: 'projection consumed',
                    },
                    actions: [],
                  },
                },
              };
              yield {
                eventName: 'runtime.agent.turn.message_committed' as const,
                turnId: 'turn-projection',
                streamId: 'stream-projection',
                messageId: 'assistant-1',
                timeline: createRuntimeTurnTimeline({
                  turnId: 'turn-projection',
                  streamId: 'stream-projection',
                  channel: 'text',
                  sequence: 3,
                  offsetMs: 30,
                }),
                detail: {
                  messageId: 'assistant-1',
                  text: 'projection consumed',
                },
              };
              yield {
                eventName: 'runtime.agent.turn.completed' as const,
                turnId: 'turn-projection',
                streamId: 'stream-projection',
                timeline: createRuntimeTurnTimeline({
                  turnId: 'turn-projection',
                  streamId: 'stream-projection',
                  channel: 'state',
                  sequence: 4,
                  offsetMs: 40,
                }),
                detail: {
                  terminalReason: 'stop',
                },
              };
            },
          };
        },
        request: async (request: {
          agentId: string;
          conversationAnchorId: string;
          requestId?: string;
          threadId: string;
        }) => {
          requestCalls.push(request);
        },
        interrupt: async () => undefined,
      },
    },
  };

  try {
    const projection = createLocalTextProjection();
    const agentResolution = buildAgentEffectiveCapabilityResolution({
      textProjection: projection,
    });
    const executionSnapshot = createNimiConversationAISnapshot({
      config: createEmptyNimiAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const result = await streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-projection',
      threadId: 'thread-projection',
      userMessageId: 'user-projection-1',
      userText: 'hello projection',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    });
    const parts: Array<{
      type: string;
      outputText?: string;
      diagnostics?: Record<string, unknown>;
    }> = [];
    for await (const part of result.stream) {
      parts.push(part as {
        type: string;
        outputText?: string;
        diagnostics?: Record<string, unknown>;
      });
    }

    assert.equal(subscribeCalls.length, 1);
    assert.equal(subscribeCalls[0]?.includeAgentEvents, false);
    assert.deepEqual(
      parts.map((part) => part.type),
      ['message-sealed', 'turn-completed'],
    );
    assert.equal(parts[1]?.outputText, 'projection consumed');
    const projectionEvents = parts[1]?.diagnostics?.runtimeProjectionEvents;
    assert.ok(Array.isArray(projectionEvents));
    const runtimeTimelines = parts[1]?.diagnostics?.runtimeTurnTimelines;
    assert.ok(Array.isArray(runtimeTimelines));
    const runtimeTimelineRecords = runtimeTimelines as Array<{
      turnId: string;
      streamId: string;
      channel: string;
      sequence: number;
      projectionRuleId: string;
      timebaseOwner: string;
      appLocalAuthority: boolean;
    }>;
    assert.deepEqual(
      runtimeTimelineRecords.map((timeline) => [timeline.channel, timeline.sequence]),
      [
        ['state', 1],
        ['text', 2],
        ['text', 3],
        ['state', 4],
      ],
    );
    assert.equal(runtimeTimelineRecords[0]?.turnId, 'turn-projection');
    assert.equal(runtimeTimelineRecords[0]?.streamId, 'stream-projection');
    assert.equal(runtimeTimelineRecords[0]?.projectionRuleId, 'K-AGCORE-051');
    assert.equal(runtimeTimelineRecords[0]?.timebaseOwner, 'runtime');
    assert.equal(runtimeTimelineRecords[0]?.appLocalAuthority, false);
    const projectionEventRecords = projectionEvents as Array<{
      eventName: string;
      runtimeTurnId: string | null;
      detail: Record<string, unknown>;
    }>;
    assert.deepEqual(
      projectionEventRecords.map((event) => event.eventName),
      [
        'runtime.agent.state.status_text_changed',
        'runtime.agent.hook.intent_proposed',
        'runtime.agent.presentation.activity_requested',
      ],
    );
    assert.equal(projectionEventRecords[0]?.runtimeTurnId, 'turn-projection');
    assert.equal(projectionEventRecords[1]?.detail.intentId, 'hook-1');
    assert.equal(projectionEventRecords[2]?.detail.activityName, 'thinking');
  } finally {
    clearDesktopTestNimiClientSession();
  }
});
