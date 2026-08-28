import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { overlayAgentAssistantVisibleState } from '../src/shell/renderer/features/chat/chat-agent-shell-bundle.js';
import {
  createInitialAgentTurnLifecycleState,
  reduceAgentTurnLifecycleState,
} from '../src/shell/renderer/features/chat/chat-agent-shell-lifecycle.js';
import {
  resolveCompletedAgentHostInteraction,
  resolveInterruptedAgentHostInteraction,
  resolveProjectionRefreshAgentHostInteraction,
} from '../src/shell/renderer/features/chat/chat-agent-shell-host-interaction.js';
import type { StreamState } from './helpers/test-stream-controller.js';
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    targetSnapshot: {
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      conversationAnchorId: 'anchor-agent-1',
      displayName: 'Companion',
      handle: '~companion',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };
}

function baseUserBundle(): AgentLocalThreadBundle {
  return {
    thread: sampleThread(),
    messages: [createAgentTextMessage({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    })],
  };
}

function assistantPlaceholder() {
  return createAgentTextMessage({
    id: 'assistant-1',
    threadId: 'thread-1',
    role: 'assistant' as const,
    status: 'pending' as const,
    contentText: '',
    parentMessageId: 'user-1',
    createdAtMs: 101,
    updatedAtMs: 101,
  });
}

function authoritativeBundle(): AgentLocalThreadBundle {
  return {
    thread: {
      ...sampleThread(),
      updatedAtMs: 999,
      lastMessageAtMs: 999,
    },
    messages: [createAgentTextMessage({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    }), createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'authoritative projection',
      reasoningText: 'authoritative reasoning',
      traceId: 'trace-authoritative',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 999,
    })],
  };
}

function streamState(overrides: Partial<StreamState>): StreamState {
  return {
    chatId: 'thread-1',
    phase: 'idle',
    partialText: '',
    partialReasoningText: '',
    errorMessage: null,
    interrupted: false,
    firstContentWarning: false,
    startedAt: 0,
    firstContentChunkAt: null,
    lastActivityAt: null,
    idleDeadlineAt: null,
    reasonCode: null,
    traceId: null,
    cancelSource: null,
    ...overrides,
  };
}

test('agent host interaction preserves authoritative content and interrupted footer across first-beat, projection rebuild, stale delta, and cancel', () => {
  const firstBeatBundle = overlayAgentAssistantVisibleState({
    bundle: baseUserBundle(),
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    partialText: 'sealed first beat',
    partialReasoningText: '',
    updatedAtMs: 120,
  });
  assert.equal(firstBeatBundle.messages.at(-1)?.contentText, 'sealed first beat');

  let lifecycle = createInitialAgentTurnLifecycleState();
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'projection-rebuilt',
    threadId: 'thread-1',
  });

  const refreshedInteraction = resolveProjectionRefreshAgentHostInteraction({
    lifecycle,
    streamSnapshot: streamState({
      phase: 'streaming',
      partialText: 'sealed first beat',
    }),
    refreshedBundle: authoritativeBundle(),
    composerText: '',
  });
  assert.ok(refreshedInteraction);

  const staleDeltaBundle = overlayAgentAssistantVisibleState({
    bundle: refreshedInteraction?.bundle,
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    partialText: 'stale tail that should not win',
    partialReasoningText: 'stale reasoning',
    updatedAtMs: 130,
  });

  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'turn-canceled',
    turnId: 'turn-1',
    scope: 'tail',
    outputText: 'authoritative projection',
    reasoningText: 'authoritative reasoning',
    trace: {
      traceId: 'trace-tail',
      promptTraceId: 'prompt-tail',
    },
  });

  const interaction = resolveInterruptedAgentHostInteraction({
    optimisticBundle: staleDeltaBundle,
    refreshedBundle: authoritativeBundle(),
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    partialText: 'stale tail that should not win',
    partialReasoningText: 'stale reasoning',
    runtimeError: {
      code: 'OPERATION_ABORTED',
      message: 'Generation stopped.',
    },
    traceId: 'trace-tail',
    submittedText: 'retry this',
    updatedAtMs: 140,
    lifecycle,
    streamSnapshot: streamState({
      phase: 'cancelled',
      interrupted: true,
      partialText: 'stale tail that should not win',
      partialReasoningText: 'stale reasoning',
      errorMessage: 'Generation stopped.',
      reasonCode: ReasonCode.OPERATION_ABORTED,
      traceId: 'trace-tail',
      cancelSource: 'user',
    }),
  });

  assert.equal(interaction.bundle.messages.at(-1)?.contentText, 'authoritative projection');
  assert.equal(interaction.bundle.messages.at(-1)?.reasoningText, 'authoritative reasoning');
  assert.deepEqual(interaction.selection, {
    agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    conversationAnchorId: 'anchor-agent-1',
    targetId: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });
  assert.equal(interaction.footerState, 'interrupted');
  assert.deepEqual(interaction.footerViewState, {
    displayState: 'interrupted',
    pendingFirstBeat: false,
  });
});

