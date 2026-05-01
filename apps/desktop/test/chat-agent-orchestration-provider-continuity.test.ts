import {
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
} from './chat-agent-orchestration-provider-test-utils.js';
import type {
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
} from './chat-agent-orchestration-provider-test-utils.js';

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
