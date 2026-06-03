import { describe, expect, it, vi } from 'vitest';
import type {
  Runtime,
  TextStreamOutput,
  TextStreamPart,
} from '@nimiplatform/kit/core/sdk-contract';
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

async function collectEvents(stream: AsyncIterable<ConversationTurnEvent>): Promise<ConversationTurnEvent[]> {
  const events: ConversationTurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function sdkStream(parts: readonly TextStreamPart[]): TextStreamOutput {
  return {
    stream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
  };
}

function sdkStreamError(input: {
  reasonCode: string;
  message: string;
  traceId?: string;
}): TextStreamPart {
  const error = new Error(input.message) as Error & {
    code: string;
    reasonCode: string;
    actionHint: string;
    traceId: string;
    retryable: boolean;
    source: 'runtime';
  };
  error.name = input.reasonCode;
  error.code = input.reasonCode;
  error.reasonCode = input.reasonCode;
  error.actionHint = 'inspect_runtime_stream';
  error.traceId = input.traceId || '';
  error.retryable = false;
  error.source = 'runtime';
  return {
    type: 'error',
    error,
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
      'text-delta': () => 'text',
      'message-sealed': () => 'sealed',
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

  it('fails closed before Runtime execution when sdk adapter request lacks an explicit model', async () => {
    const runtime = {
      ai: {
        text: {
          stream: vi.fn(),
        },
      },
    } as unknown as Runtime;
    const adapter = createSdkConversationRuntimeAdapter(runtime);

    await expect(adapter.streamText({
      modeId: 'simple-ai',
      threadId: 'thread-1',
      turnId: 'turn-1',
      messages: [{ role: 'user', text: 'Hello' }],
    })).rejects.toThrow('conversation runtime request requires an explicit model');
    expect(runtime.ai.text.stream).not.toHaveBeenCalled();
  });

  it('fails closed before Runtime execution when sdk adapter request uses auto as a pseudo-model', async () => {
    const runtime = {
      ai: {
        text: {
          stream: vi.fn(),
        },
      },
    } as unknown as Runtime;
    const adapter = createSdkConversationRuntimeAdapter(runtime);

    await expect(adapter.streamText({
      modeId: 'simple-ai',
      threadId: 'thread-1',
      turnId: 'turn-1',
      model: 'auto',
      messages: [{ role: 'user', text: 'Hello' }],
    })).rejects.toThrow('conversation runtime request requires a concrete Runtime model, not auto');
    expect(runtime.ai.text.stream).not.toHaveBeenCalled();
  });
});

describe('simple-ai conversation provider', () => {
  it('builds a history-aware request and keeps reasoning out of history', async () => {
    let capturedRequest: unknown = null;
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async (request) => {
        capturedRequest = request;
        return sdkStream([
          { type: 'start' },
          { type: 'reasoning-delta', text: 'private-thought' },
          { type: 'delta', text: 'public-answer' },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
            trace: { traceId: 'trace-1', promptTraceId: 'prompt-1' } as Extract<
              TextStreamPart,
              { type: 'finish' }
            >['trace'],
          },
        ]);
      }),
    };
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
      resolveSystemPrompt: () => 'desktop-app-preset',
      resolveRuntimeRequest: () => ({
        model: 'runtime-selected-chat',
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

  it('lets apps resolve current user runtime content without owning the provider loop', async () => {
    let capturedRequest: unknown = null;
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async (request) => {
        capturedRequest = request;
        return sdkStream([
          { type: 'start' },
          { type: 'delta', text: 'vision-answer' },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
            trace: { traceId: 'trace-vision' } as Extract<
              TextStreamPart,
              { type: 'finish' }
            >['trace'],
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
          { type: 'image_url', imageUrl: 'data:image/png;base64,ZmFrZQ==' },
          { type: 'text', text: context.normalizedUserText },
        ],
        name: null,
      }),
      resolveRuntimeRequest: () => ({
        model: 'runtime-selected-chat',
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
            { type: 'image_url', imageUrl: 'data:image/png;base64,ZmFrZQ==' },
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
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
      resolveRuntimeRequest: () => ({
        model: 'runtime-selected-chat',
      }),
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
      streamText: vi.fn(async () => sdkStream([
        { type: 'start' },
        { type: 'delta', text: 'partial' },
        sdkStreamError({
          reasonCode: 'AI_INPUT_INVALID',
          message: 'request is invalid',
          traceId: 'trace-2',
        }),
      ])),
    };
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter,
      resolveRuntimeRequest: () => ({
        model: 'runtime-selected-chat',
      }),
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
