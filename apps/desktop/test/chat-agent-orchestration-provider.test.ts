import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ConversationRuntimeTextStreamPart,
  ConversationTurnInput,
} from '@nimiplatform/nimi-kit/features/chat';
import { parseAgentLocalProjectionCommitInput } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-parsers.js';
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
import {
  AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION,
  AI_CHAT_EXECUTION_ENGINE_ID,
  assessAiChatExecutionEngineReuseReadiness,
  buildAgentLocalChatExecutionTextRequest,
  inspectAgentLocalChatPromptDiagnostics,
} from '../src/shell/renderer/features/chat/chat-ai-execution-engine.js';
import { AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID } from '../src/shell/renderer/features/chat/chat-agent-behavior.js';
import { resolveAgentChatBehavior } from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver.js';
import {
  clearAllStreams,
  clearStream,
  feedStreamEvent,
  startStream,
} from '../src/shell/renderer/features/turns/stream-controller.js';
import { parseAgentChatVoiceWorkflowMetadata } from '../src/shell/renderer/features/chat/chat-agent-voice-workflow.js';
import {
  createAgentVoiceMessage,
  createAgentTextMessage,
  createAgentTurnBeat,
} from './helpers/agent-chat-record-fixtures.js';

type AgentCommitInput = Parameters<ReturnType<typeof createAgentLocalChatContinuityAdapter>['commitAgentTurnResult']>[0];
type AgentRuntimeStreamRequest = Parameters<AgentLocalChatRuntimeAdapter['streamText']>[0];
type TestVoiceWorkflowSubmitRequest = {
  workflowIntent: {
    workflowType: 'tts_v2v' | 'tts_t2v';
  };
  referenceAudio?: {
    bytes: Uint8Array;
    mimeType: string;
  } | null;
};

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
  getTimerDelay: (id: number) => number | null;
} {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; delayMs: number; repeat: boolean }>();

  Object.defineProperty(globalThis, 'setTimeout', {
    value: ((callback: TimerHandler, delayMs?: number) => {
      const id = nextId++;
      timers.set(id, {
        callback: () => {
          if (typeof callback === 'function') {
            callback();
          }
        },
        delayMs: Number(delayMs || 0),
        repeat: false,
      });
      return id;
    }) as typeof setTimeout,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'setInterval', {
    value: ((callback: TimerHandler, delayMs?: number) => {
      const id = nextId++;
      timers.set(id, {
        callback: () => {
          if (typeof callback === 'function') {
            callback();
          }
        },
        delayMs: Number(delayMs || 0),
        repeat: true,
      });
      return id;
    }) as typeof setInterval,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'clearTimeout', {
    value: ((id: ReturnType<typeof setTimeout>) => {
      timers.delete(Number(id));
    }) as typeof clearTimeout,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'clearInterval', {
    value: ((id: ReturnType<typeof setInterval>) => {
      timers.delete(Number(id));
    }) as typeof clearInterval,
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
      Object.defineProperty(globalThis, 'setInterval', {
        value: previousSetInterval,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'clearInterval', {
        value: previousClearInterval,
        configurable: true,
      });
    },
    runTimer: (id: number) => {
      const timer = timers.get(id);
      if (!timer) {
        return;
      }
      if (!timer.repeat) {
        timers.delete(id);
      }
      timer.callback();
    },
    getTimerIds: () => [...timers.keys()],
    getTimerDelay: (id: number) => timers.get(id)?.delayMs ?? null,
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
    async synthesizeVoice() {
      return {
        mediaUrl: 'file:///tmp/agent-voice-default.mp3',
        mimeType: 'audio/mpeg',
        artifactId: 'artifact-voice-default',
        traceId: 'trace-voice',
        playbackCueEnvelope: null,
      };
    },
    async submitVoiceWorkflow() {
      return {
        jobId: 'voice-workflow-job-default',
        traceId: 'trace-voice-workflow-default',
        workflowStatus: 'submitted',
        voiceReference: {
          kind: 'voice_asset_id',
          stableRef: 'voice-asset-default',
        },
        voiceAssetId: 'voice-asset-default',
        providerVoiceRef: 'provider-voice-default',
      };
    },
    ...overrides,
  };
}

function createBeatActionEnvelopeText(input: {
  beats: Array<{
    beatId?: string;
    beatIndex: number;
    intent?: 'reply' | 'follow-up' | 'comfort' | 'checkin' | 'media-request' | 'voice-request';
    deliveryPhase?: 'primary' | 'tail';
    text: string;
    delayMs?: number;
  }>;
  actions?: Array<{
    actionId?: string;
    actionIndex: number;
    modality: 'image' | 'voice' | 'video' | 'follow-up-turn';
    operation?: string;
    promptText: string;
    sourceMessageId: string;
    sourceBeatIndex?: number;
    deliveryCoupling?: 'after-message' | 'with-message';
  }>;
}): string {
  const primaryBeat = input.beats[0];
  if (!primaryBeat) {
    throw new Error('message-action test helper requires at least one message beat');
  }
  const messageId = 'message-0';
  const followUpBeat = input.beats[1];
  const actions = (input.actions || []).map((action) => ({
    actionId: action.actionId ?? `action-${action.actionIndex}`,
    actionIndex: action.actionIndex,
    actionCount: (input.actions || []).length,
    modality: action.modality,
    operation: action.operation ?? 'generate',
    promptPayload: {
      kind: action.modality === 'image'
        ? 'image-prompt'
        : action.modality === 'voice'
          ? 'voice-prompt'
          : action.modality === 'video'
            ? 'video-prompt'
            : 'follow-up-turn',
      promptText: action.promptText,
      ...(action.modality === 'follow-up-turn'
        ? { delayMs: 400 }
        : {}),
    },
    sourceMessageId: action.sourceMessageId.startsWith('beat-') ? messageId : action.sourceMessageId,
    deliveryCoupling: action.deliveryCoupling ?? 'after-message',
  }));
  if (followUpBeat) {
    actions.push({
      actionId: `action-${actions.length}`,
      actionIndex: actions.length,
      actionCount: actions.length + 1,
      modality: 'follow-up-turn',
      operation: 'assistant.turn.schedule',
      promptPayload: {
        kind: 'follow-up-turn',
        promptText: followUpBeat.text,
        delayMs: followUpBeat.delayMs ?? 400,
      },
      sourceMessageId: messageId,
      deliveryCoupling: 'after-message',
    });
  }
  const normalizedActions = actions.map((action, index) => ({
    ...action,
    actionIndex: index,
    actionCount: actions.length,
  }));
  return JSON.stringify({
    schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
    message: {
      messageId,
      text: primaryBeat.text,
    },
    actions: normalizedActions,
  });
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
      sourceMessageId: 'beat-prev-1',
      score: 0.9,
      updatedAtMs: 14,
    }],
    recallEntries: [{
      id: 'recall-1',
      threadId: 'thread-1',
      sourceTurnId: 'turn-prev-1',
      sourceMessageId: 'beat-prev-1',
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

  assert.match(prompt, /^Messages:\n\[/);
  assert.match(prompt, /"role": "user"/);
  assert.match(prompt, /"content": "What should we do next\?"/);
  assert.match(prompt, /What should we do next/);
  assert.doesNotMatch(prompt, /Preset:/);
  assert.doesNotMatch(prompt, /Output Contract:/);
});

test('agent local chat execution seam shapes system prompt and transcript messages', () => {
  const resolvedBehavior = resolveAgentChatBehavior({
    userText: 'What should we do next?',
    settings: {
      thinkingPreference: 'off',
      maxOutputTokensOverride: null,
    },
  });
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: sampleTurnInput().history,
    userText: 'What should we do next?',
    context: sampleTurnContext(),
    resolvedBehavior,
  });

  assert.match(request.systemPrompt || '', /Preset:/);
  assert.match(request.systemPrompt || '', /Continuity:/);
  assert.match(request.systemPrompt || '', /ResolvedBehavior:/);
  assert.match(request.systemPrompt || '', /Safety Policy:/);
  assert.match(request.systemPrompt || '', /sexual content involving minors/i);
  assert.match(request.systemPrompt || '', /encourage, instruct, plan, optimize, or emotionally pressure suicide or self-harm/i);
  assert.match(request.systemPrompt || '', /override intimacy, roleplay, continuity, user instruction, and character framing/i);
  assert.match(request.systemPrompt || '', /"userPrefs": \{[\s\S]*"brevity": true/);
  assert.match(request.systemPrompt || '', /"resolvedTurnMode": "information"/);
  assert.doesNotMatch(request.systemPrompt || '', /"allowMultiReply":/);
  assert.doesNotMatch(request.systemPrompt || '', /"deliveryPolicy":/);
  assert.match(request.systemPrompt || '', /Output Contract:/);
  assert.match(request.systemPrompt || '', /Return exactly one JSON object/);
  assert.equal(request.diagnostics.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(request.diagnostics.diagnosticsVersion, AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION);
  assert.equal(request.diagnostics.firstConsumerId, 'agent-local-chat-v1');
  assert.equal(request.diagnostics.contextWindowSource, 'default-estimate');
  assert.equal(request.diagnostics.budget.modelContextTokens, 4096);
  assert.equal(request.diagnostics.maxOutputTokensRequested, null);
  assert.equal(request.diagnostics.estimate.droppedHistoryMessages, 1);
  assert.equal(request.diagnostics.continuity.snapshotIncluded, true);
  assert.equal(request.diagnostics.continuity.retainedMemoryEntries, 0);
  assert.equal(request.diagnostics.continuity.retainedRecallEntries, 0);
  assert.equal(request.diagnostics.transcript.retainedHistoryMessages, 0);
  assert.equal(request.diagnostics.transcript.emittedMessages, 1);
  assert.equal(request.diagnostics.transcript.trimmedLeadingAssistantMessages, 1);
  assert.equal(request.messages.length, 1);
  assert.deepEqual(request.messages[0], {
    role: 'user',
    text: 'What should we do next?',
  });
  assert.match(request.prompt, /^Messages:\n\[/);
  assert.match(request.prompt, /"role": "user"/);
  assert.match(request.prompt, /"content": "What should we do next\?"/);
});

test('agent local chat execution seam drops a duplicated current user turn from history and supports follow-up continuation inputs', () => {
  const duplicatedUserHistory = [
    {
      id: 'history-assistant-1',
      role: 'assistant' as const,
      text: '先说一句欢迎。',
    },
    {
      id: 'user-message-1',
      role: 'user' as const,
      text: '你好',
    },
  ];
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: duplicatedUserHistory,
    userText: '你好',
    currentUserMessageId: 'user-message-1',
    context: sampleTurnContext(),
  });

  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0]?.role, 'user');
  assert.equal(request.messages[0]?.text, '你好');
  assert.equal((request.prompt.match(/"content": "你好"/g) || []).length, 1);

  const followUpRequest = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [
      {
        id: 'user-message-1',
        role: 'user',
        text: '你好',
      },
      {
        id: 'assistant-message-1',
        role: 'assistant',
        text: '你好呀，很高兴见到你。',
      },
    ],
    userText: '',
    omitUserMessageFromMessages: true,
    followUpInstruction: '如果对方还没回复，就再轻轻问候一句，但不要重复上一句。',
    context: sampleTurnContext(),
  });

  assert.deepEqual(followUpRequest.messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(followUpRequest.messages.at(-1)?.text, '你好呀，很高兴见到你。');
  assert.doesNotMatch(followUpRequest.prompt, /如果对方还没回复/);
  assert.match(followUpRequest.systemPrompt || '', /FollowUpInstruction:/);
  assert.match(followUpRequest.systemPrompt || '', /不要重复上一句/);
});

