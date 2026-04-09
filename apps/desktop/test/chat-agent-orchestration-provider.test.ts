import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ConversationRuntimeTextStreamPart,
  ConversationTurnInput,
} from '@nimiplatform/nimi-kit/features/chat';
import type {
  AgentLocalCommitTurnResult,
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalTurnContext,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  buildAgentLocalChatPrompt,
  createAgentTailAbortSignal,
  createAgentLocalChatContinuityAdapter,
  createAgentLocalChatConversationProvider,
  type AgentLocalChatRuntimeAdapter,
} from '../src/shell/renderer/features/chat/chat-agent-orchestration.js';
import { buildDesktopChatOutputContractSection } from '../src/shell/renderer/features/chat/chat-output-contract.js';
import {
  clearAllStreams,
  clearStream,
  feedStreamEvent,
  startStream,
} from '../src/shell/renderer/features/turns/stream-controller.js';
import {
  createAgentTextMessage,
  createAgentTurnBeat,
} from './helpers/agent-chat-record-fixtures.js';

type AgentCommitInput = Parameters<ReturnType<typeof createAgentLocalChatContinuityAdapter>['commitAgentTurnResult']>[0];

function installBrowserGlobals(): () => void {
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storage,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: previousLocalStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: previousSessionStorage,
      configurable: true,
    });
  };
}

function installFakeTimers(): {
  restore: () => void;
  runTimer: (id: number) => void;
  getTimerIds: () => number[];
} {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  let nextId = 1;
  const timers = new Map<number, () => void>();

  Object.defineProperty(globalThis, 'setTimeout', {
    value: ((callback: TimerHandler) => {
      const id = nextId++;
      timers.set(id, () => {
        if (typeof callback === 'function') {
          callback();
        }
      });
      return id;
    }) as typeof setTimeout,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'clearTimeout', {
    value: ((id: ReturnType<typeof setTimeout>) => {
      timers.delete(Number(id));
    }) as typeof clearTimeout,
    configurable: true,
  });

  return {
    restore: () => {
      Object.defineProperty(globalThis, 'setTimeout', {
        value: previousSetTimeout,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'clearTimeout', {
        value: previousClearTimeout,
        configurable: true,
      });
    },
    runTimer: (id: number) => {
      const callback = timers.get(id);
      if (!callback) {
        return;
      }
      timers.delete(id);
      callback();
    },
    getTimerIds: () => [...timers.keys()],
  };
}

function createRuntimeAdapter(overrides: Partial<AgentLocalChatRuntimeAdapter>): AgentLocalChatRuntimeAdapter {
  return {
    async streamText() {
      async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
        yield { type: 'start' };
        yield {
          type: 'finish',
          finishReason: 'stop',
          trace: {
            traceId: 'trace-default',
            promptTraceId: 'prompt-default',
          },
        };
      }
      return { stream: stream() };
    },
    async invokeText() {
      return {
        text: '{"kind":"none","prompt":"","reason":"default","confidence":0}',
        traceId: 'trace-planner',
        promptTraceId: 'prompt-planner',
      };
    },
    async generateImage() {
      return {
        mediaUrl: 'data:image/png;base64,AA==',
        mimeType: 'image/png',
        artifactId: 'artifact-default',
        traceId: 'trace-image',
      };
    },
    ...overrides,
  };
}

let restoreBrowserGlobals: () => void = () => {};

test.beforeEach(() => {
  restoreBrowserGlobals = installBrowserGlobals();
});

test.afterEach(() => {
  clearAllStreams();
  restoreBrowserGlobals();
});

function createContinuityAdapter(
  committed: AgentCommitInput[],
  projectionVersion = 'truth:140:t1:b1:s0:m0:r0',
): ReturnType<typeof createAgentLocalChatContinuityAdapter> {
  return {
    async loadTurnContext() {
      return sampleTurnContext();
    },
    async commitTurnResult(input) {
      committed.push({
        ...input,
        modeId: 'agent-local-chat-v1',
        imageState: { status: 'none' },
      });
      return {
        ...sampleCommitResult(),
        projectionVersion,
      };
    },
    async commitAgentTurnResult(input) {
      committed.push(input);
      return {
        ...sampleCommitResult(),
        projectionVersion,
      };
    },
    async cancelTurn() {
      throw new Error('cancelTurn should not run during committed turn path');
    },
    async rebuildProjection() {
      return {
        threadId: 'thread-1',
        projectionVersion,
      };
    },
  };
}

function sampleTarget(): AgentLocalTargetSnapshot {
  return {
    agentId: 'agent-1',
    displayName: 'Companion',
    handle: '~companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'Helpful companion',
    ownershipType: 'WORLD_OWNED',
  };
}

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    agentId: 'agent-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    archivedAtMs: null,
    targetSnapshot: sampleTarget(),
  };
}

