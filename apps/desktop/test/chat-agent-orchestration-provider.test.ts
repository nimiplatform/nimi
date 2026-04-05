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
  createAgentLocalChatContinuityAdapter,
  createAgentLocalChatConversationProvider,
  type AgentLocalChatRuntimeAdapter,
} from '../src/shell/renderer/features/chat/chat-agent-orchestration.js';

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
      id: 'beat-prev-1',
      turnId: 'turn-prev-1',
      beatIndex: 0,
      modality: 'text',
      status: 'delivered',
      textShadow: 'previous answer',
      artifactId: null,
      mimeType: 'text/plain',
      projectionMessageId: 'message-prev-1',
      createdAtMs: 11,
      deliveredAtMs: 12,
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
      id: 'turn-1:beat:0',
      turnId: 'turn-1',
      beatIndex: 0,
      modality: 'text',
      status: 'delivered',
      textShadow: 'hello world',
      artifactId: null,
      mimeType: 'text/plain',
      projectionMessageId: 'turn-1:message:0',
      createdAtMs: 100,
      deliveredAtMs: 140,
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

function sampleTurnInput(): ConversationTurnInput {
  return {
    modeId: 'agent-local-chat-v1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    userMessage: {
      id: 'user-message-1',
      text: 'What should we do next?',
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
      },
    },
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
});

test('agent local chat provider emits first-beat before terminal and commits completed turn', async () => {
  const runtimeCalls: string[] = [];
  const runtimeAdapter: AgentLocalChatRuntimeAdapter = {
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
  };
  const committed: Array<Parameters<NonNullable<ReturnType<typeof createAgentLocalChatContinuityAdapter>['commitTurnResult']>>[0]> = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter,
    continuityAdapter: {
      async loadTurnContext() {
        return sampleTurnContext();
      },
      async commitTurnResult(input) {
        committed.push(input);
        return sampleCommitResult();
      },
      async cancelTurn() {
        throw new Error('cancelTurn should not run during completed turn');
      },
      async rebuildProjection() {
        return {
          threadId: 'thread-1',
          projectionVersion: 'truth:140:t1:b1:s0:m0:r0',
        };
      },
    },
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
  const committed: Array<Parameters<NonNullable<ReturnType<typeof createAgentLocalChatContinuityAdapter>['commitTurnResult']>>[0]> = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: {
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: 'partial answer' };
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        return { stream: stream() };
      },
    },
    continuityAdapter: {
      async loadTurnContext() {
        return sampleTurnContext();
      },
      async commitTurnResult(input) {
        committed.push(input);
        return {
          ...sampleCommitResult(),
          projectionVersion: 'truth:141:t1:b1:s0:m0:r0',
        };
      },
      async cancelTurn() {
        throw new Error('cancelTurn should not run during terminal commit path');
      },
      async rebuildProjection() {
        return {
          threadId: 'thread-1',
          projectionVersion: 'truth:141:t1:b1:s0:m0:r0',
        };
      },
    },
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'canceled');
  const canceledEvent = events.at(-1);
  assert.equal(canceledEvent?.type, 'turn-canceled');
  assert.equal(canceledEvent?.type === 'turn-canceled' ? canceledEvent.scope : null, 'tail');
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
      id: 'turn-1:beat:0',
      turnId: 'turn-1',
      beatIndex: 0,
      modality: 'text',
      status: 'delivered',
      textShadow: 'hello world',
      artifactId: null,
      mimeType: 'text/plain',
      projectionMessageId: 'turn-1:message:0',
      createdAtMs: 200,
      deliveredAtMs: 200,
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
      messages: [{
        id: 'turn-1:message:0',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'complete',
        contentText: 'hello world',
        reasoningText: null,
        error: null,
        traceId: 'trace-1',
        parentMessageId: null,
        createdAtMs: 200,
        updatedAtMs: 200,
      }],
      draft: null,
      clearDraft: true,
    },
  });
});