test('agent local chat execution seam compacts continuity and packs history by budget', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Stay in character.',
    targetSnapshot: {
      ...sampleTarget(),
      bio: `Long bio ${'detail '.repeat(120)}`,
    },
    history: [
      {
        id: 'history-user-1',
        role: 'user',
        text: `Old question ${'alpha '.repeat(120)}`,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        text: `Old answer ${'beta '.repeat(120)}`,
      },
      {
        id: 'history-assistant-2',
        role: 'assistant',
        text: `Latest assistant context ${'gamma '.repeat(80)}`,
      },
    ],
    userText: 'What should we do next?',
    context: {
      ...sampleTurnContext(),
      relationMemorySlots: [
        ...sampleTurnContext().relationMemorySlots,
        {
          id: 'memory-2',
          threadId: 'thread-1',
          slotType: 'preference',
          summary: 'User prefers concise answers',
          sourceTurnId: 'turn-prev-1',
          sourceMessageId: 'beat-prev-1',
          score: 0.8,
          updatedAtMs: 16,
        },
        {
          id: 'memory-3',
          threadId: 'thread-1',
          slotType: 'context',
          summary: 'The user is planning a summary reply',
          sourceTurnId: 'turn-prev-1',
          sourceMessageId: 'beat-prev-1',
          score: 0.7,
          updatedAtMs: 17,
        },
      ],
      recallEntries: [
        ...sampleTurnContext().recallEntries,
        {
          id: 'recall-2',
          threadId: 'thread-1',
          sourceTurnId: 'turn-prev-1',
          sourceMessageId: 'beat-prev-1',
          summary: 'Summarize the plan',
          searchText: 'duplicate search text should not leak',
          updatedAtMs: 18,
        },
      ],
      recentBeats: [
        ...sampleTurnContext().recentBeats,
        {
          ...createAgentTurnBeat({
            id: 'beat-image-1',
            turnId: 'turn-prev-2',
            beatIndex: 1,
            modality: 'image',
            status: 'delivered',
            textShadow: 'duplicate transcript shadow',
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
            projectionMessageId: 'message-image-1',
            createdAtMs: 21,
            deliveredAtMs: 22,
          }),
        },
      ],
    },
    modelContextTokens: 2800,
  });

  assert.equal(request.diagnostics.contextWindowSource, 'route-profile');
  assert.equal(request.diagnostics.budget.modelContextTokens, 2800);
  assert.equal(request.diagnostics.maxOutputTokensRequested, null);
  assert.ok(request.diagnostics.estimate.droppedHistoryMessages > 0);
  assert.ok(request.diagnostics.estimate.droppedRecallEntries > 0);
  assert.ok(request.diagnostics.estimate.historyTokens <= request.diagnostics.budget.historyBudgetTokens);
  assert.equal(request.messages.at(-1)?.role, 'user');
  assert.equal(request.messages.at(-1)?.text, 'What should we do next?');
  assert.equal(request.messages[0]?.role, 'user');
  assert.ok(!request.systemPrompt?.includes('searchText'));
  assert.ok(!request.systemPrompt?.includes('textShadow'));
  assert.ok(
    (request.systemPrompt?.includes('artifact=artifact-image-1') || request.diagnostics.estimate.droppedArtifactFacts > 0),
  );
  const preferenceMentions = (request.systemPrompt?.match(/User prefers concise answers/g) || []).length;
  assert.ok(preferenceMentions <= 1);
  assert.ok(preferenceMentions === 1 || request.diagnostics.estimate.droppedMemoryEntries > 0);
  assert.ok(!request.prompt.includes(`Old question ${'alpha '.repeat(120)}`));
  assert.ok(request.diagnostics.continuity.bioCharLimit <= 480);
  assert.equal(request.diagnostics.transcript.emittedMessages, request.messages.length);
});

test('agent local chat execution seam drops assistant replies whose user turn no longer fits', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Stay in character.',
    targetSnapshot: sampleTarget(),
    history: [
      {
        id: 'history-user-0',
        role: 'user',
        text: 'Earlier user turn.',
      },
      {
        id: 'history-assistant-0',
        role: 'assistant',
        text: 'Earlier assistant reply.',
      },
      {
        id: 'history-user-1',
        role: 'user',
        text: `Oversized user turn ${'detail '.repeat(120)}`,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        text: 'This reply must not survive without its user turn.',
      },
      {
        id: 'history-user-2',
        role: 'user',
        text: 'Latest retained user turn.',
      },
    ],
    userText: 'What should we do next?',
    context: sampleTurnContext(),
    modelContextTokens: 2400,
  });

  assert.ok(request.messages.some((message) => message.text === 'Earlier assistant reply.'));
  assert.ok(request.messages.some((message) => message.text === 'Latest retained user turn.'));
  assert.ok(!request.messages.some((message) => message.text === 'This reply must not survive without its user turn.'));
  assert.ok(!request.messages.some((message) => message.text?.startsWith('Oversized user turn')));
});