function sampleTurnContext(): AgentLocalTurnContext {
  return {
    thread: sampleThread(),
    recentTurns: [{
      id: 'turn-prev-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      providerMode: 'agent-local-chat-v1',
      traceId: 'trace-prev',
      promptTraceId: 'prompt-prev',
      startedAtMs: 11,
      completedAtMs: 12,
      abortedAtMs: null,
    }],
    recentBeats: [{
      ...createAgentTurnBeat({
      id: 'beat-prev-1',
      turnId: 'turn-prev-1',
      beatIndex: 0,
      modality: 'text',
      status: 'delivered',
      textShadow: 'previous answer',
      mimeType: 'text/plain',
      projectionMessageId: 'message-prev-1',
      createdAtMs: 11,
      deliveredAtMs: 12,
      }),
    }],
    interactionSnapshot: {
      threadId: 'thread-1',
      version: 1,
      relationshipState: 'warm',
      emotionalTemperature: 0.6,
      assistantCommitmentsJson: { followUp: true },
      userPrefsJson: { brevity: true },
      openLoopsJson: ['summarize next step'],
      updatedAtMs: 13,
    },
    relationMemorySlots: [{
      id: 'memory-1',
      threadId: 'thread-1',
      slotType: 'preference',
      summary: 'User prefers concise answers',
      sourceTurnId: 'turn-prev-1',
      sourceBeatId: 'beat-prev-1',
      score: 0.9,
      updatedAtMs: 14,
    }],
    recallEntries: [{
      id: 'recall-1',
      threadId: 'thread-1',
      sourceTurnId: 'turn-prev-1',
      sourceBeatId: 'beat-prev-1',
      summary: 'Summarize the plan',
      searchText: 'plan summary',
      updatedAtMs: 15,
    }],
    draft: null,
    projectionVersion: 'truth:15:t1:b1:s1:m1:r1',
  };
}

function sampleCommitResult(): AgentLocalCommitTurnResult {
  return {
    turn: {
      id: 'turn-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      providerMode: 'agent-local-chat-v1',
      traceId: 'trace-1',
      promptTraceId: 'prompt-1',
      startedAtMs: 100,
      completedAtMs: 140,
      abortedAtMs: null,
    },
    beats: [{
      ...createAgentTurnBeat({
      id: 'turn-1:beat:0',
      turnId: 'turn-1',
      beatIndex: 0,
      modality: 'text',
      status: 'delivered',
      textShadow: 'hello world',
      mimeType: 'text/plain',
      projectionMessageId: 'turn-1:message:0',
      createdAtMs: 100,
      deliveredAtMs: 140,
      }),
    }],
    interactionSnapshot: null,
    relationMemorySlots: [],
    recallEntries: [],
    bundle: {
      thread: sampleThread(),
      messages: [],
      draft: null,
    },
    projectionVersion: 'truth:140:t1:b1:s0:m0:r0',
  };
}

function sampleTurnInput(overrides: Partial<ConversationTurnInput> & {
  userText?: string;
  agentLocalChat?: Record<string, unknown>;
} = {}): ConversationTurnInput {
  const userText = overrides.userText || 'What should we do next?';
  return {
    modeId: 'agent-local-chat-v1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    userMessage: {
      id: 'user-message-1',
      text: userText,
      attachments: [],
    },
    history: [{
      id: 'message-prev-1',
      role: 'assistant',
      text: 'We should summarize the plan.',
    }],
    systemPrompt: 'Be warm and concise.',
    metadata: {
      agentLocalChat: {
        agentId: 'agent-1',
        targetSnapshot: sampleTarget(),
        routeResult: null,
        runtimeConfigState: null,
        runtimeFields: {},
        reasoningPreference: 'off',
        ...overrides.agentLocalChat,
      },
    },
    ...overrides,
  };
}

async function collectEvents(provider: ReturnType<typeof createAgentLocalChatConversationProvider>, input: ConversationTurnInput) {
  const events = [];
  for await (const event of provider.runTurn(input)) {
    events.push(event);
  }
  return events;
}

