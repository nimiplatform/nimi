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
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';
import {
  createModelConversationRuntimeAdapter,
  createSdkConversationRuntimeAdapter,
  createSimpleAiConversationProvider,
} from '../src/runtime.js';
import { createRuntimeAiTestRuntime } from './runtime-ai-test-helpers.js';

type LocalAppTextAI = Parameters<typeof createNimiLocalAppTextModel>[0];

// A protected App text namespace that records each turn input and answers
// with the given Local App stream events.
function localAppTextAI(turns: readonly (readonly unknown[])[]) {
  const inputs: unknown[] = [];
  const cancels: number[] = [];
  const ai = {
    text: {
      async streamTurn(input: unknown) {
        const events = turns[inputs.length] ?? [];
        inputs.push(input);
        const index = inputs.length - 1;
        return Object.assign((async function* stream() {
          yield* events;
        })(), {
          cancel: async () => {
            cancels.push(index);
          },
        });
      },
    },
  } as unknown as LocalAppTextAI;
  return { ai, inputs, cancels };
}

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
  it('builds a history-aware request and keeps canonical reasoning summary out of history', async () => {
    let capturedRequest: unknown = null;
    const runtimeAdapter: ConversationRuntimeAdapter = {
      streamText: vi.fn(async (request) => {
        capturedRequest = request;
        return sdkStream([
          { type: 'start', traceId: 'trace-1' },
          {
            type: 'reasoning-summary-delta', text: 'permitted-summary',
            itemIndex: 0, itemCompleted: true,
          },
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
			activation: 'required',
			presentation: 'summary',
			effort: 'medium',
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
      reasoningText: 'permitted-summary',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      trace: { traceId: 'trace-1' },
    });
  });

  it('fails visibly instead of dropping a ToolCall it does not own', async () => {
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: {
        async streamText() {
          return sdkStream([
            { type: 'start', traceId: 'trace-unsupported-item' },
            {
              type: 'tool-call',
              toolCall: { id: 'call-1', name: 'lookup', arguments: {} },
              itemIndex: 0,
              itemCompleted: true,
            },
            { type: 'done', finishReason: 'stop' },
          ]);
        },
      },
    });
    const events = await collectEvents(provider.runTurn(createTurnInput()));
    expect(events.map((event) => event.type)).toEqual(['turn-started', 'turn-failed']);
    expect(events[1]).toEqual(expect.objectContaining({
      type: 'turn-failed',
      error: expect.objectContaining({ code: 'AI_TEXT_BEHAVIOR_UNSUPPORTED' }),
    }));
  });

  it('keeps opaque continuity out of the visible turn and replays it unmodified with that assistant turn', async () => {
    const payload = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamEvents: [
        { type: 'start', traceId: 'trace-thinking' },
        {
          type: 'reasoning-continuity',
          carrier: { kind: 'anthropic.messages.thinking', version: 1, payload },
          itemIndex: 0,
          itemCompleted: true,
        },
        { type: 'text-delta', text: 'Ship the contract ', itemIndex: 1, itemCompleted: false },
        { type: 'text-delta', text: 'freeze.', itemIndex: 1, itemCompleted: true },
        { type: 'done', finishReason: 'stop' },
      ],
    });
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: createSdkConversationRuntimeAdapter({
        runtime: runtimeHarness.runtime,
        appId: 'kit-chat-test-app',
      }),
    });

    const first = await collectEvents(provider.runTurn(createTurnInput({ history: [] })));
    expect(first.map((event) => event.type)).toEqual(['turn-started', 'text-delta', 'text-delta', 'turn-completed']);
    const completed = first[3];
    expect(completed).toEqual(expect.objectContaining({
      type: 'turn-completed',
      outputText: 'Ship the contract freeze.',
      outputItems: [
        { type: 'reasoning-continuity', kind: 'anthropic.messages.thinking', version: 1, payloadBase64: 'AAEC/f7/' },
        { type: 'text', text: 'Ship the contract freeze.' },
      ],
    }));
    // The session owner stores the items as JSON and hands them back unchanged.
    const stored = JSON.parse(JSON.stringify(completed)) as Extract<ConversationTurnEvent, { type: 'turn-completed' }>;

    await collectEvents(provider.runTurn(createTurnInput({
      turnId: 'turn-2',
      userMessage: { id: 'msg-user-2', text: 'And after that?', attachments: [] },
      history: [
        { id: 'user-1', role: 'user', text: 'What should we ship next?' },
        { id: 'assistant-1', role: 'assistant', text: stored.outputText, outputItems: stored.outputItems },
      ],
    })));

    const replayed = runtimeHarness.streamScenario.mock.calls[1]?.[0];
    const input = replayed?.spec?.spec.oneofKind === 'textGenerate' ? replayed.spec.spec.textGenerate.input : [];
    expect(input.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    const assistant = input[1]!;
    expect(assistant.content).toBe('');
    expect(assistant.parts).toEqual([]);
    expect(assistant.turnItems.map((item) => item.item.oneofKind === 'output' ? item.item.output.item : null)).toEqual([
      {
        oneofKind: 'reasoningContinuity',
        reasoningContinuity: { kind: 'anthropic.messages.thinking', version: 1, payload },
      },
      { oneofKind: 'text', text: { text: 'Ship the contract freeze.' } },
    ]);
  });

  it('sends earlier plain assistant turns as canonical ordered output through the SDK Runtime binding', async () => {
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamEvents: [
        { type: 'start', traceId: 'trace-plain' },
        { type: 'text-delta', text: 'Freeze the contract first.' },
        { type: 'done', finishReason: 'stop' },
      ],
    });
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: createSdkConversationRuntimeAdapter({
        runtime: runtimeHarness.runtime,
        appId: 'kit-chat-test-app',
      }),
    });

    const events = await collectEvents(provider.runTurn(createTurnInput()));
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'turn-completed',
      outputText: 'Freeze the contract first.',
    }));
    expect(events.at(-1)).not.toHaveProperty('outputItems');
    const request = runtimeHarness.streamScenario.mock.calls[0]?.[0];
    const input = request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.input : [];
    expect(input.map((message) => [message.role, message.content])).toEqual([
      ['user', 'We need a plan.'],
      ['assistant', ''],
      ['user', 'What should we ship next?'],
    ]);
    expect(input[1]?.turnItems.map((item) => item.item.oneofKind === 'output' ? item.item.output.item : null)).toEqual([
      { oneofKind: 'text', text: { text: 'Start with contract freeze.' } },
    ]);
  });

  it('fails closed before dispatch when stored assistant output was changed', async () => {
    const carrier = { type: 'reasoning-continuity' as const, kind: 'openai.responses.reasoning', version: 1, payloadBase64: 'AAEC' };
    const invalidOutputs = [
      [carrier, { type: 'text' as const, text: 'An edited answer.' }],
      [{ ...carrier, payloadBase64: 'AAEC\n' }, { type: 'text' as const, text: 'Start with contract freeze.' }],
      [{ ...carrier, payloadBase64: '' }, { type: 'text' as const, text: 'Start with contract freeze.' }],
      [carrier],
    ];
    for (const outputItems of invalidOutputs) {
      const streamText = vi.fn();
      const provider = createSimpleAiConversationProvider({ runtimeAdapter: { streamText } });
      await expect(collectEvents(provider.runTurn(createTurnInput({
        history: [
          { id: 'user-0', role: 'user', text: 'We need a plan.' },
          { id: 'assistant-0', role: 'assistant', text: 'Start with contract freeze.', outputItems },
        ],
      })))).rejects.toThrow(/outputItems|continuity|text item/u);
      expect(streamText).not.toHaveBeenCalled();
    }
  });

  it('runs two turns through a protected App text model and replays the stored continuity', async () => {
    const carrier = { kind: 'anthropic.messages.thinking', version: 1, payload: [0, 1, 2, 253, 254, 255] };
    const { ai, inputs } = localAppTextAI([
      [
        { type: 'reasoning-continuity', sequence: '1', traceId: 'trace-1', itemIndex: 0, carrier },
        { type: 'delta', sequence: '2', traceId: 'trace-1', text: 'Freeze the contract first.', itemIndex: 1 },
        { type: 'completed', sequence: '3', traceId: 'trace-1', finishReason: 'stop' },
      ],
      [
        { type: 'delta', sequence: '1', traceId: 'trace-2', text: 'Then ship it.', itemIndex: 0 },
        { type: 'completed', sequence: '2', traceId: 'trace-2', finishReason: 'stop' },
      ],
    ]);
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: createModelConversationRuntimeAdapter({ model: createNimiLocalAppTextModel(ai) }),
    });

    const first = await collectEvents(provider.runTurn(createTurnInput({ history: [], systemPrompt: 'Be brief.' })));
    const completed = first.at(-1) as Extract<ConversationTurnEvent, { type: 'turn-completed' }>;
    expect(completed).toEqual(expect.objectContaining({
      type: 'turn-completed',
      outputText: 'Freeze the contract first.',
      outputItems: [
        { type: 'reasoning-continuity', kind: 'anthropic.messages.thinking', version: 1, payloadBase64: 'AAEC/f7/' },
        { type: 'text', text: 'Freeze the contract first.' },
      ],
    }));
    // The session owner stores the turn as JSON and loads it back later.
    const stored = JSON.parse(JSON.stringify(completed)) as typeof completed;

    const second = await collectEvents(provider.runTurn(createTurnInput({
      turnId: 'turn-2',
      userMessage: { id: 'msg-user-2', text: 'And then?', attachments: [] },
      systemPrompt: 'Be brief.',
      history: [
        { id: 'user-1', role: 'user', text: 'What should we ship next?' },
        { id: 'assistant-1', role: 'assistant', text: stored.outputText, outputItems: stored.outputItems },
      ],
    })));
    expect(second.at(-1)).toEqual(expect.objectContaining({ type: 'turn-completed', outputText: 'Then ship it.' }));
    expect(second.at(-1)).not.toHaveProperty('outputItems');
    expect((inputs[1] as { messages: unknown }).messages).toEqual([
      { role: 'system', text: 'Be brief.' },
      { role: 'user', text: 'What should we ship next?' },
      {
        role: 'assistant',
        text: '',
        turnItems: [
          { type: 'output', output: { type: 'reasoning-continuity', carrier } },
          { type: 'output', output: { type: 'text', text: 'Freeze the contract first.' } },
        ],
      },
      { role: 'user', text: 'And then?' },
    ]);
  });

  it('reports the typed Runtime reason when the protected App refuses a turn', async () => {
    const ai = {
      text: {
        async streamTurn() {
          throw Object.assign(new Error('ai-text-behavior-unsupported'), {
            code: 'runtime-permission-denied',
            reasonCode: 'ai-text-behavior-unsupported',
            source: 'runtime',
          });
        },
      },
    } as unknown as LocalAppTextAI;
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: createModelConversationRuntimeAdapter({ model: createNimiLocalAppTextModel(ai) }),
    });
    const events = await collectEvents(provider.runTurn(createTurnInput({ history: [] })));
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'turn-failed',
      error: expect.objectContaining({ code: 'ai-text-behavior-unsupported' }),
    }));
  });

  it('refuses request options that a caller-bound model cannot carry', async () => {
    const { ai, inputs } = localAppTextAI([]);
    const adapter = createModelConversationRuntimeAdapter({ model: createNimiLocalAppTextModel(ai) });
    await expect(adapter.streamText({
      modeId: 'simple-ai',
      threadId: 'thread-1',
      turnId: 'turn-1',
      messages: [{ role: 'user', text: 'Hello' }],
      metadata: { surfaceId: 'lab' },
    })).rejects.toThrow(/cannot carry metadata/u);
    expect(inputs).toHaveLength(0);
  });

  it('closes the protected App stream when the turn is aborted between events', async () => {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancels: number[] = [];
    const ai = {
      text: {
        async streamTurn() {
          return Object.assign((async function* stream() {
            yield { type: 'delta', sequence: '1', traceId: 'trace-abort', text: 'partial', itemIndex: 0 };
            await released;
          })(), {
            cancel: async () => {
              cancels.push(1);
              release();
            },
          });
        },
      },
    } as unknown as LocalAppTextAI;
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: createModelConversationRuntimeAdapter({ model: createNimiLocalAppTextModel(ai) }),
    });
    const controller = new AbortController();
    const events: ConversationTurnEvent[] = [];
    for await (const event of provider.runTurn(createTurnInput({ history: [], signal: controller.signal }))) {
      events.push(event);
      if (event.type === 'text-delta') {
        controller.abort();
      }
    }
    expect(cancels.length).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'turn-canceled' }));
  });

  it('fails the turn when continuity arrives with text outside the ordered item sequence', async () => {
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: {
        async streamText() {
          return sdkStream([
            { type: 'start', traceId: 'trace-unordered' },
            {
              type: 'reasoning-continuity',
              carrier: { kind: 'native', version: 1, payload: new Uint8Array([1]) },
              itemIndex: 0,
              itemCompleted: true,
            },
            { type: 'text-delta', text: 'unordered answer' },
            { type: 'done', finishReason: 'stop' },
          ]);
        },
      },
    });
    const events = await collectEvents(provider.runTurn(createTurnInput()));
    expect(events.map((event) => event.type)).toEqual(['turn-started', 'text-delta', 'turn-failed']);
    expect(events[2]).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'AI_OUTPUT_INVALID' }),
      outputText: 'unordered answer',
    }));
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