test('agent local chat execution seam emits multimodal user content when image attachments are present', () => {
  const textOnlyRequest = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: 'Describe this image.',
    context: sampleTurnContext(),
    resolvedBehavior: resolveAgentChatBehavior({
      userText: 'Describe this image.',
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
  });
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: 'Describe this image.',
    context: sampleTurnContext(),
    userAttachments: [{
      kind: 'image',
      url: 'https://cdn.nimi.test/uploads/pasted-image.png',
      mimeType: 'image/png',
      name: 'pasted-image.png',
      resourceId: 'resource-image-1',
    }],
    resolvedBehavior: resolveAgentChatBehavior({
      userText: 'Describe this image.',
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
  });

  const userMessage = request.messages.at(-1);
  assert.equal(userMessage?.role, 'user');
  assert.equal(userMessage?.text, 'Describe this image.');
  assert.deepEqual(userMessage?.content, [{
    type: 'image_url',
    imageUrl: 'https://cdn.nimi.test/uploads/pasted-image.png',
  }, {
    type: 'text',
    text: 'Describe this image.',
  }]);
  assert.match(request.prompt, /"type": "image_url"/);
  assert.match(request.prompt, /"imageUrl": "https:\/\/cdn\.nimi\.test\/uploads\/pasted-image\.png"/);
  assert.doesNotMatch(request.prompt, /resource-image-1/);
  assert.ok(request.diagnostics.estimate.userTokens > textOnlyRequest.diagnostics.estimate.userTokens);
});

test('agent local chat execution seam allows attachment-only turns and emits image placeholder prompt text', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: '',
    context: sampleTurnContext(),
    userAttachments: [{
      kind: 'image',
      url: 'https://cdn.nimi.test/uploads/attachment-only.png',
      mimeType: 'image/png',
      name: 'attachment-only.png',
      resourceId: 'resource-image-2',
    }],
    resolvedBehavior: resolveAgentChatBehavior({
      userText: '',
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
  });

  const userMessage = request.messages.at(-1);
  assert.equal(userMessage?.role, 'user');
  assert.equal(userMessage?.text, '');
  assert.deepEqual(userMessage?.content, [{
    type: 'image_url',
    imageUrl: 'https://cdn.nimi.test/uploads/attachment-only.png',
  }]);
  assert.match(request.prompt, /"type": "image_url"/);
  assert.match(request.prompt, /attachment-only\.png/);
});

test('agent local chat execution seam fails close when irreducible input still exceeds budget', () => {
  assert.throws(() => buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: `Need a very long answer ${'detail '.repeat(800)}`,
    context: sampleTurnContext(),
    modelContextTokens: 80,
  }), /exceeds the available input budget/i);
});

test('agent local chat diagnostics inspection returns a stable copy surface', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: sampleTurnInput().history,
    userText: 'What should we do next?',
    context: sampleTurnContext(),
  });

  const inspection = inspectAgentLocalChatPromptDiagnostics(request.diagnostics);
  inspection.budget.modelContextTokens = 1;
  inspection.estimate.droppedHistoryMessages = 99;
  inspection.continuity.retainedMemoryEntries = 0;
  inspection.transcript.emittedMessages = 0;
  inspection.maxOutputTokensRequested = 99;

  assert.equal(request.diagnostics.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(request.diagnostics.diagnosticsVersion, AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION);
  assert.equal(request.diagnostics.budget.modelContextTokens, 4096);
  assert.equal(request.diagnostics.estimate.droppedHistoryMessages, 1);
  assert.equal(request.diagnostics.continuity.retainedMemoryEntries, 0);
  assert.equal(request.diagnostics.transcript.emittedMessages, 1);
  assert.equal(request.diagnostics.maxOutputTokensRequested, null);
});

test('ai chat execution engine reuse readiness requires text scope and existing consumer ownership', () => {
  const ready = assessAiChatExecutionEngineReuseReadiness({
    consumerId: 'desktop-ai-chat',
    modality: 'text-chat',
    consumerOwnsSemantics: true,
    consumerSuppliesContinuityInputs: true,
    acceptsStructuredMessages: true,
  });

  assert.equal(ready.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.admitted, true);
  assert.deepEqual(ready.reasons, [
    'consumer_scope_text_chat',
    'consumer_owns_semantics',
    'consumer_supplies_continuity_inputs',
    'consumer_accepts_structured_messages',
  ]);

  const preflight = assessAiChatExecutionEngineReuseReadiness({
    consumerId: 'voice-agent-chat',
    modality: 'voice-chat',
    consumerOwnsSemantics: false,
    consumerSuppliesContinuityInputs: true,
    acceptsStructuredMessages: false,
    requiresBehaviorAuthorityChange: true,
    requiresPolicyAuthorityChange: true,
  });

  assert.equal(preflight.status, 'preflight_required');
  assert.equal(preflight.admitted, false);
  assert.ok(preflight.reasons.includes('voice_or_video_scope_not_admitted'));
  assert.ok(preflight.reasons.includes('shared_authority_change_required'));
  assert.ok(preflight.reasons.includes('behavior_authority_change_required'));
  assert.ok(preflight.reasons.includes('policy_authority_change_required'));
});

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
  assert.match(String(committed[0]?.textMessageState?.metadataJson?.rawModelOutput || ''), /schemaId/);
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

test('agent local chat provider commits canceled turns with turn scope before the envelope resolves', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: '{"schemaId":"nimi.agent.chat.beat-action.v1"' };
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

test('agent local chat provider schedules a follow-up turn from the model envelope', async () => {
  const fakeTimers = installFakeTimers();
  const committed: AgentCommitInput[] = [];
  const followUpRuntimeWrites: Array<{ turnId: string; assistantText: string; historyLength: number }> = [];
  try {
    const provider = createAgentLocalChatConversationProvider({
      runtimeAdapter: createRuntimeAdapter({
        async streamText() {
          const envelopeText = createBeatActionEnvelopeText({
            beats: [
              {
                beatId: 'beat-primary',
                beatIndex: 0,
                text: '先给你一句短答。',
              },
              {
                beatId: 'beat-follow-up',
                beatIndex: 1,
                text: '过一会儿我再补一句跟进。',
                delayMs: 400,
              },
            ],
          });
          async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
            yield { type: 'start' };
            yield { type: 'text-delta', textDelta: envelopeText };
            yield {
              type: 'finish',
              finishReason: 'stop',
              trace: {
                traceId: 'trace-follow-up-turn',
                promptTraceId: 'prompt-follow-up-turn',
              },
            };
          }
          return { stream: stream() };
        },
        async invokeText(request) {
          assert.equal(request.threadId, 'thread-1');
          assert.equal(request.messages?.at(-1)?.role, 'assistant');
          assert.equal(request.messages?.at(-1)?.text, '先给你一句短答。');
          assert.doesNotMatch(request.prompt || '', /过一会儿我再补一句跟进/);
          assert.match(request.systemPrompt || '', /FollowUpInstruction:/);
          assert.match(request.systemPrompt || '', /过一会儿我再补一句跟进/);
          return {
            text: JSON.stringify({
              schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
              message: {
                messageId: 'message-follow-up',
                text: '过一会儿我再补一句跟进。',
              },
              actions: [],
            }),
            traceId: 'trace-follow-up-turn-2',
            promptTraceId: 'prompt-follow-up-turn-2',
          };
        },
      }),
      continuityAdapter: createContinuityAdapter(committed, 'truth:151:t1:b2:s0:m0:r0'),
      followUpAssistantRuntimeFollowUp: async (input) => {
        followUpRuntimeWrites.push({
          turnId: input.turnId,
          assistantText: input.assistantText,
          historyLength: input.history.length,
        });
      },
    });

    const iterator = provider.runTurn(sampleTurnInput({
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
    }))[Symbol.asyncIterator]();
    const firstFourEvents = [
      await iterator.next(),
      await iterator.next(),
      await iterator.next(),
      await iterator.next(),
    ].map((entry) => entry.value);
    assert.deepEqual(
      firstFourEvents.map((event) => event.type),
      [
        'turn-started',
        'text-delta',
        'message-sealed',
        'projection-rebuilt',
      ],
    );
    assert.equal(committed.length, 1);
    assert.equal(committed[0]?.textMessageState?.text, '先给你一句短答。');
    assert.match(String(committed[0]?.textMessageState?.metadataJson?.prompt || ''), /What should we do next/);

    const completionEvent = await iterator.next();
    assert.equal(completionEvent.value?.type, 'turn-completed');

    const pendingFollowUpProjection = iterator.next();
    await Promise.resolve();
    const timerIds = fakeTimers.getTimerIds();
    const delayTimerId = timerIds.find((id) => fakeTimers.getTimerDelay(id) === 400);
    assert.ok(delayTimerId, 'expected delay timer from follow-up-turn action');

    fakeTimers.runTimer(delayTimerId);

    const followUpProjection = await pendingFollowUpProjection;
    assert.equal(followUpProjection.value?.type, 'projection-rebuilt');
    assert.equal(followUpProjection.value?.threadId, 'thread-1');

    const completion = await iterator.next();
    assert.equal(completion.done, true);
    assert.equal(completion.value, undefined);

    assert.equal(committed.length, 2);
    assert.equal(committed[0]?.outcome, 'completed');
    assert.equal(committed[1]?.outcome, 'completed');
    assert.equal(committed[1]?.textMessageState?.text, '过一会儿我再补一句跟进。');
    assert.match(String(committed[1]?.textMessageState?.metadataJson?.prompt || ''), /先给你一句短答/);
    assert.doesNotMatch(String(committed[1]?.textMessageState?.metadataJson?.prompt || ''), /过一会儿我再补一句跟进/);
    assert.match(String(committed[1]?.textMessageState?.metadataJson?.rawModelOutput || ''), /message-follow-up/);
    assert.equal(committed[1]?.textMessageState?.metadataJson?.followUpTurn, true);
    assert.equal(committed[1]?.textMessageState?.metadataJson?.followUpInstruction, '过一会儿我再补一句跟进。');
    assert.equal(committed[1]?.textMessageState?.metadataJson?.followUpSourceActionId, 'action-0');
    assert.equal(committed[1]?.textMessageState?.metadataJson?.followUpDelayMs, 400);
    assert.deepEqual(followUpRuntimeWrites, [{
      turnId: committed[1]?.turnId || '',
      assistantText: '过一会儿我再补一句跟进。',
      historyLength: 3,
    }]);
    assert.deepEqual(
      committed[1]?.events.map((event) => event.type),
      [
        'turn-started',
        'message-sealed',
        'turn-completed',
      ],
    );
  } finally {
    fakeTimers.restore();
  }
});