test('agent host interaction keeps interrupted placeholder state when the turn fails before first-beat', () => {
  let lifecycle = createInitialAgentTurnLifecycleState();
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'turn-failed',
    turnId: 'turn-1',
    outputText: '',
    reasoningText: '',
    error: {
      code: 'RUNTIME_CALL_FAILED',
      message: 'runtime broke',
    },
    trace: {
      traceId: 'trace-fail',
      promptTraceId: 'prompt-fail',
    },
  });

  const interaction = resolveInterruptedAgentHostInteraction({
    optimisticBundle: baseUserBundle(),
    refreshedBundle: null,
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    partialText: 'partial answer',
    partialReasoningText: 'stream reasoning',
    runtimeError: {
      code: 'RUNTIME_CALL_FAILED',
      message: 'runtime broke',
    },
    traceId: 'trace-fail',
    submittedText: 'retry this',
    updatedAtMs: 140,
    lifecycle,
    streamSnapshot: streamState({
      phase: 'error',
      interrupted: true,
      partialText: 'partial answer',
      partialReasoningText: 'stream reasoning',
      errorMessage: 'runtime broke',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      traceId: 'trace-fail',
    }),
  });

  assert.equal(interaction.bundle.messages.at(-1)?.contentText, 'partial answer');
  assert.equal(interaction.footerState, 'interrupted');
  assert.equal(interaction.footerViewState.displayState, 'interrupted');
});

test('agent host interaction prefers authoritative completion, clears composer text, and hides the footer after first-beat and projection rebuild', () => {
  const firstBeatBundle = overlayAgentAssistantVisibleState({
    bundle: baseUserBundle(),
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    partialText: 'sealed first beat',
    partialReasoningText: '',
    updatedAtMs: 120,
  });

  let lifecycle = createInitialAgentTurnLifecycleState();
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'projection-rebuilt',
    threadId: 'thread-1',
  });
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'turn-completed',
    turnId: 'turn-1',
    outputText: 'authoritative projection',
    reasoningText: 'authoritative reasoning',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
    },
    trace: {
      traceId: 'trace-done',
      promptTraceId: 'prompt-done',
    },
  });

  const interaction = resolveCompletedAgentHostInteraction({
    optimisticBundle: firstBeatBundle,
    refreshedBundle: authoritativeBundle(),
    lifecycle,
    streamSnapshot: streamState({
      phase: 'done',
      partialText: 'authoritative projection',
      partialReasoningText: 'authoritative reasoning',
      traceId: 'trace-done',
    }),
  });

  assert.ok(interaction);
  assert.equal(interaction?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
  assert.deepEqual(interaction?.selection, {
    agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    conversationAnchorId: 'anchor-agent-1',
    targetId: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });
  assert.equal(interaction?.footerState, 'done');
  assert.deepEqual(interaction?.footerViewState, {
    displayState: 'hidden',
    pendingFirstBeat: false,
  });
});

test('agent host interaction applies projection refresh after terminal completion for follow-up commits', () => {
  let lifecycle = createInitialAgentTurnLifecycleState();
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'projection-rebuilt',
    threadId: 'thread-1',
  });
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'turn-completed',
    turnId: 'turn-1',
    outputText: 'final answer',
    reasoningText: '',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
    },
    trace: {
      traceId: 'trace-done',
      promptTraceId: 'prompt-done',
    },
  });

  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'projection-rebuilt',
    threadId: 'thread-1',
  });

  const interaction = resolveProjectionRefreshAgentHostInteraction({
    lifecycle,
    streamSnapshot: streamState({
      phase: 'done',
      partialText: 'final answer',
      traceId: 'trace-done',
    }),
    refreshedBundle: authoritativeBundle(),
    composerText: '',
  });

  assert.ok(interaction);
  assert.equal(interaction?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
});
