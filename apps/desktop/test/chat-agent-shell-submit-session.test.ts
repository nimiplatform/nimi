import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentLocalDraftRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  createInitialAgentSubmitSessionState,
  reduceAgentSubmitSessionEvent,
  resolveCompletedAgentSubmitSession,
  resolveInterruptedAgentSubmitSession,
  resolveProjectionRefreshAgentSubmitSession,
} from '../src/shell/renderer/features/chat/chat-agent-shell-submit-session.js';
import type { StreamState } from '../src/shell/renderer/features/turns/stream-controller.js';

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    agentId: 'agent-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    archivedAtMs: null,
    targetSnapshot: {
      agentId: 'agent-1',
      displayName: 'Companion',
      handle: '~companion',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
    },
  };
}

function sampleDraft(): AgentLocalDraftRecord {
  return {
    threadId: 'thread-1',
    text: 'retry this',
    updatedAtMs: 300,
  };
}

function baseUserBundle(): AgentLocalThreadBundle {
  return {
    thread: sampleThread(),
    messages: [{
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: null,
      createdAtMs: 100,
      updatedAtMs: 100,
    }],
    draft: null,
  };
}

function assistantPlaceholder() {
  return {
    id: 'assistant-1',
    threadId: 'thread-1',
    role: 'assistant' as const,
    status: 'pending' as const,
    contentText: '',
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId: 'user-1',
    createdAtMs: 101,
    updatedAtMs: 101,
  };
}

function authoritativeBundle(): AgentLocalThreadBundle {
  return {
    thread: {
      ...sampleThread(),
      updatedAtMs: 999,
      lastMessageAtMs: 999,
    },
    messages: [{
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: null,
      createdAtMs: 100,
      updatedAtMs: 100,
    }, {
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'authoritative projection',
      reasoningText: 'authoritative reasoning',
      error: null,
      traceId: 'trace-authoritative',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 999,
    }],
    draft: null,
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
    startedAt: 0,
    firstPacketAt: null,
    lastActivityAt: null,
    idleDeadlineAt: null,
    reasonCode: null,
    traceId: null,
    cancelSource: null,
    ...overrides,
  };
}

function createSession() {
  return createInitialAgentSubmitSessionState({
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    submittedText: 'retry this',
    workingBundle: baseUserBundle(),
  });
}

test('agent submit session keeps assistant invisible until first-beat and then grows visible content', () => {
  let session = createSession();

  const reasoningStep = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'reasoning-delta',
      turnId: 'turn-1',
      textDelta: 'thinking',
    },
    updatedAtMs: 110,
  });
  session = reasoningStep.state;
  assert.equal(reasoningStep.visibleBundle, undefined);
  assert.deepEqual(reasoningStep.streamEvent, {
    type: 'reasoning_delta',
    textDelta: 'thinking',
  });

  const preFirstBeatText = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'text-delta',
      turnId: 'turn-1',
      textDelta: 'hello',
    },
    updatedAtMs: 120,
  });
  session = preFirstBeatText.state;
  assert.equal(preFirstBeatText.visibleBundle, undefined);

  const firstBeatStep = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'first-beat-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      text: 'sealed first beat',
    },
    updatedAtMs: 130,
  });
  session = firstBeatStep.state;
  assert.equal(firstBeatStep.visibleBundle?.messages.at(-1)?.contentText, 'sealed first beat');
  assert.equal(session.assistantVisible, true);

  const postFirstBeatText = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'text-delta',
      turnId: 'turn-1',
      textDelta: ' tail',
    },
    updatedAtMs: 140,
  });
  assert.equal(postFirstBeatText.visibleBundle?.messages.at(-1)?.contentText, 'sealed first beat tail');
  assert.equal(postFirstBeatText.visibleBundle?.messages.at(-1)?.reasoningText, 'thinking');
});

