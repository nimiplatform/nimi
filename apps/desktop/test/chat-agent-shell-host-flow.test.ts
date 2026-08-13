import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  createInitialAgentTurnLifecycleState,
  reduceAgentTurnLifecycleState,
} from '../src/shell/renderer/features/chat/chat-agent-shell-lifecycle.js';
import {
  overlayAgentAssistantVisibleState,
} from '../src/shell/renderer/features/chat/chat-agent-shell-bundle.js';
import { resolveAgentProjectionRefreshOutcome } from '../src/shell/renderer/features/chat/chat-agent-shell-projection-refresh.js';
import {
  resolveCompletedAgentSubmitHostFlow,
  resolveInterruptedAgentSubmitHostFlow,
} from '../src/shell/renderer/features/chat/chat-agent-shell-host-flow.js';
import type { StreamState } from './helpers/test-stream-controller.js';
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    targetSnapshot: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
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

test('agent host flow preserves authoritative assistant content across first-beat, projection rebuild, stale delta, and cancel', () => {
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

  const refreshOutcome = resolveAgentProjectionRefreshOutcome({
    terminal: 'running',
    refreshedBundle: authoritativeBundle(),
  });
  assert.ok(refreshOutcome);

  const staleDeltaBundle = overlayAgentAssistantVisibleState({
    bundle: refreshOutcome?.bundle,
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    partialText: 'stale tail that should not win',
    partialReasoningText: 'stale reasoning',
    updatedAtMs: 130,
  });

  let lifecycle = createInitialAgentTurnLifecycleState();
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'projection-rebuilt',
    threadId: 'thread-1',
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

  const hostFlow = resolveInterruptedAgentSubmitHostFlow({
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

  assert.equal(hostFlow.footerState, 'interrupted');
  assert.ok(hostFlow.outcome);
  assert.equal(hostFlow.outcome.bundle.messages.at(-1)?.contentText, 'authoritative projection');
  assert.equal(hostFlow.outcome.bundle.messages.at(-1)?.reasoningText, 'authoritative reasoning');
  assert.deepEqual(hostFlow.outcome.selection, {
    localAgentRef: 'local-agent:user-1:agent-1',
    targetId: 'local-agent:user-1:agent-1',
  });
});

test('agent host flow creates interrupted placeholder state when the turn fails before first-beat', () => {
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

  const hostFlow = resolveInterruptedAgentSubmitHostFlow({
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
    updatedAtMs: 200,
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

  assert.equal(hostFlow.footerState, 'interrupted');
  assert.ok(hostFlow.outcome);
  assert.equal(hostFlow.outcome.bundle.messages.at(-1)?.status, 'pending');
  assert.equal(hostFlow.outcome.bundle.messages.at(-1)?.contentText, 'partial answer');
  assert.deepEqual(hostFlow.outcome.bundle.messages.at(-1)?.error, {
    code: 'RUNTIME_CALL_FAILED',
    message: 'runtime broke',
  });
});

test('agent host flow resolves authoritative completion and clears composer text after first-beat and projection rebuild', () => {
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

  const hostFlow = resolveCompletedAgentSubmitHostFlow({
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

  assert.equal(hostFlow.footerState, 'done');
  assert.ok(hostFlow.outcome);
  assert.equal(hostFlow.outcome.bundle.messages.at(-1)?.contentText, 'authoritative projection');
  assert.deepEqual(hostFlow.outcome.selection, {
    localAgentRef: 'local-agent:user-1:agent-1',
    targetId: 'local-agent:user-1:agent-1',
  });
});