test('agent local chat provider lets follow-up turns continue their own actions and follow-up chain', async () => {
  const fakeTimers = installFakeTimers();
  const committed: AgentCommitInput[] = [];
  const imagePrompts: string[] = [];
  const invokedPrompts: string[] = [];
  const followUpRuntimeWrites: string[] = [];
  try {
    const provider = createAgentLocalChatConversationProvider({
      runtimeAdapter: createRuntimeAdapter({
        async streamText() {
          const envelopeText = createBeatActionEnvelopeText({
            beats: [
              {
                beatId: 'beat-primary',
                beatIndex: 0,
                text: '先说第一句。',
              },
              {
                beatId: 'beat-follow-up-1',
                beatIndex: 1,
                text: '十秒后继续安慰一次。',
                delayMs: 400,
              },
            ],
          });
          async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
            yield { type: 'start' };
            yield { type: 'text-delta', textDelta: envelopeText };
            yield {
              type: 'finish',
              finishReason: 'stop',
              trace: {
                traceId: 'trace-chain-root',
                promptTraceId: 'prompt-chain-root',
              },
            };
          }
          return { stream: stream() };
        },
        async invokeText(request) {
          invokedPrompts.push(String(request.systemPrompt || ''));
          const latestPrompt = invokedPrompts.at(-1) || '';
          assert.equal(request.messages?.at(-1)?.role, 'assistant');
          if (latestPrompt.includes('十秒后继续安慰一次。')) {
            return {
              text: JSON.stringify({
                schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
                message: {
                  messageId: 'message-follow-up-1',
                  text: '我还在，继续陪你。',
                },
                actions: [
                  {
                    actionId: 'action-follow-up-image',
                    actionIndex: 0,
                    actionCount: 2,
                    modality: 'image',
                    operation: 'generate',
                    promptPayload: {
                      kind: 'image-prompt',
                      promptText: '一张安慰氛围的小图',
                    },
                    sourceMessageId: 'message-follow-up-1',
                    deliveryCoupling: 'after-message',
                  },
                  {
                    actionId: 'action-follow-up-next',
                    actionIndex: 1,
                    actionCount: 2,
                    modality: 'follow-up-turn',
                    operation: 'assistant.turn.schedule',
                    promptPayload: {
                      kind: 'follow-up-turn',
                      promptText: '如果你还没回复，我再轻轻问一句。',
                      delayMs: 300,
                    },
                    sourceMessageId: 'message-follow-up-1',
                    deliveryCoupling: 'after-message',
                  },
                ],
              }),
              traceId: 'trace-follow-up-1',
              promptTraceId: 'prompt-follow-up-1',
            };
          }
          assert.match(latestPrompt, /如果你还没回复，我再轻轻问一句。/);
          return {
            text: JSON.stringify({
              schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
              message: {
                messageId: 'message-follow-up-2',
                text: '我还在这里，想说的时候随时告诉我。',
              },
              actions: [],
            }),
            traceId: 'trace-follow-up-2',
            promptTraceId: 'prompt-follow-up-2',
          };
        },
        async generateImage(request) {
          imagePrompts.push(request.prompt);
          return {
            mediaUrl: 'data:image/png;base64,BB==',
            mimeType: 'image/png',
            artifactId: 'artifact-follow-up-image',
            traceId: 'trace-follow-up-image',
          };
        },
      }),
      continuityAdapter: createContinuityAdapter(committed, 'truth:152:t1:b3:s0:m0:r0'),
      followUpAssistantRuntimeFollowUp: async (input) => {
        followUpRuntimeWrites.push(`${input.turnId}:${input.assistantText}`);
      },
    });

    const iterator = provider.runTurn(sampleTurnInput({
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
    }))[Symbol.asyncIterator]();
    const initialEvents = [
      await iterator.next(),
      await iterator.next(),
      await iterator.next(),
      await iterator.next(),
    ].map((entry) => entry.value?.type);
    assert.deepEqual(initialEvents, [
      'turn-started',
      'text-delta',
      'message-sealed',
      'projection-rebuilt',
    ]);

    const completionEvent = await iterator.next();
    assert.equal(completionEvent.value?.type, 'turn-completed');

    const firstFollowUpProjectionPromise = iterator.next();
    await Promise.resolve();
    const firstDelayId = fakeTimers.getTimerIds().find((id) => fakeTimers.getTimerDelay(id) === 400);
    assert.ok(firstDelayId, 'expected first follow-up timer');
    fakeTimers.runTimer(firstDelayId);

    const firstFollowUpProjection = await firstFollowUpProjectionPromise;
    assert.equal(firstFollowUpProjection.value?.type, 'projection-rebuilt');

    const secondFollowUpProjectionPromise = iterator.next();
    await Promise.resolve();
    const secondDelayId = fakeTimers.getTimerIds().find((id) => fakeTimers.getTimerDelay(id) === 300);
    assert.ok(secondDelayId, 'expected second follow-up timer');
    fakeTimers.runTimer(secondDelayId);

    const secondFollowUpProjection = await secondFollowUpProjectionPromise;
    assert.equal(secondFollowUpProjection.value?.type, 'projection-rebuilt');

    const completion = await iterator.next();
    assert.equal(completion.done, true);

    assert.equal(invokedPrompts.length, 2);
    assert.match(invokedPrompts[0] || '', /十秒后继续安慰一次。/);
    assert.match(invokedPrompts[1] || '', /如果你还没回复，我再轻轻问一句。/);
    assert.deepEqual(imagePrompts, ['一张安慰氛围的小图'], JSON.stringify(committed[1]?.imageState));
    assert.equal(committed.length, 3);
    assert.equal(committed[1]?.textMessageState?.metadataJson?.followUpDepth, 1);
    assert.equal(committed[1]?.textMessageState?.metadataJson?.maxFollowUpTurns, 8);
    assert.equal(committed[1]?.textMessageState?.metadataJson?.chainId, committed[2]?.textMessageState?.metadataJson?.chainId);
    assert.equal(committed[2]?.textMessageState?.metadataJson?.followUpDepth, 2);
    assert.equal(committed[1]?.imageState?.status, 'complete');
    assert.equal(committed[2]?.imageState?.status, 'none');
    assert.deepEqual(followUpRuntimeWrites, [
      `${committed[1]?.turnId || ''}:我还在，继续陪你。`,
      `${committed[2]?.turnId || ''}:我还在这里，想说的时候随时告诉我。`,
    ]);
  } finally {
    fakeTimers.restore();
  }
});

