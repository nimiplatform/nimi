import {
  assert,
  test,
  createAgentTailAbortSignal,
  createAgentLocalChatConversationProvider,
  AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  clearAllStreams,
  clearStream,
  feedStreamEvent,
  startStream,
  installFakeTimers,
  createRuntimeAdapter,
  createBeatActionEnvelopeText,
  createContinuityAdapter,
  sampleTurnInput,
  collectEvents,
} from './chat-agent-orchestration-provider-test-utils.js';
import type {
  ConversationRuntimeTextStreamPart,
  AgentCommitInput,
  AgentRuntimeStreamRequest,
} from './chat-agent-orchestration-provider-test-utils.js';

test('agent local chat provider seals a single message before terminal and commits completed turn', async () => {
  const runtimeCalls: Array<{
    prompt?: string;
    systemPrompt?: string | null;
    messages?: AgentRuntimeStreamRequest['messages'];
  }> = [];
  const runtimeAdapter = createRuntimeAdapter({
    async streamText(request) {
      const envelopeText = createBeatActionEnvelopeText({
        beats: [{
          beatIndex: 0,
          text: 'hello world',
        }],
      });
      runtimeCalls.push({
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        messages: request.messages,
      });
      async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
        yield { type: 'start' };
        yield { type: 'reasoning-delta', textDelta: 'thinking' };
        yield { type: 'text-delta', textDelta: envelopeText.slice(0, 18) };
        yield { type: 'text-delta', textDelta: envelopeText.slice(18) };
        yield {
          type: 'finish',
          finishReason: 'stop',
          trace: {
            traceId: 'trace-1',
            promptTraceId: 'prompt-1',
          },
        };
      }
      return { stream: stream() };
    },
  });
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter,
    continuityAdapter: createContinuityAdapter(committed),
  });

  const events = await collectEvents(provider, sampleTurnInput());
  const eventTypes = events.map((event) => event.type);

  assert.equal(runtimeCalls.length, 1);
  assert.match(runtimeCalls[0]?.systemPrompt || '', /"userPrefs": \{[\s\S]*"brevity": true/);
  assert.match(runtimeCalls[0]?.systemPrompt || '', /Output Contract:/);
  assert.deepEqual(runtimeCalls[0]?.messages, [
    {
      role: 'user',
      text: 'What should we do next?',
    },
  ]);
  assert.deepEqual(
    eventTypes,
    [
      'turn-started',
      'reasoning-delta',
      'message-sealed',
      'projection-rebuilt',
      'turn-completed',
    ],
  );
  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'completed');
  assert.match(String(committed[0]?.textMessageState?.metadataJson?.prompt || ''), /^Messages:\n\[/);
  assert.match(String(committed[0]?.textMessageState?.metadataJson?.rawModelOutput || ''), /^<message/);
  assert.equal(committed[0]?.events.some((event) => event.type === 'message-sealed'), true);
  assert.equal(events.at(-1)?.type, 'turn-completed');
});

test('agent local chat provider emits a first-packet text-delta when raw output starts without reasoning deltas', async () => {
  const envelopeText = createBeatActionEnvelopeText({
    beats: [{
      beatIndex: 0,
      text: 'hello world',
    }],
  });
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText.slice(0, 24) };
          yield { type: 'text-delta', textDelta: envelopeText.slice(24) };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-first-packet',
              promptTraceId: 'prompt-first-packet',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter([]),
  });

  const events = await collectEvents(provider, sampleTurnInput());
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'turn-started',
      'text-delta',
      'message-sealed',
      'projection-rebuilt',
      'turn-completed',
    ],
  );
  const firstPacketEvent = events.find((event) => event.type === 'text-delta');
  assert.equal(firstPacketEvent?.type === 'text-delta' ? firstPacketEvent.textDelta : null, '');
});