test('agent local chat prompt includes continuity and transcript context', () => {
  const prompt = buildAgentLocalChatPrompt({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: sampleTurnInput().history,
    userText: 'What should we do next?',
    context: sampleTurnContext(),
  });

  assert.match(prompt, /Preset:/);
  assert.match(prompt, /Continuity:/);
  assert.match(prompt, /User prefers concise answers/);
  assert.match(prompt, /Transcript:/);
  assert.match(prompt, /We should summarize the plan/);
  assert.match(prompt, /What should we do next/);
  assert.match(prompt, /Output Contract:/);
  assert.match(prompt, /fall back to plain text instead of partial Markdown/);
  assert.match(prompt, /do not proactively use fenced code blocks, tables, or HTML/);
  assert.match(prompt, new RegExp(buildDesktopChatOutputContractSection().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('agent local chat provider emits first-beat before terminal and commits completed turn', async () => {
  const runtimeCalls: string[] = [];
  const runtimeAdapter = createRuntimeAdapter({
    async streamText(request) {
      runtimeCalls.push(request.prompt);
      async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
        yield { type: 'start' };
        yield { type: 'reasoning-delta', textDelta: 'thinking' };
        yield { type: 'text-delta', textDelta: 'hello ' };
        yield { type: 'text-delta', textDelta: 'world' };
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
  assert.match(runtimeCalls[0] ?? '', /User prefers concise answers/);
  assert.deepEqual(
    eventTypes,
    [
      'turn-started',
      'reasoning-delta',
      'beat-planned',
      'first-beat-sealed',
      'text-delta',
      'text-delta',
      'beat-delivered',
      'projection-rebuilt',
      'turn-completed',
    ],
  );
  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'completed');
  assert.equal(committed[0]?.events.some((event) => event.type === 'first-beat-sealed'), true);
  assert.equal(events.at(-1)?.type, 'turn-completed');
});

test('agent local chat provider commits canceled turns with tail scope after first beat', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: 'partial answer' };
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
  assert.equal(canceledEvent?.type === 'turn-canceled' ? canceledEvent.scope : null, 'tail');
});

test('agent local chat provider can emit a second image beat after text when the user explicitly asks for an image', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: 'Here is the scene.' };
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
          resolvedBinding: { capability: 'image.generate', source: 'local', provider: 'forge', model: 'flux', modelId: 'flux', connectorId: '', endpoint: 'http://127.0.0.1:7860' },
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
      'beat-planned',
      'first-beat-sealed',
      'text-delta',
      'beat-delivered',
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

test('agent local chat provider ignores explicit negative image requests', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: '那我先不发图。' };
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
      async invokeText() {
        throw new Error('planner should not run after an explicit negative image request');
      },
      async generateImage() {
        throw new Error('image generation should not run after an explicit negative image request');
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
          resolvedBinding: { capability: 'image.generate', source: 'local', provider: 'forge', model: 'flux', modelId: 'flux', connectorId: '', endpoint: 'http://127.0.0.1:7860' },
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

test('agent local chat provider can trigger planner-driven image generation after text first-beat', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText(request) {
        if (request.prompt.includes('Return strict JSON only.')) {
          throw new Error('planner decision should use invokeText, not streamText');
        }
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: '她抬头看了你一眼。' };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-planner-turn',
              promptTraceId: 'prompt-planner-turn',
            },
          };
        }
        return { stream: stream() };
      },
      async invokeText(request) {
        assert.match(request.prompt, /Return strict JSON only/);
        return {
          text: '{"kind":"image","trigger":"scene-enhancement","confidence":0.95,"subject":"客栈老板娘","scene":"抬头看向来客的瞬间","styleIntent":"写实电影感插画","mood":"克制、略带审视","negativeCues":["不要多余人物","不要夸张表情"],"continuityRefs":["古风客栈","夜色室内"],"reason":"scene enhancement","nsfwIntent":"none"}',
          traceId: 'trace-planner',
          promptTraceId: 'prompt-planner',
        };
      },
      async generateImage(request) {
        assert.match(request.prompt, /subject: 客栈老板娘/);
        assert.match(request.prompt, /scene: 抬头看向来客的瞬间/);
        assert.match(request.prompt, /style: 写实电影感插画/);
        assert.match(request.prompt, /avoid: 不要多余人物, 不要夸张表情/);
        return {
          mediaUrl: 'https://cdn.nimi.test/planner-image.png',
          mimeType: 'image/png',
          artifactId: 'artifact-planner-image',
          traceId: 'trace-planner-image',
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:151:t1:b2:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '她现在是什么表情？',
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
          resolvedBinding: { capability: 'image.generate', source: 'local', provider: 'forge', model: 'flux', modelId: 'flux', connectorId: '', endpoint: 'http://127.0.0.1:7860' },
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
  assert.equal(committed[0]?.imageState?.status, 'complete');
  assert.match(committed[0]?.imageState?.prompt || '', /subject: 客栈老板娘/);
  assert.match(committed[0]?.imageState?.prompt || '', /continuity: 古风客栈, 夜色室内/);
});

test('agent local chat provider fails close when runtime stream finishes without output text', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: {},
            trace: {
              traceId: 'trace-empty',
              promptTraceId: 'prompt-empty',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:142:t1:b0:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  assert.match(failedEvent?.type === 'turn-failed' ? failedEvent.error.message : '', /without output text/);
});

test('agent local chat provider fails close when runtime stream ends without terminal event', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: 'partial answer' };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:143:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  assert.match(failedEvent?.type === 'turn-failed' ? failedEvent.error.message : '', /without a terminal event/);
});

