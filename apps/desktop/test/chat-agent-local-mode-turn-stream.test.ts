import {
  assert,
  test,
  clearPlatformClient,
  createPlatformClient,
  streamChatAgentRuntimeAgentTurn,
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
  createEmptyAIConfig,
  createLocalTextProjection,
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