test('agent local chat provider prefers runtime.agent structured turns when the adapter exposes them', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamAgentTurn() {
        async function* stream() {
          yield { type: 'reasoning-delta' as const, textDelta: 'thinking' };
          yield {
            type: 'message-sealed' as const,
            envelope: {
              schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
              message: {
                messageId: 'runtime-message-1',
                text: 'hello from runtime.agent',
              },
              statusCue: {
                sourceMessageId: 'runtime-message-1',
                mood: 'focus' as const,
              },
              actions: [],
            },
            trace: {
              traceId: 'runtime-trace-1',
              promptTraceId: 'runtime-trace-1',
              modelResolved: 'kimi',
              routeDecision: 'cloud',
            },
            diagnostics: {
              transport: 'runtime.agent.turns',
              conversationAnchorId: 'anchor-1',
              runtimeTurnId: 'runtime-turn-1',
              runtimeStreamId: 'runtime-stream-1',
            },
          };
          yield {
            type: 'turn-completed' as const,
            outputText: 'hello from runtime.agent',
            finishReason: 'stop',
            trace: {
              traceId: 'runtime-trace-1',
              promptTraceId: 'runtime-trace-1',
              modelResolved: 'kimi',
              routeDecision: 'cloud',
            },
            diagnostics: {
              transport: 'runtime.agent.turns',
              conversationAnchorId: 'anchor-1',
              runtimeTurnId: 'runtime-turn-1',
              runtimeStreamId: 'runtime-stream-1',
            },
          };
        }
        return { stream: stream() };
      },
      async streamText() {
        throw new Error('legacy raw runtime path should not be used');
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:runtime-agent'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'turn-started',
      'reasoning-delta',
      'message-sealed',
      'projection-rebuilt',
      'turn-completed',
    ],
  );
  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'completed');
  assert.equal(committed[0]?.textMessageState?.messageId, 'runtime-message-1');
  assert.equal(committed[0]?.events.some((event) => event.type === 'text-delta'), false);
  assert.equal(
    String((committed[0]?.textMessageState?.metadataJson?.runtimeAgentTurns as Record<string, unknown> | undefined)?.conversationAnchorId || ''),
    'anchor-1',
  );
});

test('agent local chat provider forwards prior runtime.agent.turns anchor metadata into the next turn request', async () => {
  const observedHistory: AgentRuntimeStreamRequest['history'][] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamAgentTurn(request) {
        observedHistory.push(request.history || []);
        async function* stream() {
          yield {
            type: 'message-sealed' as const,
            envelope: {
              schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
              message: {
                messageId: 'runtime-message-reuse',
                text: 'reused runtime session',
              },
              statusCue: null,
              actions: [],
            },
            trace: {
              traceId: 'runtime-trace-reuse',
              promptTraceId: 'runtime-trace-reuse',
            },
            diagnostics: {
              transport: 'runtime.agent.turns',
              conversationAnchorId: 'anchor-reused',
              runtimeTurnId: 'runtime-turn-reuse',
              runtimeStreamId: 'runtime-stream-reuse',
            },
          };
          yield {
            type: 'turn-completed' as const,
            outputText: 'reused runtime session',
            finishReason: 'stop',
            trace: {
              traceId: 'runtime-trace-reuse',
              promptTraceId: 'runtime-trace-reuse',
            },
            diagnostics: {
              transport: 'runtime.agent.turns',
              conversationAnchorId: 'anchor-reused',
              runtimeTurnId: 'runtime-turn-reuse',
              runtimeStreamId: 'runtime-stream-reuse',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter([], 'truth:runtime-agent-reuse'),
  });

  await collectEvents(provider, sampleTurnInput({
    history: [{
      id: 'message-prev-runtime',
      role: 'assistant',
      text: 'Previous runtime response',
      metadata: {
        runtimeAgentTurns: {
          transport: 'runtime.agent.turns',
          conversationAnchorId: 'anchor-reused',
          runtimeTurnId: 'runtime-turn-previous',
          runtimeStreamId: 'runtime-stream-previous',
          route: 'local',
          modelId: 'kimi-k2',
          connectorId: null,
        },
      },
    }],
    agentLocalChat: {
      agentResolution: {
        ready: true,
      },
      textExecutionSnapshot: {
        conversationCapabilitySlice: {
          capability: 'text.generate',
        },
        resolvedBinding: {
          source: 'local',
          provider: 'ollama',
          modelId: 'kimi-k2',
          localModelId: 'kimi-k2',
          localProviderEndpoint: 'http://127.0.0.1:11434',
        },
      },
    },
  }));

  assert.equal(observedHistory.length, 1);
  assert.equal(
    String(((observedHistory[0]?.[0]?.metadata as Record<string, unknown> | undefined)?.runtimeAgentTurns as Record<string, unknown> | undefined)?.conversationAnchorId || ''),
    'anchor-reused',
  );
});

test('agent local chat provider does not locally schedule follow-up timers for runtime.agent turns', async () => {
  const fakeTimers = installFakeTimers();
  const committed: AgentCommitInput[] = [];
  try {
    const provider = createAgentLocalChatConversationProvider({
      runtimeAdapter: createRuntimeAdapter({
        async streamAgentTurn() {
          async function* stream() {
            yield {
              type: 'message-sealed' as const,
              envelope: {
                schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
                message: {
                  messageId: 'runtime-message-follow-up',
                  text: 'I will think about that.',
                },
                statusCue: null,
                actions: [],
              },
              trace: {
                traceId: 'runtime-trace-follow-up',
                promptTraceId: 'runtime-trace-follow-up',
              },
              diagnostics: {
                transport: 'runtime.agent.turns',
                conversationAnchorId: 'anchor-follow-up',
                runtimeTurnId: 'runtime-turn-follow-up',
                runtimeStreamId: 'runtime-stream-follow-up',
              },
            };
            yield {
              type: 'turn-completed' as const,
              outputText: 'I will think about that.',
              finishReason: 'stop',
              trace: {
                traceId: 'runtime-trace-follow-up',
                promptTraceId: 'runtime-trace-follow-up',
              },
            };
          }
          return { stream: stream() };
        },
        async streamText() {
          throw new Error('legacy raw runtime path should not be used');
        },
      }),
      continuityAdapter: createContinuityAdapter(committed, 'truth:runtime-agent-follow-up'),
    });

    const events = await collectEvents(provider, sampleTurnInput());

    assert.equal(events.some((event) => event.type === 'projection-rebuilt'), true);
    assert.equal(committed.length, 1);
    assert.deepEqual(fakeTimers.getTimerIds(), []);
  } finally {
    fakeTimers.restore();
  }
});

test('agent local chat provider commits canceled turns with turn scope before the envelope resolves', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: '<message id="message-0"' };
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:141:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'canceled');
  const canceledEvent = events.at(-1);
  assert.equal(canceledEvent?.type, 'turn-canceled');
  assert.equal(canceledEvent?.type === 'turn-canceled' ? canceledEvent.scope : null, 'turn');
});