test('agent local chat continuity adapter maps committed turn events to truth source payloads', async () => {
  const commitCalls: unknown[] = [];
  const adapter = createAgentLocalChatContinuityAdapter({
    now: () => 200,
    storeClient: {
      async loadTurnContext() {
        return sampleTurnContext();
      },
      async commitTurnResult(input) {
        commitCalls.push(input);
        return sampleCommitResult();
      },
      async cancelTurn() {
        throw new Error('cancelTurn not expected');
      },
      async rebuildProjection(threadId) {
        return {
          bundle: {
            thread: sampleThread(),
            messages: [],
            draft: null,
          },
          projectionVersion: `truth:${threadId}`,
        };
      },
    },
  });

  const result = await adapter.commitTurnResult({
    modeId: 'agent-local-chat-v1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    outcome: 'completed',
    outputText: 'hello world',
    events: [
      {
        type: 'beat-planned',
        turnId: 'turn-1',
        beatId: 'turn-1:beat:0',
        beatIndex: 0,
        modality: 'text',
      },
      {
        type: 'first-beat-sealed',
        turnId: 'turn-1',
        beatId: 'turn-1:beat:0',
        text: 'hello',
      },
      {
        type: 'beat-delivered',
        turnId: 'turn-1',
        beatId: 'turn-1:beat:0',
        projectionMessageId: 'turn-1:message:0',
      },
      {
        type: 'turn-completed',
        turnId: 'turn-1',
        outputText: 'hello world',
        trace: {
          traceId: 'trace-1',
          promptTraceId: 'prompt-1',
        },
      },
    ],
  });

  assert.equal(result.projectionVersion, 'truth:140:t1:b1:s0:m0:r0');
  assert.equal(commitCalls.length, 1);
  assert.deepEqual(commitCalls[0], {
    threadId: 'thread-1',
    turn: {
      id: 'turn-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      providerMode: 'agent-local-chat-v1',
      traceId: 'trace-1',
      promptTraceId: 'prompt-1',
      startedAtMs: 200,
      completedAtMs: 200,
      abortedAtMs: null,
    },
    beats: [{
      ...createAgentTurnBeat({
      id: 'turn-1:beat:0',
      turnId: 'turn-1',
      beatIndex: 0,
      modality: 'text',
      status: 'delivered',
      textShadow: 'hello world',
      mimeType: 'text/plain',
      projectionMessageId: 'turn-1:message:0',
      createdAtMs: 200,
      deliveredAtMs: 200,
      }),
    }],
    interactionSnapshot: null,
    relationMemorySlots: [],
    recallEntries: [],
    projection: {
      thread: {
        id: 'thread-1',
        title: 'Companion',
        updatedAtMs: 200,
        lastMessageAtMs: 200,
        archivedAtMs: null,
        targetSnapshot: sampleTarget(),
      },
      messages: [createAgentTextMessage({
        id: 'turn-1:message:0',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'complete',
        contentText: 'hello world',
        traceId: 'trace-1',
        createdAtMs: 200,
        updatedAtMs: 200,
      })],
      draft: null,
      clearDraft: true,
    },
  });
});
