import { describe, expect, it, vi } from 'vitest';
import type {
  NimiRunEvent,
} from '@nimiplatform/kit/core/sdk-contract';
import { ReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import {
  buildConversationHistoryWindow,
  ConversationOrchestrationRegistry,
  ConversationProviderNotRegisteredError,
  matchConversationTurnEvent,
  SIMPLE_AI_HISTORY_BUDGET,
} from '../src/headless.js';
import type {
  ConversationRuntimeAdapter,
  ConversationTurnEvent,
  ConversationTurnInput,
} from '../src/headless.js';
import {
  createSdkConversationRuntimeAdapter,
  createSimpleAiConversationProvider,
} from '../src/runtime.js';
import { createRuntimeAiTestRuntime } from './runtime-ai-test-helpers.js';

async function collectEvents(stream: AsyncIterable<ConversationTurnEvent>): Promise<ConversationTurnEvent[]> {
  const events: ConversationTurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function* sdkStream(parts: readonly NimiRunEvent[]): AsyncIterable<NimiRunEvent> {
  for (const part of parts) {
    yield part;
  }
}

function sdkStreamError(input: {
  reasonCode: string;
  message: string;
  traceId?: string;
}): NimiRunEvent {
  return {
    type: 'error',
    code: input.reasonCode,
    message: input.message,
    cause: input.traceId ? { traceId: input.traceId } : undefined,
  };
}

function createTurnInput(overrides: Partial<ConversationTurnInput> = {}): ConversationTurnInput {
  return {
    modeId: 'simple-ai',
    threadId: 'thread-1',
    turnId: 'turn-1',
    userMessage: {
      id: 'msg-user-1',
      text: 'What should we ship next?',
      attachments: [],
    },
    history: [
      { id: 'sys-1', role: 'system', text: 'ignore me' },
      { id: 'user-0', role: 'user', text: 'We need a plan.' },
      { id: 'assistant-0', role: 'assistant', text: 'Start with contract freeze.' },
    ],
    ...overrides,
  };
}

describe('chat orchestration primitives', () => {
  it('fails closed when a provider is not registered', () => {
    const registry = new ConversationOrchestrationRegistry();

    expect(() => registry.require('simple-ai')).toThrowError(ConversationProviderNotRegisteredError);
  });

  it('dispatches conversation turn events by discriminant only', () => {
    const event = matchConversationTurnEvent({
      type: 'turn-completed',
      turnId: 'turn-1',
      outputText: 'done',
    }, {
      'turn-started': () => 'started',
      'reasoning-delta': () => 'reasoning',
      'reasoning-status': () => 'reasoning-status',
      'text-delta': () => 'text',
      'message-sealed': () => 'sealed',
      'beat-planned': () => 'planned',
      'beat-delivery-started': () => 'delivery-started',
      'beat-delivered': () => 'delivered',
      'beat-delivery-failed': () => 'delivery-failed',
      'live-child': () => 'live-child',
      'artifact-ready': () => 'artifact',
      'projection-rebuilt': () => 'projection',
      'turn-completed': (nextEvent) => nextEvent.outputText,
      'turn-failed': () => 'failed',
      'turn-canceled': () => 'canceled',
    });

    expect(event).toBe('done');
  });

  it('trims history with a newest-first rolling window and conservative overflow handling', () => {
    const history = [
      { id: '1', role: 'user' as const, text: 'a'.repeat(120) },
      { id: '2', role: 'assistant' as const, text: 'short-2' },
      { id: '3', role: 'user' as const, text: 'short-3' },
    ];
    const result = buildConversationHistoryWindow({
      history,
      budget: {
        ...SIMPLE_AI_HISTORY_BUDGET,
        maxMessages: 3,
        maxChars: 60,
      },
    });

    expect(result.messages.map((message) => message.id)).toEqual(['2', '3']);
    expect(result.trimmedCount).toBe(1);
  });

  it('dispatches the sdk adapter without caller-owned model selection', async () => {
    const runtimeHarness = createRuntimeAiTestRuntime();
    const adapter = createSdkConversationRuntimeAdapter({
      runtime: runtimeHarness.runtime,
      appId: 'kit-chat-test-app',
    });

    const stream = await adapter.streamText({
      modeId: 'simple-ai',
      threadId: 'thread-1',
      turnId: 'turn-1',
      messages: [{ role: 'user', text: 'Hello' }],
    });
    for await (const _event of stream) {
      // Consume the lazy Runtime stream.
    }
    expect(runtimeHarness.streamScenario).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(runtimeHarness.streamScenario.mock.calls[0]?.[0])).not.toMatch(/model|route|connector|target/iu);
  });
});

describe('simple-ai conversation provider', () => {
  it('builds a history-aware request and keeps reasoning out of history', async () => {
    let capturedRequest: unknown = null;
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async (request) => {
        capturedRequest = request;
        return sdkStream([
          { type: 'start', traceId: 'trace-1' },
          { type: 'reasoning-delta', text: 'private-thought' },
          { type: 'text-delta', text: 'public-answer' },
          {
            type: 'done',
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          },
        ]);
      }),
    };
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
      resolveSystemPrompt: () => 'desktop-app-preset',
      resolveRuntimeRequest: () => ({
        reasoning: {
          mode: 'on',
          traceMode: 'separate',
        },
      }),
    });
    const events = await collectEvents(provider.runTurn(createTurnInput({
      history: [
        { id: 'sys-1', role: 'system', text: 'must be stripped' },
        { id: 'dev-1', role: 'developer', text: 'developer instruction survives as model context' },
        { id: 'user-0', role: 'user', text: 'history-user' },
        {
          id: 'assistant-0',
          role: 'assistant',
          text: 'history-assistant',
          metadata: { reasoningText: 'never-reinject-this' },
        },
      ],
    })));

    expect(capturedRequest).toEqual(expect.objectContaining({
      modeId: 'simple-ai',
      systemPrompt: 'desktop-app-preset',
      messages: [
        { role: 'developer', text: 'developer instruction survives as model context', name: null },
        { role: 'user', text: 'history-user', name: null },
        { role: 'assistant', text: 'history-assistant', name: null },
        { role: 'user', text: 'What should we ship next?', name: null },
      ],
    }));
    expect(events.map((event) => event.type)).toEqual([
      'turn-started',
      'reasoning-delta',
      'text-delta',
      'turn-completed',
    ]);
    expect(events[3]).toEqual({
      type: 'turn-completed',
      turnId: 'turn-1',
      outputText: 'public-answer',
      reasoningText: 'private-thought',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      trace: { traceId: 'trace-1' },
    });
  });

  it('lets apps resolve current user runtime content without owning the provider loop', async () => {
    let capturedRequest: unknown = null;
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async (request) => {
        capturedRequest = request;
        return sdkStream([
          { type: 'start', traceId: 'trace-vision' },
          { type: 'text-delta', text: 'vision-answer' },
          {
            type: 'done',
            finishReason: 'stop',
            usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
          },
        ]);
      }),
    };
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
      resolveRuntimeUserMessage: (_input, context) => ({
        role: 'user',
        text: context.normalizedUserText,
        content: [
          { type: 'data', data: { kind: 'image-url', imageUrl: 'data:image/png;base64,ZmFrZQ==' } },
          { type: 'text', text: context.normalizedUserText },
        ],
        name: null,
      }),
    });

    const events = await collectEvents(provider.runTurn(createTurnInput({
      userMessage: {
        id: 'msg-user-vision',
        text: 'Read the image',
        attachments: [{ kind: 'image' }],
      },
      history: [],
    })));

    expect(capturedRequest).toEqual(expect.objectContaining({
      messages: [
        {
          role: 'user',
          text: 'Read the image',
          content: [
            { type: 'data', data: { kind: 'image-url', imageUrl: 'data:image/png;base64,ZmFrZQ==' } },
            { type: 'text', text: 'Read the image' },
          ],
          name: null,
        },
      ],
    }));
    expect(events.find((event) => event.type === 'turn-completed')).toEqual({
      type: 'turn-completed',
      turnId: 'turn-1',
      outputText: 'vision-answer',
      reasoningText: undefined,
      finishReason: 'stop',
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      trace: { traceId: 'trace-vision' },
    });
  });

  it('emits turn-canceled when the runtime aborts mid-turn', async () => {
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }),
    };
    const provider = createSimpleAiConversationProvider({ runtimeAdapter });

    const events = await collectEvents(provider.runTurn(createTurnInput()));

    expect(events).toEqual([
      {
        type: 'turn-started',
        modeId: 'simple-ai',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      {
        type: 'turn-canceled',
        turnId: 'turn-1',
        scope: 'turn',
      },
    ]);
  });

  it('emits turn-failed when the runtime returns a structured error part', async () => {
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async () => sdkStream([
        { type: 'start' },
        { type: 'text-delta', text: 'partial' },
        sdkStreamError({
          reasonCode: ReasonCode.AI_INPUT_INVALID,
          message: 'request is invalid',
          traceId: 'trace-2',
        }),
      ])),
    };
    const provider = createSimpleAiConversationProvider({ runtimeAdapter });

    const events = await collectEvents(provider.runTurn(createTurnInput()));

    expect(events).toEqual([
      {
        type: 'turn-started',
        modeId: 'simple-ai',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      {
        type: 'text-delta',
        turnId: 'turn-1',
        textDelta: 'partial',
      },
      {
        type: 'turn-failed',
        turnId: 'turn-1',
        error: {
          code: 'AI_INPUT_INVALID',
          message: 'request is invalid',
        },
        outputText: 'partial',
        trace: { traceId: 'trace-2' },
      },
    ]);
  });
});