test('agent local chat provider fails closed when desktop model emits runtime-owned APML hook', async () => {
  const fakeTimers = installFakeTimers();
  const committed: AgentCommitInput[] = [];
  try {
    const provider = createAgentLocalChatConversationProvider({
      runtimeAdapter: createRuntimeAdapter({
        async streamText() {
          const envelopeText = [
            '<message id="message-0">先给你一句短答。</message>',
            '<time-hook id="action-follow-up-0">',
            '  <delay-ms>400</delay-ms>',
            '  <effect kind="follow-up-turn"><prompt-text>过一会儿我再补一句跟进。</prompt-text></effect>',
            '</time-hook>',
          ].join('\n');
          async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
            yield { type: 'start' };
            yield { type: 'text-delta', textDelta: envelopeText };
            yield {
              type: 'finish',
              finishReason: 'stop',
              trace: {
                traceId: 'trace-follow-up-rejected',
                promptTraceId: 'prompt-follow-up-rejected',
              },
            };
          }
          return { stream: stream() };
        },
        async invokeText() {
          throw new Error('desktop follow-up timer path must not run');
        },
      }),
      continuityAdapter: createContinuityAdapter(committed, 'truth:151:t1:b1:s0:m0:r0'),
    });

    const events = await collectEvents(provider, sampleTurnInput());

    assert.equal(events.some((event) => event.type === 'projection-rebuilt'), true);
    const failedEvent = events.at(-1);
    assert.equal(failedEvent?.type, 'turn-failed');
    assert.equal(committed.length, 1);
    assert.equal(committed[0]?.outcome, 'failed');
    assert.deepEqual(fakeTimers.getTimerIds(), []);
    if (failedEvent?.type !== 'turn-failed') {
      assert.fail('expected follow-up action to fail closed');
    }
    assert.match(failedEvent.error.message, /Agent response format was invalid/);
  } finally {
    fakeTimers.restore();
  }
});