test('agent submit session keeps authoritative projection when stale text delta arrives after projection rebuild', () => {
  let session = createSession();
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'first-beat-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      text: 'sealed first beat',
    },
    updatedAtMs: 130,
  }).state;
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'projection-rebuilt',
      threadId: 'thread-1',
      projectionVersion: 'truth:10:t1',
    },
    updatedAtMs: 140,
  }).state;

  const refresh = resolveProjectionRefreshAgentSubmitSession({
    state: session,
    requestedProjectionVersion: 'truth:10:t1',
    refreshedBundle: authoritativeBundle(),
    draftText: '',
    streamSnapshot: streamState({
      phase: 'streaming',
      partialText: 'sealed first beat',
    }),
  });
  session = refresh.state;
  assert.ok(refresh.hostInteractionPatch);
  assert.equal(refresh.hostInteractionPatch?.bundle.messages.at(-1)?.contentText, 'authoritative projection');

  const staleDelta = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'text-delta',
      turnId: 'turn-1',
      textDelta: ' stale tail',
    },
    updatedAtMs: 150,
  });
  assert.equal(staleDelta.visibleBundle?.messages.at(-1)?.contentText, 'authoritative projection');
  assert.equal(staleDelta.visibleBundle?.messages.at(-1)?.reasoningText, 'authoritative reasoning');
});

test('agent submit session ignores stale projection refresh after completed terminal', () => {
  let session = createSession();
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'projection-rebuilt',
      threadId: 'thread-1',
      projectionVersion: 'truth:10:t1',
    },
    updatedAtMs: 140,
  }).state;
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
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
    },
    updatedAtMs: 150,
  }).state;

  const completed = resolveCompletedAgentSubmitSession({
    state: session,
    refreshedBundle: authoritativeBundle(),
    streamSnapshot: streamState({
      phase: 'done',
      partialText: 'authoritative projection',
      partialReasoningText: 'authoritative reasoning',
      traceId: 'trace-done',
    }),
  });
  session = completed.state;
  assert.equal(completed.hostInteractionPatch?.footerViewState.displayState, 'hidden');

  const staleRefresh = resolveProjectionRefreshAgentSubmitSession({
    state: session,
    requestedProjectionVersion: 'truth:10:t1',
    refreshedBundle: authoritativeBundle(),
    draftText: '',
    streamSnapshot: streamState({
      phase: 'done',
      partialText: 'authoritative projection',
      traceId: 'trace-done',
    }),
  });
  assert.equal(staleRefresh.hostInteractionPatch, null);
});

test('agent submit session emits an error stream event only while waiting or streaming', () => {
  const interrupted = resolveInterruptedAgentSubmitSession({
    state: createSession(),
    refreshedBundle: null,
    runtimeError: {
      code: 'RUNTIME_CALL_FAILED',
      message: 'runtime broke',
    },
    draft: sampleDraft(),
    updatedAtMs: 160,
    streamSnapshot: streamState({
      phase: 'waiting',
    }),
  });

  assert.deepEqual(interrupted.errorStreamEvent, {
    type: 'error',
    message: 'runtime broke',
    reasonCode: 'RUNTIME_CALL_FAILED',
    traceId: undefined,
  });
  assert.equal(interrupted.hostInteractionPatch.footerViewState.displayState, 'interrupted');
  assert.deepEqual(interrupted.hostInteractionPatch.bundle.draft, sampleDraft());
});

test('agent submit session preserves visible first-beat when the turn is canceled after seal', () => {
  let session = createSession();
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'first-beat-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      text: 'sealed first beat',
    },
    updatedAtMs: 130,
  }).state;
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'turn-canceled',
      turnId: 'turn-1',
      scope: 'tail',
      outputText: 'sealed first beat',
      reasoningText: '',
      trace: {
        traceId: 'trace-tail',
        promptTraceId: 'prompt-tail',
      },
    },
    updatedAtMs: 150,
  }).state;

  const interrupted = resolveInterruptedAgentSubmitSession({
    state: session,
    refreshedBundle: null,
    runtimeError: {
      code: 'OPERATION_ABORTED',
      message: 'Generation stopped.',
    },
    draft: sampleDraft(),
    updatedAtMs: 160,
    streamSnapshot: streamState({
      phase: 'cancelled',
      interrupted: true,
      partialText: 'sealed first beat',
      errorMessage: 'Generation stopped.',
      reasonCode: 'OPERATION_ABORTED',
      traceId: 'trace-tail',
      cancelSource: 'user',
    }),
  });

  assert.equal(interrupted.hostInteractionPatch.bundle.messages.at(-1)?.contentText, 'sealed first beat');
  assert.equal(interrupted.hostInteractionPatch.footerViewState.displayState, 'interrupted');
  assert.equal(interrupted.errorStreamEvent, undefined);
});
