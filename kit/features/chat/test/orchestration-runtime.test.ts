import { describe, expect, it, vi } from 'vitest';
import type { TextStreamPart } from '@nimiplatform/sdk/runtime';
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
  createSimpleAiConversationProvider,
  normalizeConversationRuntimeTextStreamPart,
} from '../src/runtime.js';

async function collectEvents(stream: AsyncIterable<ConversationTurnEvent>): Promise<ConversationTurnEvent[]> {
  const events: ConversationTurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
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
      'text-delta': () => 'text',
      'first-beat-sealed': () => 'first-beat',
      'beat-planned': () => 'planned',
      'beat-delivery-started': () => 'delivery-started',
      'beat-delivered': () => 'delivered',
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

  it('normalizes sdk stream parts into orchestration stream parts', () => {
    const parts: TextStreamPart[] = [
      { type: 'start' },
      { type: 'reasoning-delta', text: 'thinking' },
      { type: 'delta', text: 'answer' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        trace: { traceId: 'trace-1', modelResolved: 'gpt', routeDecision: 'cloud' },
      },
    ];

    expect(parts.map((part) => normalizeConversationRuntimeTextStreamPart(part))).toEqual([
      { type: 'start' },
      { type: 'reasoning-delta', textDelta: 'thinking' },
      { type: 'text-delta', textDelta: 'answer' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        trace: { traceId: 'trace-1', modelResolved: 'gpt', routeDecision: 'cloud' },
      },
    ]);
  });
});

describe('simple-ai conversation provider', () => {
  it('builds a history-aware request and keeps reasoning out of history', async () => {
    let capturedRequest: unknown = null;
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async (request) => {
        capturedRequest = request;
        return {
          stream: (async function* () {
            yield { type: 'start' as const };
            yield { type: 'reasoning-delta' as const, textDelta: 'private-thought' };
            yield { type: 'text-delta' as const, textDelta: 'public-answer' };
            yield {
              type: 'finish' as const,
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
              trace: { traceId: 'trace-1', promptTraceId: 'prompt-1' },
            };
          })(),
        };
      }),
    };
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
      resolveSystemPrompt: () => 'desktop-app-preset',
      resolveRuntimeRequest: () => ({
        model: 'auto',
        route: 'cloud',
        reasoning: {
          mode: 'on',
          traceMode: 'separate',
        },
      }),
    });
    const events = await collectEvents(provider.runTurn(createTurnInput({
      history: [
        { id: 'sys-1', role: 'system', text: 'must be stripped' },
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
      trace: { traceId: 'trace-1', promptTraceId: 'prompt-1' },
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
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
    });

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
      streamText: vi.fn(async () => ({
        stream: (async function* () {
          yield { type: 'start' as const };
          yield { type: 'text-delta' as const, textDelta: 'partial' };
          yield {
            type: 'error' as const,
            error: {
              code: 'AI_INPUT_INVALID',
              message: 'request is invalid',
            },
            trace: { traceId: 'trace-2' },
          };
        })(),
      })),
    };
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
    });

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