test('agent local chat provider fails closed when runtime.agent.turns completes without a structured projection', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamAgentTurn() {
        async function* stream() {
          yield {
            type: 'turn-completed' as const,
            outputText: 'unstructured runtime completion',
            finishReason: 'stop',
            trace: {
              traceId: 'runtime-trace-missing-structured',
              promptTraceId: 'runtime-trace-missing-structured',
              modelResolved: 'kimi-k2',
              routeDecision: 'local',
            },
            diagnostics: {
              transport: 'runtime.agent.turns',
              conversationAnchorId: 'anchor-missing-structured',
              runtimeTurnId: 'runtime-turn-missing-structured',
              runtimeStreamId: 'runtime-stream-missing-structured',
              route: 'local',
              modelId: 'kimi-k2',
              connectorId: null,
            },
          };
        }
        return { stream: stream() };
      },
      async streamText() {
        throw new Error('legacy raw runtime path should not be used');
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:runtime-agent-missing-structured'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'failed');
  assert.equal(events.some((event) => event.type === 'message-sealed'), false);
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.equal(failedEvent.error.code, 'RUNTIME_AGENT_CHAT_INVALID');
  assert.match(failedEvent.error.message, /completed without structured/i);
  assert.equal(
    (failedEvent.diagnostics as Record<string, unknown> | undefined)?.missingStructuredProjection,
    true,
  );
});

test('agent local chat provider can emit a second image beat from the resolved model action envelope', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-primary',
            beatIndex: 0,
            text: 'Here is the scene.',
          }],
          actions: [{
            actionId: 'action-image-1',
            actionIndex: 0,
            modality: 'image',
            promptText: '一张图片',
            sourceMessageId: 'beat-primary',
            sourceBeatIndex: 0,
          }],
        });
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-image-turn',
              promptTraceId: 'prompt-image-turn',
            },
          };
        }
        return { stream: stream() };
      },
      async generateImage(request) {
        assert.equal(request.prompt, '一张图片');
        return {
          mediaUrl: 'https://cdn.nimi.test/agent-image.png',
          mimeType: 'image/png',
          artifactId: 'artifact-image-1',
          traceId: 'trace-image-1',
          diagnostics: {
            imageJobSubmitMs: 40,
            imageLoadMs: 1200,
            imageGenerateMs: 5400,
            artifactHydrateMs: 30,
            queueWaitMs: 250,
            loadCacheHit: false,
            residentReused: false,
            residentRestarted: true,
            queueSerialized: true,
            profileOverrideStep: 25,
            profileOverrideCfgScale: 6,
            profileOverrideSampler: 'euler',
            profileOverrideScheduler: 'karras',
          },
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:150:t1:b2:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '请给我一张图片',
    agentLocalChat: {
      agentResolution: {
        ready: true,
        reason: 'ok',
        textProjection: {
          capability: 'text.generate',
          selectedBinding: { source: 'cloud', connectorId: 'connector-text', model: 'gpt-5.4-mini' },
          resolvedBinding: { capability: 'text.generate', source: 'cloud', provider: 'openai', model: 'gpt-5.4-mini', modelId: 'gpt-5.4-mini', connectorId: 'connector-text' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageProjection: {
          capability: 'image.generate',
          selectedBinding: { source: 'local', connectorId: '', model: 'flux' },
          resolvedBinding: { capability: 'image.generate', source: 'local', provider: 'local-image', model: 'flux', modelId: 'flux', connectorId: '', endpoint: 'http://127.0.0.1:7860' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageReady: true,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      imageExecutionSnapshot: { executionId: 'image-snapshot' },
    },
  }));

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'turn-started',
      'text-delta',
      'message-sealed',
      'beat-planned',
      'beat-delivery-started',
      'artifact-ready',
      'beat-delivered',
      'projection-rebuilt',
      'turn-completed',
    ],
  );
  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.imageState?.status, 'complete');
  assert.equal(committed[0]?.imageState?.mediaUrl, 'https://cdn.nimi.test/agent-image.png');
  const completedEvent = events.at(-1);
  assert.equal(completedEvent?.type, 'turn-completed');
  const diagnostics = (completedEvent as { diagnostics?: Record<string, unknown> } | undefined)?.diagnostics;
  const imageDiagnostics = diagnostics?.image as Record<string, unknown> | undefined;
  assert.equal(imageDiagnostics?.imageLoadMs, 1200);
  assert.equal(imageDiagnostics?.queueSerialized, true);
  assert.equal(imageDiagnostics?.profileOverrideSampler, 'euler');
});

