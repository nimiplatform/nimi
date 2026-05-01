import {
  assert,
  path,
  test,
  clearPlatformClient,
  createPlatformClient,
  ScenarioJobStatus,
  createNimiError,
  toProtoStruct,
  ReasonCode,
  resetRuntimeLocalModelWarmCacheForTests,
  CORE_CHAT_AGENT_MOD_ID,
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntimeAgentTurn,
  streamChatAgentRuntime,
  synthesizeChatAgentVoiceRuntime,
  findRuntimeRouteModelProfile,
  resolveAgentChatRequestedMaxOutputTokens,
  resolveAgentTurnTotalTimeoutMs,
  findAgentConversationThreadByAgentId,
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
  hydrateAgentThreadBundleFromRuntimeSessionSnapshot,
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
  createEmptyAIConfig,
  readWorkspaceFile,
  createRuntimeTurnTimeline,
  createLocalTextProjection,
  createCloudTextProjection,
} from './chat-agent-local-mode-test-utils.js';
import type {
  AgentLocalThreadSummary,
  CapturedRuntimeTextStreamInput,
} from './chat-agent-local-mode-test-utils.js';

test('agent runtime turns interrupt stays bound to the aborted anchor and does not cross-wire sibling anchors', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
    appId: 'nimi.desktop.test.anchor-interrupt',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const subscribeCalls: Array<{ agentId: string; conversationAnchorId?: string }> = [];
  const requestCalls: Array<{ agentId: string; conversationAnchorId: string; threadId: string }> = [];
  const interruptCalls: Array<{ agentId: string; conversationAnchorId: string; turnId?: string; reason: string }> = [];
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
        subscribe: async (request: { agentId: string; conversationAnchorId?: string }) => {
          subscribeCalls.push(request);
          return {
            async *[Symbol.asyncIterator]() {
              // Keep the stream inert. This test only proves interrupt routing.
            },
          };
        },
        request: async (request: { agentId: string; conversationAnchorId: string; threadId: string }) => {
          requestCalls.push(request);
        },
        interrupt: async (request: { agentId: string; conversationAnchorId: string; turnId?: string; reason: string }) => {
          interruptCalls.push(request);
        },
      },
    },
  };

  try {
    const projection = createLocalTextProjection();
    const agentResolution = buildAgentEffectiveCapabilityResolution({
      textProjection: projection,
    });
    const executionSnapshot = createAISnapshot({
      config: createEmptyAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const anchorAController = new AbortController();
    const anchorBController = new AbortController();
    await streamChatAgentRuntimeAgentTurn({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-a',
      threadId: 'thread-a',
      messages: [{ role: 'user', text: 'hello anchor a' }],
      reasoningPreference: 'off',
      agentResolution,
      textExecutionSnapshot: executionSnapshot,
      runtimeConfigState: null,
      runtimeFields: {
        targetType: '',
        targetAccountId: '',
        agentId: 'agent-1',
        targetId: '',
        worldId: '',
        provider: 'llama',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localProviderModel: 'llama3',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        connectorId: '',
        mode: 'STORY',
        turnIndex: 1,
        userConfirmedUpload: false,
      },
      signal: anchorAController.signal,
    });
    await streamChatAgentRuntimeAgentTurn({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-b',
      threadId: 'thread-b',
      messages: [{ role: 'user', text: 'hello anchor b' }],
      reasoningPreference: 'off',
      agentResolution,
      textExecutionSnapshot: executionSnapshot,
      runtimeConfigState: null,
      runtimeFields: {
        targetType: '',
        targetAccountId: '',
        agentId: 'agent-1',
        targetId: '',
        worldId: '',
        provider: 'llama',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localProviderModel: 'llama3',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        connectorId: '',
        mode: 'STORY',
        turnIndex: 2,
        userConfirmedUpload: false,
      },
      signal: anchorBController.signal,
    });

    anchorAController.abort();
    await Promise.resolve();

    assert.deepEqual(
      subscribeCalls.map((call) => call.conversationAnchorId),
      ['anchor-a', 'anchor-b'],
    );
    assert.deepEqual(
      requestCalls.map((call) => ({ conversationAnchorId: call.conversationAnchorId, threadId: call.threadId })),
      [
        { conversationAnchorId: 'anchor-a', threadId: 'thread-a' },
        { conversationAnchorId: 'anchor-b', threadId: 'thread-b' },
      ],
    );
    assert.deepEqual(interruptCalls, [{
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-a',
      reason: 'desktop_agent_chat_abort',
    }]);
  } finally {
    clearPlatformClient();
  }
});

