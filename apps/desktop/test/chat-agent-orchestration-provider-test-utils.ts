import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ConversationRuntimeTextStreamPart,
  ConversationTurnInput,
} from '@nimiplatform/kit/features/chat';
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
} from '../src/shell/renderer/features/chat/chat-nimi-execution-engine.js';
import { AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID } from '../src/shell/renderer/features/chat/chat-agent-behavior.js';
import { resolveAgentChatBehavior } from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver.js';
import {
  clearAllStreams,
  clearStream,
  feedStreamEvent,
  startStream,
} from '../src/shell/renderer/features/turns/stream-controller.js';
import {
  createAgentVoiceMessage,
  createAgentTextMessage,
  createAgentTurnBeat,
} from './helpers/agent-chat-record-fixtures.js';

type AgentCommitInput = Parameters<ReturnType<typeof createAgentLocalChatContinuityAdapter>['commitAgentTurnResult']>[0];
type AgentRuntimeStreamRequest = Parameters<AgentLocalChatRuntimeAdapter['streamText']>[0];
type TestVoiceWorkflowSubmitRequest = {
  workflowIntent: {
    workflowType: 'voice_clone' | 'voice_design';
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
    modality: 'image' | 'voice';
    operation?: string;
    promptText: string;
    sourceMessageId: string;
    sourceBeatIndex?: number;
    deliveryCoupling?: 'after-message' | 'with-message';
  }>;
}): string {
  const primaryBeat = input.beats[0];
  if (!primaryBeat) {
    throw new Error('APML test helper requires at least one message beat');
  }
  const messageId = 'message-0';
  const escapeAPML = (value: string): string => value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
  const message = `<message id="${messageId}">${escapeAPML(primaryBeat.text)}</message>`;
  const actions = (input.actions || []).map((action) => {
    return [
      `<action id="${action.actionId ?? `action-${action.actionIndex}`}" kind="${action.modality}">`,
      `  <prompt-payload kind="${action.modality}"><prompt-text>${escapeAPML(action.promptText)}</prompt-text></prompt-payload>`,
      '</action>',
    ].join('\n');
  });
  return [message, ...actions].join('\n');
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
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    displayName: 'Companion',
    handle: '~companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'Helpful companion',
    ownershipType: 'WORLD_OWNED',
    greeting: null,
    builtinDocsContext: null,
  };
}

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
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
        ownerUserId: 'user-1',
        realmAgentId: 'agent-1',
        localAgentRef: 'local-agent:user-1:agent-1',
        conversationAnchorId: 'anchor-1',
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

export {
  assert,
  test,
  parseAgentLocalProjectionCommitInput,
  buildAgentLocalChatPrompt,
  createAgentTailAbortSignal,
  createAgentLocalChatContinuityAdapter,
  createAgentLocalChatConversationProvider,
  AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION,
  AI_CHAT_EXECUTION_ENGINE_ID,
  assessAiChatExecutionEngineReuseReadiness,
  buildAgentLocalChatExecutionTextRequest,
  inspectAgentLocalChatPromptDiagnostics,
  AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  resolveAgentChatBehavior,
  clearAllStreams,
  clearStream,
  feedStreamEvent,
  startStream,
  createAgentVoiceMessage,
  createAgentTextMessage,
  createAgentTurnBeat,
  installBrowserGlobals,
  installFakeTimers,
  createRuntimeAdapter,
  createBeatActionEnvelopeText,
  createContinuityAdapter,
  sampleTarget,
  sampleThread,
  sampleTurnContext,
  sampleCommitResult,
  sampleTurnInput,
  collectEvents,
};

export type {
  ConversationRuntimeTextStreamPart,
  ConversationTurnInput,
  AgentLocalCommitTurnResult,
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalTurnContext,
  AgentLocalChatRuntimeAdapter,
  AgentCommitInput,
  AgentRuntimeStreamRequest,
  TestVoiceWorkflowSubmitRequest,
};