test('agent local chat provider suppresses duplicate follow-up text and stops the chain', async () => {
  const fakeTimers = installFakeTimers();
  const committed: AgentCommitInput[] = [];
  let followUpInvocations = 0;
  try {
    const provider = createAgentLocalChatConversationProvider({
      runtimeAdapter: createRuntimeAdapter({
        async streamText() {
          const envelopeText = createBeatActionEnvelopeText({
            beats: [{
              beatId: 'beat-primary',
              beatIndex: 0,
              text: '你好呀！很高兴见到你，我是翠翠。今天心情怎么样？',
            }, {
              beatId: 'beat-follow-up',
              beatIndex: 1,
              text: '如果对方还没回复，就再轻轻问候一句。',
              delayMs: 200,
            }],
          });
          async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
            yield { type: 'start' };
            yield { type: 'text-delta', textDelta: envelopeText };
            yield {
              type: 'finish',
              finishReason: 'stop',
              trace: {
                traceId: 'trace-follow-up-root',
                promptTraceId: 'prompt-follow-up-root',
              },
            };
          }
          return { stream: stream() };
        },
        async invokeText() {
          followUpInvocations += 1;
          return {
            text: JSON.stringify({
              schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
              message: {
                messageId: 'message-follow-up-duplicate',
                text: '你好呀！很高兴见到你，我是翠翠。今天心情怎么样？',
              },
              actions: [{
                actionId: 'action-follow-up-again',
                actionIndex: 0,
                actionCount: 1,
                modality: 'follow-up-turn',
                operation: 'assistant.turn.schedule',
                promptPayload: {
                  kind: 'follow-up-turn',
                  promptText: '重复问一句。',
                  delayMs: 200,
                },
                sourceMessageId: 'message-follow-up-duplicate',
                deliveryCoupling: 'after-message',
              }],
            }),
            traceId: 'trace-follow-up-duplicate',
            promptTraceId: 'prompt-follow-up-duplicate',
          };
        },
      }),
      continuityAdapter: createContinuityAdapter(committed, 'truth:153:t1:b1:s0:m0:r0'),
    });

    const iterator = provider.runTurn(sampleTurnInput())[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    await iterator.next();

    const pendingFollowUpProjection = iterator.next();
    await Promise.resolve();
    const timerId = fakeTimers.getTimerIds().find((id) => fakeTimers.getTimerDelay(id) === 200);
    assert.ok(timerId, 'expected duplicate follow-up timer');
    fakeTimers.runTimer(timerId);

    const followUpProjection = await pendingFollowUpProjection;
    assert.equal(followUpProjection.done, true);
    assert.equal(followUpProjection.value, undefined);
    assert.equal(followUpInvocations, 1);
    assert.equal(committed.length, 1);
    assert.equal(committed[0]?.textMessageState?.text, '你好呀！很高兴见到你，我是翠翠。今天心情怎么样？');
  } finally {
    fakeTimers.restore();
  }
});

test('agent local chat provider stops a pending follow-up chain when the turn signal is aborted', async () => {
  const fakeTimers = installFakeTimers();
  const committed: AgentCommitInput[] = [];
  const abortController = new AbortController();
  try {
    const provider = createAgentLocalChatConversationProvider({
      runtimeAdapter: createRuntimeAdapter({
        async streamText() {
          const envelopeText = createBeatActionEnvelopeText({
            beats: [
              {
                beatId: 'beat-primary',
                beatIndex: 0,
                text: '先回你一句。',
              },
              {
                beatId: 'beat-follow-up',
                beatIndex: 1,
                text: '三秒后再跟进一次。',
                delayMs: 400,
              },
            ],
          });
          async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
            yield { type: 'start' };
            yield { type: 'text-delta', textDelta: envelopeText };
            yield {
              type: 'finish',
              finishReason: 'stop',
              trace: {
                traceId: 'trace-abort-root',
                promptTraceId: 'prompt-abort-root',
              },
            };
          }
          return { stream: stream() };
        },
      }),
      continuityAdapter: createContinuityAdapter(committed, 'truth:153:t1:b1:s0:m0:r0'),
    });

    const iterator = provider.runTurn(sampleTurnInput({
      signal: abortController.signal,
    }))[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    const completionEvent = await iterator.next();
    assert.equal(completionEvent.value?.type, 'turn-completed');

    const pendingProjection = iterator.next();
    await Promise.resolve();
    const delayId = fakeTimers.getTimerIds().find((id) => fakeTimers.getTimerDelay(id) === 400);
    assert.ok(delayId, 'expected pending follow-up timer');

    abortController.abort();

    const completion = await pendingProjection;
    assert.equal(completion.done, true);
    assert.equal(committed.length, 1);
    assert.equal(fakeTimers.getTimerIds().length, 0);
  } finally {
    fakeTimers.restore();
  }
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

test('agent local chat provider executes voice actions and keeps video deferred in phase 1', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-voice-video',
            beatIndex: 0,
            text: '我先只用文字回复你。',
          }],
          actions: [{
            actionId: 'action-voice-1',
            actionIndex: 0,
            modality: 'voice',
            promptText: '一段轻声回应',
            sourceMessageId: 'beat-voice-video',
            sourceBeatIndex: 0,
          }, {
            actionId: 'action-video-1',
            actionIndex: 1,
            modality: 'video',
            promptText: '镜头缓慢推进的夜景',
            sourceMessageId: 'beat-voice-video',
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
              traceId: 'trace-voice-video-turn',
              promptTraceId: 'prompt-voice-video-turn',
            },
          };
        }
        return { stream: stream() };
      },
      async synthesizeVoice(request) {
        assert.equal(request.prompt, '一段轻声回应');
        return {
          mediaUrl: 'file:///tmp/voice-turn.mp3',
          mimeType: 'audio/mpeg',
          artifactId: 'artifact-voice-1',
          traceId: 'trace-voice-1',
          playbackCueEnvelope: null,
        };
      },
      async generateImage() {
        throw new Error('image generation should stay unopened for voice/video-only actions');
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:153:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '你能用声音或者视频回复我吗？',
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
        imageProjection: null,
        voiceProjection: {
          capability: 'audio.synthesize',
          selectedBinding: { source: 'local', connectorId: '', model: 'kokoro-82m' },
          resolvedBinding: { capability: 'audio.synthesize', source: 'local', provider: 'kokoro', model: 'kokoro-82m', modelId: 'kokoro-82m', connectorId: '', endpoint: 'http://127.0.0.1:8010' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageReady: false,
        voiceReady: true,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      voiceExecutionSnapshot: { executionId: 'voice-snapshot' },
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
  assert.equal(events.some((event) => event.type === 'artifact-ready'), true);
  assert.equal(committed[0]?.voiceState?.status, 'complete');
  assert.equal(committed[0]?.voiceState?.mediaUrl, 'file:///tmp/voice-turn.mp3');
  assert.equal(committed[0]?.imageState?.status, 'none');
});

test('agent local chat provider consumes typed image prompt payloads from the model envelope', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-innkeeper',
            beatIndex: 0,
            text: '她抬头看了你一眼。',
          }],
          actions: [{
            actionId: 'action-innkeeper-image',
            actionIndex: 0,
            modality: 'image',
            promptText: 'subject: 客栈老板娘\nscene: 抬头看向来客的瞬间\nstyle: 写实电影感插画\nmood: 克制、略带审视\ncontinuity: 古风客栈, 夜色室内\navoid: 不要多余人物, 不要夸张表情',
            sourceMessageId: 'beat-innkeeper',
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
              traceId: 'trace-planner-turn',
              promptTraceId: 'prompt-planner-turn',
            },
          };
        }
        return { stream: stream() };
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