test('agent runtime turn stream binds to the current request_id and ignores backlog turns on the same anchor', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
    appId: 'nimi.desktop.test.anchor-backlog',
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
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              turnId: 'turn-old',
              streamId: 'stream-old',
              detail: { requestId: 'request-old' },
            };
            yield {
              eventName: 'runtime.agent.turn.text_delta' as const,
              turnId: 'turn-old',
              streamId: 'stream-old',
              detail: { text: 'old backlog' },
            };
            while (!requestCalls[0]?.requestId) {
              await Promise.resolve();
            }
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              turnId: 'turn-new',
              streamId: 'stream-new',
              detail: { requestId: requestCalls[0]?.requestId || '' },
            };
            yield {
              eventName: 'runtime.agent.turn.structured' as const,
              turnId: 'turn-new',
              streamId: 'stream-new',
              detail: {
                kind: 'agent_resolved_message_action_envelope',
                payload: {
                  message: {
                    message_id: 'assistant-1',
                    text: '你好，我在。',
                  },
                  actions: [],
                },
              },
            };
            yield {
              eventName: 'runtime.agent.turn.message_committed' as const,
              turnId: 'turn-new',
              streamId: 'stream-new',
              messageId: 'assistant-1',
              detail: {
                messageId: 'assistant-1',
                text: '你好，我在。',
              },
            };
            yield {
              eventName: 'runtime.agent.turn.completed' as const,
              turnId: 'turn-new',
              streamId: 'stream-new',
              detail: {
                terminalReason: 'stop',
              },
            };
          },
        }),
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
    const executionSnapshot = createAISnapshot({
      config: createEmptyAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const result = await streamChatAgentRuntimeAgentTurn({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      threadId: 'thread-1',
      messages: [{ role: 'user', text: 'hello' }],
      reasoningPreference: 'off',
      agentResolution,
      textExecutionSnapshot: executionSnapshot,
      runtimeConfigState: null,
      runtimeFields: {
        targetType: '',
        targetAccountId: '',
        agentId: 'agent-1',
        targetId: '',
        worldId: '',
        provider: 'llama',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localProviderModel: 'llama3',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        connectorId: '',
        mode: 'STORY',
        turnIndex: 1,
        userConfirmedUpload: false,
      },
      signal: new AbortController().signal,
    });
    const parts: Array<{
      type: string;
      textDelta?: string;
      outputText?: string;
      diagnostics?: Record<string, unknown>;
      error?: {
        code?: string;
        message?: string;
      };
    }> = [];
    for await (const part of result.stream) {
      parts.push(part as {
        type: string;
        textDelta?: string;
        outputText?: string;
        diagnostics?: Record<string, unknown>;
        error?: {
          code?: string;
          message?: string;
        };
      });
    }

    assert.equal(requestCalls.length, 1);
    assert.match(requestCalls[0]?.requestId || '', /^runtime-agent-turn-request-/);
    assert.deepEqual(
      parts.map((part) => part.type),
      ['message-sealed', 'turn-completed'],
    );
    assert.equal(parts[1]?.outputText, '你好，我在。');
    assert.equal('runtimeTurnTimelines' in (parts[1]?.diagnostics || {}), false);
  } finally {
    clearPlatformClient();
  }
});

