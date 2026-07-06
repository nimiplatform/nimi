import {
  assert,
  test,
  clearDesktopTestNimiClientSession,
  createDesktopTestNimiClientSession,
  createNimiError,
  ReasonCode,
  resetRuntimeLocalModelWarmCacheForTests,
  streamChatAgentRuntimeAgentTurn,
  buildAgentEffectiveCapabilityResolution,
  createNimiConversationAISnapshot,
  createEmptyNimiAIConfig,
  createLocalTextProjection,
  createCloudTextProjection,
} from './chat-agent-local-mode-test-utils.js';


test('agent runtime turn requests runtime without desktop local warm on local routes', async () => {
  resetRuntimeLocalModelWarmCacheForTests();
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-local-warm',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const calls: string[] = [];
  const requestCalls: Array<{
    requestId?: string;
    threadId: string;
    executionBindings?: Record<string, unknown>;
  }> = [];
  (client as unknown as { runtime: unknown }).runtime = {
    local: {
      listLocalAssets: async () => {
        calls.push('list');
        return {
          assets: [{
            localAssetId: 'local-model-1',
            assetId: 'llama3',
            engine: 'llama',
            endpoint: 'http://127.0.0.1:11434/v1',
            updatedAt: '2026-04-23T00:00:00.000Z',
            status: 2,
          }],
          nextPageToken: '',
        };
      },
      warmLocalAsset: async () => {
        calls.push('warm');
        return {
          asset: {
            localAssetId: 'local-model-1',
          },
        };
      },
    },
    agent: {
      turns: {
        subscribe: async () => ({
          async *[Symbol.asyncIterator]() {
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
                    text: 'ready',
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
                text: 'ready',
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
          requestId?: string;
          threadId: string;
          executionBindings?: Record<string, unknown>;
        }) => {
          calls.push('request');
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
      conversationAnchorId: 'anchor-local',
      threadId: 'thread-local',
      userMessageId: 'user-local-1',
      userText: 'hello local',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    });
    for await (const ignoredPart of result.stream) {
      void ignoredPart;
      // Drain terminal events.
    }

    assert.deepEqual(calls, ['request']);
    // Atomic hard cut: the turn request carries NO execution bindings; the
    // runtime resolves execution from the committed config (K-AGCORE-147).
    assert.equal('executionBindings' in (requestCalls[0] ?? {}), false);
  } finally {
    resetRuntimeLocalModelWarmCacheForTests();
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime turn request carries no execution bindings to Runtime', async () => {
  resetRuntimeLocalModelWarmCacheForTests();
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-cloud-binding',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const requestCalls: Array<{
    requestId?: string;
    threadId: string;
    executionBindings?: Record<string, unknown>;
  }> = [];
  (client as unknown as { runtime: unknown }).runtime = {
    local: {
      listLocalAssets: async () => ({
        assets: [],
        nextPageToken: '',
      }),
      warmLocalAsset: async () => ({
        asset: {
          localAssetId: 'unused-cloud',
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
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              turnId: 'turn-cloud',
              streamId: 'stream-cloud',
              detail: { requestId: requestCalls[0]?.requestId || '' },
            };
            yield {
              eventName: 'runtime.agent.turn.structured' as const,
              turnId: 'turn-cloud',
              streamId: 'stream-cloud',
              detail: {
                kind: 'agent_resolved_message_action_envelope',
                payload: {
                  message: {
                    message_id: 'assistant-cloud-1',
                    text: 'ready cloud',
                  },
                  actions: [],
                },
              },
            };
            yield {
              eventName: 'runtime.agent.turn.message_committed' as const,
              turnId: 'turn-cloud',
              streamId: 'stream-cloud',
              messageId: 'assistant-cloud-1',
              detail: {
                messageId: 'assistant-cloud-1',
                text: 'ready cloud',
              },
            };
            yield {
              eventName: 'runtime.agent.turn.completed' as const,
              turnId: 'turn-cloud',
              streamId: 'stream-cloud',
              detail: {
                terminalReason: 'stop',
              },
            };
          },
        }),
        request: async (request: {
          requestId?: string;
          threadId: string;
          executionBindings?: Record<string, unknown>;
        }) => {
          requestCalls.push(request);
        },
        interrupt: async () => undefined,
      },
    },
  };

  try {
    const projection = createCloudTextProjection();
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
      conversationAnchorId: 'anchor-cloud',
      threadId: 'thread-cloud',
      userMessageId: 'user-cloud-1',
      userText: 'hello cloud',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    });
    for await (const ignoredPart of result.stream) {
      void ignoredPart;
      // Drain terminal events.
    }

    assert.equal(requestCalls.length, 1);
    // Atomic hard cut: even with a resolved cloud route the request carries
    // NO execution bindings (runtime execution config is authoritative).
    assert.equal('executionBindings' in (requestCalls[0] ?? {}), false);
  } finally {
    resetRuntimeLocalModelWarmCacheForTests();
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime turn fails closed when runtime rejects request_id in turn payload', async () => {
  resetRuntimeLocalModelWarmCacheForTests();
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-legacy-request-id',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const requestCalls: Array<{
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
            while (requestCalls.length < 1) {
              await Promise.resolve();
            }
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              turnId: 'turn-legacy',
              streamId: 'stream-legacy',
              detail: { requestId: 'legacy-message-id' },
            };
            yield {
              eventName: 'runtime.agent.turn.structured' as const,
              turnId: 'turn-legacy',
              streamId: 'stream-legacy',
              detail: {
                kind: 'agent_resolved_message_action_envelope',
                payload: {
                  message: {
                    message_id: 'assistant-legacy-1',
                    text: 'legacy ready',
                  },
                  actions: [],
                },
              },
            };
            yield {
              eventName: 'runtime.agent.turn.message_committed' as const,
              turnId: 'turn-legacy',
              streamId: 'stream-legacy',
              messageId: 'assistant-legacy-1',
              detail: {
                messageId: 'assistant-legacy-1',
                text: 'legacy ready',
              },
            };
            yield {
              eventName: 'runtime.agent.turn.completed' as const,
              turnId: 'turn-legacy',
              streamId: 'stream-legacy',
              detail: {
                terminalReason: 'stop',
              },
            };
          },
        }),
        request: async (request: {
          requestId?: string;
          threadId: string;
        }) => {
          requestCalls.push(request);
          throw createNimiError({
            message: 'runtime rejects request_id',
            reasonCode: ReasonCode.PROTOCOL_ENVELOPE_INVALID,
            actionHint: 'fix_runtime_protocol_envelope',
            source: 'runtime',
          });
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

    await assert.rejects(() => streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-legacy',
      threadId: 'thread-legacy',
      userMessageId: 'user-legacy-1',
      userText: 'hello legacy',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    }), {
      reasonCode: ReasonCode.PROTOCOL_ENVELOPE_INVALID,
    });

    assert.equal(requestCalls.length, 1);
    assert.ok(requestCalls[0]?.requestId);
  } finally {
    resetRuntimeLocalModelWarmCacheForTests();
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime turn yields terminal turn-failed when runtime emits failed event', async () => {
  resetRuntimeLocalModelWarmCacheForTests();
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-turn-failed',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const requestCalls: Array<{
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
            while (!requestCalls[0]?.requestId) {
              await Promise.resolve();
            }
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              turnId: 'turn-failed',
              streamId: 'stream-failed',
              detail: { requestId: requestCalls[0]?.requestId || '' },
            };
            yield {
              eventName: 'runtime.agent.turn.text_delta' as const,
              turnId: 'turn-failed',
              streamId: 'stream-failed',
              detail: { text: 'partial output' },
            };
            yield {
              eventName: 'runtime.agent.turn.failed' as const,
              turnId: 'turn-failed',
              streamId: 'stream-failed',
              detail: {
                reasonCode: ReasonCode.AI_OUTPUT_INVALID,
                message: 'structured envelope parse failed',
              },
            };
          },
        }),
        request: async (request: {
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
      conversationAnchorId: 'anchor-failed',
      threadId: 'thread-failed',
      userMessageId: 'user-failed-1',
      userText: 'hello failed',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    });
    const parts: Array<{
      type: string;
      textDelta?: string;
      outputText?: string;
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
        error?: {
          code?: string;
          message?: string;
        };
      });
    }

    assert.equal(requestCalls.length, 1);
    assert.deepEqual(
      parts.map((part) => part.type),
      ['text-delta', 'turn-failed'],
    );
    assert.equal(parts[0]?.textDelta, 'partial output');
    assert.equal(parts[1]?.error?.code, ReasonCode.AI_OUTPUT_INVALID);
    assert.equal(parts[1]?.error?.message, 'structured envelope parse failed');
    assert.equal(parts[1]?.outputText, 'partial output');
  } finally {
    resetRuntimeLocalModelWarmCacheForTests();
    clearDesktopTestNimiClientSession();
  }
});
