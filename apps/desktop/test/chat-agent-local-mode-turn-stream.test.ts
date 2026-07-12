import {
  assert,
  test,
  clearDesktopTestNimiClientSession,
  createDesktopTestNimiClientSession,
  streamChatAgentRuntimeAgentTurn,
} from './chat-agent-local-mode-test-utils.js';
import { createRuntimeAgentChatConversationProvider } from '../src/shell/renderer/features/chat/chat-agent-runtime-provider.js';

test('agent runtime turns interrupt stays bound to the aborted anchor and does not cross-wire sibling anchors', async () => {
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.anchor-interrupt',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const subscribeCalls: Array<{ ownerUserId: string; runtimeSourceRef: string; localAgentRef: string; conversationAnchorId?: string }> = [];
  const requestCalls: Array<{ ownerUserId: string; runtimeSourceRef: string; localAgentRef: string; conversationAnchorId: string; threadId: string }> = [];
  const interruptCalls: Array<{ ownerUserId: string; runtimeSourceRef: string; localAgentRef: string; conversationAnchorId: string; turnId?: string; reason: string }> = [];
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
        subscribe: async (request: { ownerUserId: string; runtimeSourceRef: string; localAgentRef: string; conversationAnchorId?: string }) => {
          subscribeCalls.push(request);
          return {
            async *[Symbol.asyncIterator]() {
              // Keep the stream inert. This test only proves interrupt routing.
            },
          };
        },
        request: async (request: { ownerUserId: string; runtimeSourceRef: string; localAgentRef: string; conversationAnchorId: string; threadId: string }) => {
          requestCalls.push(request);
        },
        interrupt: async (request: { ownerUserId: string; runtimeSourceRef: string; localAgentRef: string; conversationAnchorId: string; turnId?: string; reason: string }) => {
          interruptCalls.push(request);
        },
      },
    },
  };

  try {
    const anchorAController = new AbortController();
    const anchorBController = new AbortController();
    await streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-a',
      threadId: 'thread-a',
      userMessageId: 'user-anchor-a',
      userText: 'hello anchor a',
      reasoningPreference: 'off',
      signal: anchorAController.signal,
    });
    await streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-b',
      threadId: 'thread-b',
      userMessageId: 'user-anchor-b',
      userText: 'hello anchor b',
      reasoningPreference: 'off',
      signal: anchorBController.signal,
    });

    anchorAController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

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
    assert.deepEqual(interruptCalls.map((call) => ({
      ownerUserId: call.ownerUserId,
      runtimeSourceRef: call.runtimeSourceRef,
      localAgentRef: call.localAgentRef,
      conversationAnchorId: call.conversationAnchorId,
      reason: call.reason,
    })), [{
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-a',
      reason: 'user_cancel',
    }]);
  } finally {
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime turn stream binds to the current request_id and ignores backlog turns on the same anchor', async () => {
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
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
              localAgentRef: 'local-agent:user-1:agent-1',
              conversationAnchorId: 'anchor-backlog',
              turnId: 'turn-old',
              streamId: 'stream-old',
              detail: { requestId: 'request-old' },
            };
            yield {
              eventName: 'runtime.agent.turn.text_delta' as const,
              localAgentRef: 'local-agent:user-1:agent-1',
              conversationAnchorId: 'anchor-backlog',
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
    const result = await streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-1',
      threadId: 'thread-1',
      userMessageId: 'user-anchor-1',
      userText: 'hello',
      reasoningPreference: 'off',
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
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime turn starts consuming subscription events before request ack', async () => {
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
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
    const result = await streamChatAgentRuntimeAgentTurn({
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-eager',
      threadId: 'thread-eager',
      userMessageId: 'user-eager-1',
      userText: 'hello eager',
      reasoningPreference: 'off',
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
    clearDesktopTestNimiClientSession();
  }
});

test('agent runtime provider projects Runtime image action artifact events as image beats', async () => {
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.runtime-owned-image-action',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  (client as unknown as { runtime: unknown }).runtime = {
    artifacts: {
      readArtifactBytes: async (request: { artifactId: string }) => {
        assert.equal(request.artifactId, 'artifact-image-1');
        return {
          artifactId: request.artifactId,
          mimeType: 'image/png',
          bytes: new Uint8Array([105, 109, 97, 103, 101]),
          sizeBytes: 5,
        };
      },
    },
  };
  const runtimeThreadIds: string[] = [];
  const provider = createRuntimeAgentChatConversationProvider({
    runtimeAdapter: {
      streamAgentTurn: async (input) => {
        runtimeThreadIds.push(input.threadId);
        return {
          stream: (async function* stream() {
            yield {
              type: 'message-sealed' as const,
              envelope: {
                schemaId: 'nimi.agent.chat.message-action.v1',
                message: {
                  messageId: 'assistant-image',
                  text: 'I can make that image.',
                },
                actions: [],
              },
            };
            yield {
              type: 'beat-planned' as const,
              turnId: 'runtime-turn-image',
              beatId: 'action-0',
              projectionMessageId: 'runtime-turn-image:message:1',
            };
            yield {
              type: 'beat-delivery-started' as const,
              turnId: 'runtime-turn-image',
              beatId: 'action-0',
              projectionMessageId: 'runtime-turn-image:message:1',
            };
            yield {
              type: 'artifact-ready' as const,
              turnId: 'runtime-turn-image',
              beatId: 'action-0',
              artifactId: 'artifact-image-1',
              mimeType: 'image/png',
              projectionMessageId: 'runtime-turn-image:message:1',
            };
            yield {
              type: 'beat-delivered' as const,
              turnId: 'runtime-turn-image',
              beatId: 'action-0',
              projectionMessageId: 'runtime-turn-image:message:1',
            };
            yield {
              type: 'turn-completed' as const,
              outputText: 'I can make that image.',
              finishReason: 'stop',
            };
          })(),
        };
      },
    },
  });

  const events = [];
  try {
    for await (const event of provider.runTurn({
      modeId: 'runtime-agent-chat-v1',
      threadId: 'thread-image',
      turnId: 'turn-image',
      userMessage: {
        id: 'user-image',
        text: 'send me a photo',
      },
      history: [],
      metadata: {
        ownerUserId: 'user-1',
        runtimeSourceRef: 'agent-1',
        localAgentRef: 'local-agent:user-1:agent-1',
        conversationAnchorId: 'anchor-image',
        runtimeThreadId: 'runtime-thread-image',
        reasoningPreference: 'off',
        textMaxOutputTokensRequested: null,
      },
    })) {
      events.push(event);
    }
  } finally {
    clearDesktopTestNimiClientSession();
  }

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'turn-started',
      'message-sealed',
      'beat-planned',
      'beat-delivery-started',
      'artifact-ready',
      'beat-delivered',
      'turn-completed',
    ],
  );
  const imageBeat = events.find((event) => event.type === 'beat-planned');
  assert.equal(imageBeat?.beatId, 'turn-image:beat:1');
  assert.equal(imageBeat?.beatIndex, 1);
  assert.equal(imageBeat?.modality, 'image');
  const artifact = events.find((event) => event.type === 'artifact-ready');
  assert.equal(artifact?.artifactId, 'artifact-image-1');
  assert.equal(artifact?.uri, 'data:image/png;base64,aW1hZ2U=');
  assert.deepEqual(runtimeThreadIds, ['runtime-thread-image']);
});