test('agent runtime turn starts consuming subscription events before request ack', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
    appId: 'nimi.desktop.test.anchor-agent-eager-subscription',
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
  let subscriptionIteratorStarted = false;
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
            subscriptionIteratorStarted = true;
            while (!requestCalls[0]?.requestId) {
              await Promise.resolve();
            }
            const requestId = requestCalls[0]?.requestId || '';
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              turnId: 'turn-eager',
              streamId: 'stream-eager',
              detail: { requestId },
            };
            yield {
              eventName: 'runtime.agent.turn.started' as const,
              turnId: 'turn-eager',
              streamId: 'stream-eager',
              detail: {},
            };
            yield {
              eventName: 'runtime.agent.turn.structured' as const,
              turnId: 'turn-eager',
              streamId: 'stream-eager',
              detail: {
                kind: 'agent_resolved_message_action_envelope',
                payload: {
                  message: {
                    message_id: 'assistant-eager',
                    text: 'hello from runtime',
                  },
                  actions: [],
                },
              },
            };
            yield {
              eventName: 'runtime.agent.turn.message_committed' as const,
              turnId: 'turn-eager',
              streamId: 'stream-eager',
              messageId: 'assistant-eager',
              detail: {
                messageId: 'assistant-eager',
                text: 'hello from runtime',
              },
            };
            yield {
              eventName: 'runtime.agent.turn.completed' as const,
              turnId: 'turn-eager',
              streamId: 'stream-eager',
              detail: {
                terminalReason: 'stop',
              },
            };
          },
        }),
        request: async (request: {
          agentId: string;
          conversationAnchorId: string;
          requestId?: string;
          threadId: string;
        }) => {
          requestCalls.push(request);
          await Promise.resolve();
          assert.equal(subscriptionIteratorStarted, true);
          return { messageId: 'runtime-request-message-1' };
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
    const executionSnapshot = createAISnapshot({
      config: createEmptyAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const result = await streamChatAgentRuntimeAgentTurn({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-eager',
      threadId: 'thread-eager',
      messages: [{ role: 'user', text: 'hello eager' }],
      reasoningPreference: 'off',
      agentResolution,
      textExecutionSnapshot: executionSnapshot,
      runtimeConfigState: null,
      runtimeFields: {
        targetType: '',
        targetAccountId: '',
        agentId: 'agent-1',
        targetId: '',
        worldId: '',
        provider: 'llama',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localProviderModel: 'llama3',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        connectorId: '',
        mode: 'STORY',
        turnIndex: 1,
        userConfirmedUpload: false,
      },
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
    assert.equal(subscriptionIteratorStarted, true);
    assert.deepEqual(
      parts.map((part) => part.type),
      ['message-sealed', 'turn-completed'],
    );
    assert.equal(parts[1]?.outputText, 'hello from runtime');
  } finally {
    clearPlatformClient();
  }
});

test('agent runtime turn recovers terminal projection from authoritative runtime snapshot when subscription misses commit events', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
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
                schema_id: 'agent_resolved_message_action_envelope',
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
    const executionSnapshot = createAISnapshot({
      config: createEmptyAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const result = await streamChatAgentRuntimeAgentTurn({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-snapshot',
      threadId: 'thread-snapshot',
      messages: [{ role: 'user', text: 'hello snapshot' }],
      reasoningPreference: 'off',
      agentResolution,
      textExecutionSnapshot: executionSnapshot,
      runtimeConfigState: null,
      runtimeFields: {
        targetType: '',
        targetAccountId: '',
        agentId: 'agent-1',
        targetId: '',
        worldId: '',
        provider: 'llama',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localProviderModel: 'llama3',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        connectorId: '',
        mode: 'STORY',
        turnIndex: 1,
        userConfirmedUpload: false,
      },
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
    clearPlatformClient();
  }
});

test('agent runtime turn consumes runtime-owned projection events from anchor app messages', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
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
    const executionSnapshot = createAISnapshot({
      config: createEmptyAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });

    const result = await streamChatAgentRuntimeAgentTurn({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-projection',
      threadId: 'thread-projection',
      messages: [{ role: 'user', text: 'hello projection' }],
      reasoningPreference: 'off',
      agentResolution,
      textExecutionSnapshot: executionSnapshot,
      runtimeConfigState: null,
      runtimeFields: {
        targetType: '',
        targetAccountId: '',
        agentId: 'agent-1',
        targetId: '',
        worldId: '',
        provider: 'llama',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:11434/v1',
        localProviderModel: 'llama3',
        localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
        connectorId: '',
        mode: 'STORY',
        turnIndex: 1,
        userConfirmedUpload: false,
      },
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
    clearPlatformClient();
  }
});