test('agent local chat provider submits workflow voice actions without silently reusing audio.synthesize', async () => {
  const committed: AgentCommitInput[] = [];
  let synthesizeVoiceCalled = false;
  let submitRequest: TestVoiceWorkflowSubmitRequest | null = null;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-voice-clone',
            beatIndex: 0,
            text: '我可以先把音色方向给你定下来。',
          }],
          actions: [{
            actionId: 'action-voice-clone',
            actionIndex: 0,
            modality: 'voice',
            operation: 'voice_workflow.tts_v2v',
            promptText: '参考这句的温柔低声线，保留亲密但清晰的咬字。',
            sourceMessageId: 'beat-voice-clone',
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
              traceId: 'trace-voice-workflow',
              promptTraceId: 'prompt-voice-workflow',
            },
          };
        }
        return { stream: stream() };
      },
      async synthesizeVoice() {
        synthesizeVoiceCalled = true;
        throw new Error('workflow voice action must not silently call narrow synth runtime');
      },
      async submitVoiceWorkflow(request) {
        submitRequest = request as TestVoiceWorkflowSubmitRequest;
        return {
          jobId: 'voice-workflow-job-clone',
          traceId: 'trace-voice-workflow-submit',
          workflowStatus: 'submitted',
          voiceReference: {
            kind: 'voice_asset_id',
            stableRef: 'voice-asset-clone',
          },
          voiceAssetId: 'voice-asset-clone',
          providerVoiceRef: 'provider-voice-clone',
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:156:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '帮我定一个新的声音分身吧',
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
        imageProjection: null,
        voiceProjection: null,
        voiceWorkflowProjections: {
          'voice_workflow.tts_v2v': {
            capability: 'voice_workflow.tts_v2v',
            selectedBinding: { source: 'cloud', connectorId: 'connector-voice-clone', model: 'qwen3-tts-vc' },
            resolvedBinding: { capability: 'voice_workflow.tts_v2v', source: 'cloud', provider: 'dashscope', model: 'qwen3-tts-vc', modelId: 'qwen3-tts-vc', connectorId: 'connector-voice-clone' },
            health: null,
            metadata: {
              capability: 'voice_workflow.tts_v2v',
              metadataVersion: 'v1',
              resolvedBindingRef: 'voice-clone-ref',
              metadataKind: 'voice_workflow.tts_v2v',
              metadata: {
                workflowType: 'tts_v2v',
              },
            },
            supported: true,
            reasonCode: null,
          },
          'voice_workflow.tts_t2v': null,
        },
        voiceWorkflowReadyByCapability: {
          'voice_workflow.tts_v2v': true,
          'voice_workflow.tts_t2v': false,
        },
        imageReady: false,
        voiceReady: false,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      voiceExecutionSnapshot: null,
      latestVoiceCapture: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'audio/wav',
        transcriptText: '帮我定一个新的声音分身吧',
      },
      voiceWorkflowExecutionSnapshotByCapability: {
        'voice_workflow.tts_v2v': {
          executionId: 'workflow-clone-snapshot',
          conversationCapabilitySlice: {
            capability: 'voice_workflow.tts_v2v',
            resolvedBinding: {
              capability: 'voice_workflow.tts_v2v',
            },
          },
        },
      },
    },
  }));

  assert.equal(synthesizeVoiceCalled, false);
  assert.equal(events.some((event) => event.type === 'artifact-ready'), false);
  if (!submitRequest) {
    assert.fail('expected submitVoiceWorkflow to receive a request');
  }
  const capturedSubmitRequest = submitRequest as unknown as TestVoiceWorkflowSubmitRequest;
  assert.equal(capturedSubmitRequest.workflowIntent.workflowType, 'tts_v2v');
  assert.equal(capturedSubmitRequest.referenceAudio?.mimeType, 'audio/wav');
  assert.deepEqual([...capturedSubmitRequest.referenceAudio?.bytes || []], [1, 2, 3, 4]);
  assert.equal(committed[0]?.voiceState?.status, 'pending');
  if (committed[0]?.voiceState?.status !== 'pending') {
    assert.fail('expected a pending voice workflow state');
  }
  assert.match(committed[0].voiceState.message || '', /Creating a custom voice from current-thread reference audio/i);
  const workflowMetadata = parseAgentChatVoiceWorkflowMetadata(committed[0].voiceState.metadata);
  assert.ok(workflowMetadata);
  assert.equal(workflowMetadata?.workflowStatus, 'submitted');
  assert.equal(workflowMetadata?.jobId, 'voice-workflow-job-clone');
  assert.equal(workflowMetadata?.voiceReference?.kind, 'voice_asset_id');
  assert.equal(workflowMetadata?.sourceMessageId, 'message-0');
  assert.equal(workflowMetadata?.sourceActionId, 'action-voice-clone');
});

test('agent local chat provider fails close when workflow voice clone has no current-thread reference audio', async () => {
  const committed: AgentCommitInput[] = [];
  let synthesizeVoiceCalled = false;
  let submitRequest: TestVoiceWorkflowSubmitRequest | null = null;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-voice-clone',
            beatIndex: 0,
            text: '我需要先拿到这一线程里的参考音频。',
          }],
          actions: [{
            actionId: 'action-voice-clone',
            actionIndex: 0,
            modality: 'voice',
            operation: 'voice_workflow.tts_v2v',
            promptText: '参考这句的温柔低声线，保留亲密但清晰的咬字。',
            sourceMessageId: 'beat-voice-clone',
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
              traceId: 'trace-voice-workflow',
              promptTraceId: 'prompt-voice-workflow',
            },
          };
        }
        return { stream: stream() };
      },
      async synthesizeVoice() {
        synthesizeVoiceCalled = true;
        throw new Error('workflow voice action must not silently call narrow synth runtime');
      },
      async submitVoiceWorkflow(request) {
        submitRequest = request as TestVoiceWorkflowSubmitRequest;
        if (!request.referenceAudio) {
          throw new Error('voice clone workflow requires current-thread reference audio');
        }
        return {
          jobId: 'voice-workflow-job-clone',
          traceId: 'trace-voice-workflow-submit',
          workflowStatus: 'submitted',
          voiceReference: null,
          voiceAssetId: null,
          providerVoiceRef: null,
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:156:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '帮我定一个新的声音分身吧',
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
        imageProjection: null,
        voiceProjection: null,
        voiceWorkflowProjections: {
          'voice_workflow.tts_v2v': {
            capability: 'voice_workflow.tts_v2v',
            selectedBinding: { source: 'cloud', connectorId: 'connector-voice-clone', model: 'qwen3-tts-vc' },
            resolvedBinding: { capability: 'voice_workflow.tts_v2v', source: 'cloud', provider: 'dashscope', model: 'qwen3-tts-vc', modelId: 'qwen3-tts-vc', connectorId: 'connector-voice-clone' },
            health: null,
            metadata: {
              capability: 'voice_workflow.tts_v2v',
              metadataVersion: 'v1',
              resolvedBindingRef: 'voice-clone-ref',
              metadataKind: 'voice_workflow.tts_v2v',
              metadata: {
                workflowType: 'tts_v2v',
              },
            },
            supported: true,
            reasonCode: null,
          },
          'voice_workflow.tts_t2v': null,
        },
        voiceWorkflowReadyByCapability: {
          'voice_workflow.tts_v2v': true,
          'voice_workflow.tts_t2v': false,
        },
        imageReady: false,
        voiceReady: false,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      voiceExecutionSnapshot: null,
      voiceWorkflowExecutionSnapshotByCapability: {
        'voice_workflow.tts_v2v': {
          executionId: 'workflow-clone-snapshot',
          conversationCapabilitySlice: {
            capability: 'voice_workflow.tts_v2v',
            resolvedBinding: {
              capability: 'voice_workflow.tts_v2v',
            },
          },
        },
      },
    },
  }));

  assert.equal(synthesizeVoiceCalled, false);
  assert.equal(events.some((event) => event.type === 'artifact-ready'), false);
  if (!submitRequest) {
    assert.fail('expected submitVoiceWorkflow to receive a request');
  }
  const capturedSubmitRequest = submitRequest as unknown as TestVoiceWorkflowSubmitRequest;
  assert.equal(capturedSubmitRequest.referenceAudio || null, null);
  assert.equal(committed[0]?.voiceState?.status, 'error');
  assert.match(committed[0]?.voiceState?.message || '', /current-thread reference audio/i);
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

