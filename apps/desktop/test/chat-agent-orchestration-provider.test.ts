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
import { AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID } from '../src/shell/renderer/features/chat/chat-agent-behavior.js';
import { resolveAgentChatBehavior } from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver.js';
import { buildDesktopChatOutputContractSection } from '../src/shell/renderer/features/chat/chat-output-contract.js';
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
    modality: 'image' | 'voice' | 'video';
    operation?: string;
    promptText: string;
    sourceBeatId: string;
    sourceBeatIndex: number;
    deliveryCoupling?: 'after-source-beat' | 'with-source-beat';
  }>;
}): string {
  const beats = input.beats.map((beat) => ({
    beatId: beat.beatId ?? `beat-${beat.beatIndex}`,
    beatIndex: beat.beatIndex,
    beatCount: input.beats.length,
    intent: beat.intent ?? (beat.beatIndex === 0 ? 'reply' : 'follow-up'),
    deliveryPhase: beat.deliveryPhase ?? (beat.beatIndex === 0 ? 'primary' : 'tail'),
    text: beat.text,
    ...(beat.delayMs !== undefined ? { delayMs: beat.delayMs } : {}),
  }));
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
          : 'video-prompt',
      promptText: action.promptText,
    },
    sourceBeatId: action.sourceBeatId,
    sourceBeatIndex: action.sourceBeatIndex,
    deliveryCoupling: action.deliveryCoupling ?? 'after-source-beat',
  }));
  return JSON.stringify({
    schemaId: AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID,
    beats,
    actions,
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
  assert.match(prompt, /What should we do next/);
  assert.match(prompt, /Output Contract:/);
  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, new RegExp(AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, new RegExp(buildDesktopChatOutputContractSection().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('agent local chat execution seam shapes system prompt and transcript messages', () => {
  const resolvedBehavior = resolveAgentChatBehavior({
    userText: 'What should we do next?',
    settings: {
      thinkingPreference: 'off',
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
  assert.match(request.systemPrompt || '', /"userPrefs": \{[\s\S]*"brevity": true/);
  assert.match(request.systemPrompt || '', /"resolvedTurnMode": "information"/);
  assert.doesNotMatch(request.systemPrompt || '', /"allowMultiReply":/);
  assert.doesNotMatch(request.systemPrompt || '', /"deliveryPolicy":/);
  assert.match(request.systemPrompt || '', /Output Contract:/);
  assert.match(request.systemPrompt || '', /Return exactly one JSON object/);
  assert.equal(request.diagnostics.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(request.diagnostics.diagnosticsVersion, AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION);
  assert.equal(request.diagnostics.firstConsumerId, 'agent-local-chat-v1');
  assert.equal(request.diagnostics.contextWindowSource, 'default');
  assert.equal(request.diagnostics.budget.modelContextTokens, 4096);
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
  assert.doesNotMatch(request.prompt, /Transcript:/);
  assert.match(request.prompt, /UserMessage:/);
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
          sourceBeatId: 'beat-prev-1',
          score: 0.8,
          updatedAtMs: 16,
        },
        {
          id: 'memory-3',
          threadId: 'thread-1',
          slotType: 'context',
          summary: 'The user is planning a summary reply',
          sourceTurnId: 'turn-prev-1',
          sourceBeatId: 'beat-prev-1',
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
          sourceBeatId: 'beat-prev-1',
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
    modelContextTokens: 1200,
  });

  assert.equal(request.diagnostics.contextWindowSource, 'explicit');
  assert.equal(request.diagnostics.budget.modelContextTokens, 1200);
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

test('agent local chat execution seam emits multimodal user content when image attachments are present', () => {
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
  assert.match(request.prompt, /UserAttachments:/);
  assert.match(request.prompt, /"resourceId": "resource-image-1"/);
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
  assert.match(request.prompt, /User: \[Image attachment\]/);
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

  assert.equal(request.diagnostics.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(request.diagnostics.diagnosticsVersion, AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION);
  assert.equal(request.diagnostics.budget.modelContextTokens, 4096);
  assert.equal(request.diagnostics.estimate.droppedHistoryMessages, 1);
  assert.equal(request.diagnostics.continuity.retainedMemoryEntries, 1);
  assert.equal(request.diagnostics.transcript.emittedMessages, 1);
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

test('agent local chat provider emits first-beat before terminal and commits completed turn', async () => {
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
  assert.match(runtimeCalls[0]?.prompt || '', /User prefers concise answers/);
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
      'beat-planned',
      'first-beat-sealed',
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

test('agent local chat provider resolves delayed follow-up beats from the model envelope', async () => {
  const fakeTimers = installFakeTimers();
  const committed: AgentCommitInput[] = [];
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
      }),
      continuityAdapter: createContinuityAdapter(committed, 'truth:151:t1:b2:s0:m0:r0'),
    });

    const iterator = provider.runTurn(sampleTurnInput())[Symbol.asyncIterator]();
    const firstFiveEvents = [
      await iterator.next(),
      await iterator.next(),
      await iterator.next(),
      await iterator.next(),
      await iterator.next(),
    ].map((entry) => entry.value);
    assert.deepEqual(
      firstFiveEvents.map((event) => event.type),
      [
        'turn-started',
        'beat-planned',
        'beat-planned',
        'first-beat-sealed',
        'beat-delivered',
      ],
    );

    const pendingTailStart = iterator.next();
    await Promise.resolve();

    const timerIds = fakeTimers.getTimerIds();
    const delayTimerId = timerIds.find((id) => fakeTimers.getTimerDelay(id) === 400);
    assert.ok(delayTimerId, 'expected delay timer from resolved wait field');

    let settled = false;
    void pendingTailStart.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);

    fakeTimers.runTimer(delayTimerId);

    const remainingEvents = [
      (await pendingTailStart).value,
      (await iterator.next()).value,
      (await iterator.next()).value,
      (await iterator.next()).value,
    ];
    assert.deepEqual(
      remainingEvents.map((event) => event.type),
      [
        'beat-delivery-started',
        'beat-delivered',
        'projection-rebuilt',
        'turn-completed',
      ],
    );
    assert.equal(committed[0]?.textBeatStates?.length, 2);
    assert.equal(committed[0]?.textBeatStates?.[0]?.text, '先给你一句短答。');
    assert.equal(committed[0]?.textBeatStates?.[1]?.text, '过一会儿我再补一句跟进。');
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
            sourceBeatId: 'beat-primary',
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
            sourceBeatId: 'beat-selfie',
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
            sourceBeatId: 'beat-voice-video',
            sourceBeatIndex: 0,
          }, {
            actionId: 'action-video-1',
            actionIndex: 1,
            modality: 'video',
            promptText: '镜头缓慢推进的夜景',
            sourceBeatId: 'beat-voice-video',
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
      'beat-planned',
      'first-beat-sealed',
      'beat-delivered',
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
            sourceBeatId: 'beat-innkeeper',
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
            sourceBeatId: 'beat-voice-clone',
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
  assert.equal(workflowMetadata?.sourceBeatId, 'beat-voice-clone');
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
            sourceBeatId: 'beat-voice-clone',
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
      sourceBeatId: 'turn-voice-1:beat:0',
      sourceActionId: 'action-voice-1',
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
    beats: [{
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
    }],
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
      messages: [createAgentVoiceMessage({
        id: 'turn-voice-1:message:1',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'complete',
        contentText: '晚安，记得早点休息。',
        mediaUrl: 'file:///tmp/voice-turn-1.mp3',
        mediaMimeType: 'audio/mpeg',
        artifactId: 'voice-artifact-1',
        createdAtMs: 240,
        updatedAtMs: 240,
      })],
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