test('agent local chat provider uses the resolved image prompt payload verbatim', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-selfie',
            beatIndex: 0,
            text: '给你看。',
          }],
          actions: [{
            actionId: 'action-selfie',
            actionIndex: 0,
            modality: 'image',
            promptText: '自拍照，柔和自然光，近景',
            sourceMessageId: 'beat-selfie',
            sourceBeatIndex: 0,
          }],
        });
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-selfie-turn',
              promptTraceId: 'prompt-selfie-turn',
            },
          };
        }
        return { stream: stream() };
      },
      async generateImage(request) {
        assert.equal(request.prompt, '自拍照，柔和自然光，近景');
        return {
          mediaUrl: 'https://cdn.nimi.test/selfie-image.png',
          mimeType: 'image/png',
          artifactId: 'artifact-selfie-1',
          traceId: 'trace-selfie-image',
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:152:t1:b2:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '能发一张自拍照吗？',
    agentLocalChat: {
      agentResolution: {
        ready: true,
        reason: 'ok',
        textProjection: {
          capability: 'text.generate',
          selectedBinding: { source: 'cloud', connectorId: 'connector-text', model: 'gpt-5.4-mini' },
          resolvedBinding: { capability: 'text.generate', source: 'cloud', provider: 'openai', model: 'gpt-5.4-mini', modelId: 'gpt-5.4-mini', connectorId: 'connector-text' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageProjection: {
          capability: 'image.generate',
          selectedBinding: { source: 'local', connectorId: '', model: 'flux' },
          resolvedBinding: { capability: 'image.generate', source: 'local', provider: 'local-image', model: 'flux', modelId: 'flux', connectorId: '', endpoint: 'http://127.0.0.1:7860' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageReady: true,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      imageExecutionSnapshot: { executionId: 'image-snapshot' },
    },
  }));

  assert.equal(events.some((event) => event.type === 'artifact-ready'), true);
  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.imageState?.status, 'complete');
  assert.equal(committed[0]?.imageState?.mediaUrl, 'https://cdn.nimi.test/selfie-image.png');
});

test('agent local chat image tail signal ignores text stream idle timeout', () => {
  const fakeTimers = installFakeTimers();
  const threadId = 'thread-tail-idle-timeout';
  try {
    const controller = startStream(threadId);
    feedStreamEvent(threadId, { type: 'text_delta', textDelta: 'partial text' });
    const tailSignal = createAgentTailAbortSignal(threadId, controller.signal);
    assert.ok(tailSignal, 'expected tail signal');

    const timerIds = fakeTimers.getTimerIds();
    const idleTimerId = timerIds[timerIds.length - 1];
    assert.ok(idleTimerId, 'expected idle timer to be registered');
    fakeTimers.runTimer(idleTimerId);

    assert.equal(tailSignal?.aborted, false);
  } finally {
    clearStream(threadId);
    clearAllStreams();
    fakeTimers.restore();
  }
});

test('agent local chat image tail signal still propagates user cancellation', () => {
  const threadId = 'thread-tail-user-cancel';
  try {
    const controller = startStream(threadId);
    feedStreamEvent(threadId, { type: 'text_delta', textDelta: 'partial text' });
    const tailSignal = createAgentTailAbortSignal(threadId, controller.signal);
    assert.ok(tailSignal, 'expected tail signal');

    controller.abort();

    assert.equal(tailSignal?.aborted, true);
  } finally {
    clearStream(threadId);
    clearAllStreams();
  }
});

test('agent local chat provider does not generate an image when the resolved envelope has no image action', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatIndex: 0,
            text: '那我先不发图。',
          }],
        });
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-no-image',
              promptTraceId: 'prompt-no-image',
            },
          };
        }
        return { stream: stream() };
      },
      async generateImage() {
        throw new Error('image generation should not run without a resolved image action');
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:150:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '先别发图，我们继续聊。',
    agentLocalChat: {
      agentResolution: {
        ready: true,
        reason: 'ok',
        textProjection: {
          capability: 'text.generate',
          selectedBinding: { source: 'cloud', connectorId: 'connector-text', model: 'gpt-5.4-mini' },
          resolvedBinding: { capability: 'text.generate', source: 'cloud', provider: 'openai', model: 'gpt-5.4-mini', modelId: 'gpt-5.4-mini', connectorId: 'connector-text' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageProjection: {
          capability: 'image.generate',
          selectedBinding: { source: 'local', connectorId: '', model: 'flux' },
          resolvedBinding: { capability: 'image.generate', source: 'local', provider: 'local-image', model: 'flux', modelId: 'flux', connectorId: '', endpoint: 'http://127.0.0.1:7860' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageReady: true,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      imageExecutionSnapshot: { executionId: 'image-snapshot' },
    },
  }));

  assert.equal(events.some((event) => event.type === 'artifact-ready'), false);
  assert.equal(committed[0]?.imageState?.status, 'none');
});