test('agent local chat provider completes fenced JSON outputs with recovery diagnostics', async () => {
  const committed: AgentCommitInput[] = [];
  let capturedRequest: AgentRuntimeStreamRequest | null = null;
  const rawModelOutput = `\`\`\`json\n${createBeatActionEnvelopeText({
    beats: [{ beatIndex: 0, text: 'Recovered from fenced JSON.' }],
  })}\n\`\`\``;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText(request) {
        capturedRequest = request;
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: rawModelOutput,
          };
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: 12,
              outputTokens: 18,
            },
            trace: {
              traceId: 'trace-fenced',
              promptTraceId: 'prompt-fenced',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:144:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    agentLocalChat: {
      textModelContextTokens: 4096,
      textMaxOutputTokensRequested: 321,
    },
  }));

  if (!capturedRequest) {
    assert.fail('expected runtime stream request to be captured');
  }
  const fencedRequest = capturedRequest as AgentRuntimeStreamRequest;
  assert.equal(fencedRequest.maxOutputTokensRequested, 321);
  assert.equal(committed[0]?.outcome, 'completed');
  const completedEvent = events.at(-1);
  assert.equal(completedEvent?.type, 'turn-completed');
  if (completedEvent?.type !== 'turn-completed') {
    assert.fail('expected a completed terminal event');
  }
  assert.equal(completedEvent.finishReason, 'stop');
  assert.equal(completedEvent.trace?.traceId, 'trace-fenced');
  assert.equal(completedEvent.trace?.promptTraceId, 'prompt-fenced');
  assert.equal(completedEvent.usage?.inputTokens, 12);
  assert.equal(completedEvent.usage?.outputTokens, 18);
  const diagnostics = completedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'json-fenced');
  assert.equal(diagnostics?.recoveryPath, 'strip-fence');
  assert.equal(diagnostics?.suspectedTruncation, false);
  assert.equal(diagnostics?.parseErrorDetail, null);
  assert.equal(diagnostics?.rawOutputChars, rawModelOutput.length);
  assert.equal(diagnostics?.normalizedOutputChars, rawModelOutput.length);
  assert.equal(diagnostics?.finishReason, 'stop');
  assert.equal(diagnostics?.traceId, 'trace-fenced');
  assert.equal(diagnostics?.promptTraceId, 'prompt-fenced');
  assert.deepEqual(diagnostics?.usage, {
    inputTokens: 12,
    outputTokens: 18,
  });
  assert.equal(diagnostics?.contextWindowSource, 'route-profile');
  assert.equal(diagnostics?.maxOutputTokensRequested, 321);
  assert.equal(diagnostics?.promptOverflow, false);
  assert.match(String(diagnostics?.requestPrompt || ''), /^Messages:\n\[/);
  assert.match(String(diagnostics?.requestSystemPrompt || ''), /Output Contract:/);
  assert.equal(diagnostics?.rawModelOutputText, rawModelOutput);
  assert.equal(diagnostics?.normalizedModelOutputText, rawModelOutput);
});

test('agent local chat provider completes wrapped JSON outputs with recovery diagnostics', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: `Here is the envelope:\n${createBeatActionEnvelopeText({
              beats: [{ beatIndex: 0, text: 'Recovered from wrapper text.' }],
            })}\nThanks.`,
          };
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: 9,
              outputTokens: 14,
            },
            trace: {
              traceId: 'trace-wrapper',
              promptTraceId: 'prompt-wrapper',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:145:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed[0]?.outcome, 'completed');
  const completedEvent = events.at(-1);
  assert.equal(completedEvent?.type, 'turn-completed');
  if (completedEvent?.type !== 'turn-completed') {
    assert.fail('expected a completed terminal event');
  }
  const diagnostics = completedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'json-wrapper');
  assert.equal(diagnostics?.recoveryPath, 'extract-json-object');
  assert.equal(diagnostics?.finishReason, 'stop');
});

test('agent local chat provider fails closed when the model emits scratchpad plain text', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: [
              '*分析：用户连续发送了“在吗？”',
              '',
              '策略：先安抚，再确认状态。',
              '',
              '执行：回复一句自然问候。',
            ].join('\n'),
          };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-scratchpad',
              promptTraceId: 'prompt-scratchpad',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:145a:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.match(failedEvent.error.message, /format was invalid/i);
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'invalid-json');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.traceId, 'trace-scratchpad');
  assert.equal(diagnostics?.promptTraceId, 'prompt-scratchpad');
  assert.equal(events.some((event) => event.type === 'message-sealed'), false);
});

test('agent local chat provider fails partial JSON outputs with truncation diagnostics', async () => {
  const committed: AgentCommitInput[] = [];
  let capturedRequest: AgentRuntimeStreamRequest | null = null;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText(request) {
        capturedRequest = request;
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: `{"schemaId":"${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}","beats":[{"beatId":"beat-0"`,
          };
          yield {
            type: 'finish',
            finishReason: 'length',
            usage: {
              inputTokens: 40,
              outputTokens: 41,
            },
            trace: {
              traceId: 'trace-partial',
              promptTraceId: 'prompt-partial',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:146:t1:b0:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    agentLocalChat: {
      textModelContextTokens: 4096,
      textMaxOutputTokensRequested: 111,
    },
  }));

  if (!capturedRequest) {
    assert.fail('expected runtime stream request to be captured');
  }
  const partialRequest = capturedRequest as AgentRuntimeStreamRequest;
  assert.equal(partialRequest.maxOutputTokensRequested, 111);
  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.match(failedEvent.error.message, /truncated/i);
  assert.match(failedEvent.error.message, /Partial output:/);
  assert.match(failedEvent.error.message, /"schemaId":"nimi\.agent\.chat\.message-action\.v1"/);
  assert.equal(failedEvent.finishReason, 'length');
  assert.equal(failedEvent.trace?.traceId, 'trace-partial');
  assert.equal(failedEvent.trace?.promptTraceId, 'prompt-partial');
  assert.equal(failedEvent.usage?.inputTokens, 40);
  assert.equal(failedEvent.usage?.outputTokens, 41);
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'partial-json');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.suspectedTruncation, true);
  assert.equal(diagnostics?.finishReason, 'length');
  assert.equal(diagnostics?.traceId, 'trace-partial');
  assert.equal(diagnostics?.promptTraceId, 'prompt-partial');
  assert.equal(diagnostics?.contextWindowSource, 'route-profile');
  assert.equal(diagnostics?.maxOutputTokensRequested, 111);
  assert.equal(diagnostics?.promptOverflow, false);
});

test('agent local chat provider fails close before runtime when prompt preflight still overflows after reduction', async () => {
  const committed: AgentCommitInput[] = [];
  let runtimeCalled = 0;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        runtimeCalled += 1;
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:147:t1:b0:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userMessage: {
      id: 'user-overflow-1',
      text: `Need a very long answer ${'detail '.repeat(800)}`,
    },
    agentLocalChat: {
      textModelContextTokens: 80,
      textMaxOutputTokensRequested: 111,
    },
  }));

  assert.equal(runtimeCalled, 0);
  assert.equal(committed[0]?.outcome, 'failed');
  assert.equal(events[0]?.type, 'turn-started');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.match(failedEvent.error.message, /available input budget/i);
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'preflight-rejected');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.promptOverflow, true);
  assert.equal(diagnostics?.contextWindowSource, 'route-profile');
  assert.match(String(diagnostics?.requestPrompt || ''), /^Messages:\n\[/);
  const preflight = diagnostics?.preflight as Record<string, unknown> | undefined;
  assert.equal(typeof preflight?.totalInputTokens, 'number');
  assert.equal(typeof preflight?.promptBudgetTokens, 'number');
  assert.equal(typeof preflight?.systemTokens, 'number');
  assert.equal(typeof preflight?.historyTokens, 'number');
  assert.equal(typeof preflight?.userTokens, 'number');
  assert.ok(Number(preflight?.totalInputTokens) > Number(preflight?.promptBudgetTokens));
  assert.ok(Number(preflight?.promptBudgetTokens) >= 0);
  assert.ok(Number(preflight?.systemTokens) >= 0);
  assert.ok(Number(preflight?.historyTokens) >= 0);
  assert.ok(Number(preflight?.userTokens) >= 0);
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
        type: 'message-sealed',
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

test('agent local chat continuity adapter commits canonical voice projection messages', async () => {
  const commitCalls: unknown[] = [];
  const adapter = createAgentLocalChatContinuityAdapter({
    now: () => 240,
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

  await adapter.commitAgentTurnResult({
    modeId: 'agent-local-chat-v1',
    threadId: 'thread-1',
    turnId: 'turn-voice-1',
    outcome: 'completed',
    outputText: '我给你留一段语音。',
    events: [{
      type: 'turn-completed',
      turnId: 'turn-voice-1',
      outputText: '我给你留一段语音。',
      trace: {
        traceId: 'trace-voice-1',
        promptTraceId: 'prompt-voice-1',
      },
    }],
    voiceState: {
      status: 'complete',
      beatId: 'turn-voice-1:beat:1',
      beatIndex: 1,
      projectionMessageId: 'turn-voice-1:message:1',
      prompt: '轻声说晚安',
      transcriptText: '晚安，记得早点休息。',
      mediaUrl: 'file:///tmp/voice-turn-1.mp3',
      mimeType: 'audio/mpeg',
      artifactId: 'voice-artifact-1',
      sourceMessageId: 'turn-voice-1:message:0',
      sourceActionId: 'action-voice-1',
      playbackCueEnvelope: {
        version: 'v1',
        source: 'runtime',
        cues: [
          {
            offsetMs: 0,
            durationMs: 140,
            amplitude: 0.24,
            visemeId: 'aa',
          },
          {
            offsetMs: 140,
            durationMs: 160,
            amplitude: 0.58,
            visemeId: 'ou',
          },
        ],
      },
    },
  });

  assert.equal(commitCalls.length, 1);
  assert.deepEqual(commitCalls[0], {
    threadId: 'thread-1',
    turn: {
      id: 'turn-voice-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      providerMode: 'agent-local-chat-v1',
      traceId: 'trace-voice-1',
      promptTraceId: 'prompt-voice-1',
      startedAtMs: 240,
      completedAtMs: 240,
      abortedAtMs: null,
    },
    beats: [
      {
        ...createAgentTurnBeat({
          id: 'turn-voice-1:beat:0',
          turnId: 'turn-voice-1',
          beatIndex: 0,
          modality: 'text',
          status: 'delivered',
          textShadow: '我给你留一段语音。',
          artifactId: null,
          mimeType: 'text/plain',
          mediaUrl: null,
          projectionMessageId: 'turn-voice-1:message:0',
          createdAtMs: 240,
          deliveredAtMs: 240,
        }),
      },
      {
        ...createAgentTurnBeat({
          id: 'turn-voice-1:beat:1',
          turnId: 'turn-voice-1',
          beatIndex: 1,
          modality: 'voice',
          status: 'delivered',
          textShadow: '晚安，记得早点休息。',
          artifactId: 'voice-artifact-1',
          mimeType: 'audio/mpeg',
          mediaUrl: 'file:///tmp/voice-turn-1.mp3',
          projectionMessageId: 'turn-voice-1:message:1',
          createdAtMs: 240,
          deliveredAtMs: 240,
        }),
      },
    ],
    interactionSnapshot: null,
    relationMemorySlots: [],
    recallEntries: [],
    projection: {
      thread: {
        id: 'thread-1',
        title: 'Companion',
        updatedAtMs: 240,
        lastMessageAtMs: 240,
        archivedAtMs: null,
        targetSnapshot: sampleTarget(),
      },
      messages: [
        createAgentTextMessage({
          id: 'turn-voice-1:message:0',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          contentText: '我给你留一段语音。',
          traceId: 'trace-voice-1',
          createdAtMs: 240,
          updatedAtMs: 240,
        }),
        createAgentVoiceMessage({
          id: 'turn-voice-1:message:1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          contentText: '',
          mediaUrl: 'file:///tmp/voice-turn-1.mp3',
          mediaMimeType: 'audio/mpeg',
          artifactId: 'voice-artifact-1',
          metadataJson: {
            playbackPrompt: '轻声说晚安',
            playbackCueEnvelope: {
              version: 'v1',
              source: 'runtime',
              cues: [
                {
                  offsetMs: 0,
                  durationMs: 140,
                  amplitude: 0.24,
                  visemeId: 'aa',
                },
                {
                  offsetMs: 140,
                  durationMs: 160,
                  amplitude: 0.58,
                  visemeId: 'ou',
                },
              ],
            },
            sourceActionId: 'action-voice-1',
            sourceMessageId: 'turn-voice-1:message:0',
            transcriptText: '晚安，记得早点休息。',
          },
          createdAtMs: 240,
          updatedAtMs: 240,
        }),
      ],
      draft: null,
      clearDraft: true,
    },
  });
});

test('chat agent projection parser accepts voice messages', () => {
  const projection = parseAgentLocalProjectionCommitInput({
    thread: {
      id: 'thread-1',
      title: 'Companion',
      updatedAtMs: 240,
      lastMessageAtMs: 240,
      archivedAtMs: null,
      targetSnapshot: sampleTarget(),
    },
    messages: [{
      id: 'turn-voice-1:message:1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      kind: 'voice',
      contentText: '晚安，记得早点休息。',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: null,
      mediaUrl: 'file:///tmp/voice-turn-1.mp3',
      mediaMimeType: 'audio/mpeg',
      artifactId: 'voice-artifact-1',
      createdAtMs: 240,
      updatedAtMs: 240,
    }],
    draft: null,
    clearDraft: true,
  });

  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0]?.kind, 'voice');
  assert.equal(projection.messages[0]?.mediaMimeType, 'audio/mpeg');
});

test('agent local chat continuity adapter does not emit duplicate text projections for voice errors', async () => {
  const commitCalls: unknown[] = [];
  const adapter = createAgentLocalChatContinuityAdapter({
    now: () => 260,
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

  await adapter.commitAgentTurnResult({
    modeId: 'agent-local-chat-v1',
    threadId: 'thread-1',
    turnId: 'turn-voice-error-1',
    outcome: 'completed',
    outputText: '你好呀！很高兴见到你，今天有什么想和我聊的吗？',
    events: [{
      type: 'turn-completed',
      turnId: 'turn-voice-error-1',
      outputText: '你好呀！很高兴见到你，今天有什么想和我聊的吗？',
      trace: {
        traceId: 'trace-voice-error-1',
        promptTraceId: 'prompt-voice-error-1',
      },
    }],
    voiceState: {
      status: 'error',
      beatId: 'turn-voice-error-1:beat:1',
      beatIndex: 1,
      projectionMessageId: 'turn-voice-error-1:message:1',
      prompt: '你好呀！很高兴见到你，今天有什么想和我聊的吗？',
      transcriptText: '你好呀！很高兴见到你，今天有什么想和我聊的吗？',
      message: 'Voice playback is unavailable because no voice route is configured.',
      sourceMessageId: 'turn-voice-error-1:message:0',
      sourceActionId: 'action-voice-error-1',
    },
  });

  assert.equal(commitCalls.length, 1);
  assert.deepEqual(commitCalls[0], {
    threadId: 'thread-1',
    turn: {
      id: 'turn-voice-error-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'completed',
      providerMode: 'agent-local-chat-v1',
      traceId: 'trace-voice-error-1',
      promptTraceId: 'prompt-voice-error-1',
      startedAtMs: 260,
      completedAtMs: 260,
      abortedAtMs: null,
    },
    beats: [
      {
        ...createAgentTurnBeat({
          id: 'turn-voice-error-1:beat:0',
          turnId: 'turn-voice-error-1',
          beatIndex: 0,
          modality: 'text',
          status: 'delivered',
          textShadow: '你好呀！很高兴见到你，今天有什么想和我聊的吗？',
          artifactId: null,
          mimeType: 'text/plain',
          mediaUrl: null,
          projectionMessageId: 'turn-voice-error-1:message:0',
          createdAtMs: 260,
          deliveredAtMs: 260,
        }),
      },
      {
        ...createAgentTurnBeat({
          id: 'turn-voice-error-1:beat:1',
          turnId: 'turn-voice-error-1',
          beatIndex: 1,
          modality: 'voice',
          status: 'failed',
          textShadow: '你好呀！很高兴见到你，今天有什么想和我聊的吗？',
          artifactId: null,
          mimeType: null,
          mediaUrl: null,
          projectionMessageId: null,
          createdAtMs: 260,
          deliveredAtMs: null,
        }),
      },
    ],
    interactionSnapshot: null,
    relationMemorySlots: [],
    recallEntries: [],
    projection: {
      thread: {
        id: 'thread-1',
        title: 'Companion',
        updatedAtMs: 260,
        lastMessageAtMs: 260,
        archivedAtMs: null,
        targetSnapshot: sampleTarget(),
      },
      messages: [
        createAgentTextMessage({
          id: 'turn-voice-error-1:message:0',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          contentText: '你好呀！很高兴见到你，今天有什么想和我聊的吗？',
          traceId: 'trace-voice-error-1',
          createdAtMs: 260,
          updatedAtMs: 260,
        }),
      ],
      draft: null,
      clearDraft: true,
    },
  });
});
