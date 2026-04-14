import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  AgentLocalDraftRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  createInitialAgentSubmitDriverState,
  reduceAgentSubmitDriverEvent,
  resolveAgentSubmitDriverProjectionRefresh,
  resolveCompletedAgentSubmitDriverCheckpoint,
  resolveInterruptedAgentSubmitDriverCheckpoint,
} from '../src/shell/renderer/features/chat/chat-agent-shell-submit-driver.js';
import type { StreamState } from '../src/shell/renderer/features/turns/stream-controller.js';
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

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
    messages: [createAgentTextMessage({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    })],
    draft: null,
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

function createDriverState() {
  return createInitialAgentSubmitDriverState({
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    submittedText: 'retry this',
    workingBundle: baseUserBundle(),
  });
}

const VISIBLE_BUNDLE_FLUSH_TEXT = ' visible tail keeps bundle flushes on threshold';

function effectKinds(input: {
  streamEffects: unknown[];
  bundleEffects: unknown[];
  hostPatchEffect: unknown | null;
}): string[] {
  return [
    ...input.streamEffects.map(() => 'stream'),
    ...input.bundleEffects.map(() => 'bundle'),
    ...(input.hostPatchEffect ? ['host'] : []),
  ];
}

test('agent submit driver emits stream effects before bundle effects across reasoning, text, first-beat, and text growth', () => {
  let state = createDriverState();

  const reasoning = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'reasoning-delta',
      turnId: 'turn-1',
      textDelta: 'thinking',
    },
    updatedAtMs: 110,
  });
  state = reasoning.finalSession;
  assert.deepEqual(effectKinds(reasoning), ['stream']);

  const preFirstBeatText = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'text-delta',
      turnId: 'turn-1',
      textDelta: 'hello',
    },
    updatedAtMs: 120,
  });
  state = preFirstBeatText.finalSession;
  assert.deepEqual(effectKinds(preFirstBeatText), ['stream']);

  const firstBeat = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'message-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      text: 'sealed first beat',
    },
    updatedAtMs: 130,
  });
  state = firstBeat.finalSession;
  assert.deepEqual(effectKinds(firstBeat), ['bundle']);

  const postFirstBeatText = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'text-delta',
      turnId: 'turn-1',
      textDelta: VISIBLE_BUNDLE_FLUSH_TEXT,
    },
    updatedAtMs: 140,
  });
  assert.deepEqual(effectKinds(postFirstBeatText), ['stream', 'bundle']);
  assert.equal(
    postFirstBeatText.bundleEffects[0]?.messages.at(-1)?.contentText,
    `sealed first beat${VISIBLE_BUNDLE_FLUSH_TEXT}`,
  );
});

test('agent submit driver accepts projection refresh in running state and keeps authoritative content against stale text deltas', () => {
  let state = createDriverState();
  state = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'message-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      text: 'sealed first beat',
    },
    updatedAtMs: 130,
  }).finalSession;

  const projection = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'projection-rebuilt',
      threadId: 'thread-1',
      projectionVersion: 'truth:10:t1',
    },
    updatedAtMs: 140,
  });
  state = projection.finalSession;
  assert.deepEqual(effectKinds(projection), []);
  assert.deepEqual(projection.awaitRefresh, { requestedProjectionVersion: 'truth:10:t1' });

  const refresh = resolveAgentSubmitDriverProjectionRefresh({
    state,
    requestedProjectionVersion: 'truth:10:t1',
    refreshedBundle: authoritativeBundle(),
    draftText: '',
    streamSnapshot: streamState({
      phase: 'streaming',
      partialText: 'sealed first beat',
    }),
  });
  state = refresh.finalSession;
  assert.deepEqual(effectKinds(refresh), ['host']);
  assert.equal(refresh.hostPatchEffect?.bundle.messages.at(-1)?.contentText, 'authoritative projection');

  const staleDelta = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'text-delta',
      turnId: 'turn-1',
      textDelta: VISIBLE_BUNDLE_FLUSH_TEXT,
    },
    updatedAtMs: 150,
  });
  assert.equal(staleDelta.bundleEffects[0]?.messages.at(-1)?.contentText, 'authoritative projection');
});

test('agent submit driver applies projection refresh after completed terminal for follow-up commits', () => {
  let state = createDriverState();
  state = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'projection-rebuilt',
      threadId: 'thread-1',
      projectionVersion: 'truth:10:t1',
    },
    updatedAtMs: 140,
  }).finalSession;

  const completedEvent = reduceAgentSubmitDriverEvent({
    state,
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
  });
  state = completedEvent.finalSession;
  assert.deepEqual(effectKinds(completedEvent), ['stream']);
  assert.equal(completedEvent.streamEffects[0]?.type, 'done');

  const completedCheckpoint = resolveCompletedAgentSubmitDriverCheckpoint({
    state,
    refreshedBundle: authoritativeBundle(),
    streamSnapshot: streamState({
      phase: 'done',
      partialText: 'authoritative projection',
      partialReasoningText: 'authoritative reasoning',
      traceId: 'trace-done',
    }),
  });
  state = completedCheckpoint.finalSession;
  assert.deepEqual(effectKinds(completedCheckpoint), ['host']);
  assert.equal(completedCheckpoint.hostPatchEffect?.footerViewState.displayState, 'hidden');

  const followUpProjection = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'projection-rebuilt',
      threadId: 'thread-1',
      projectionVersion: 'truth:11:t2',
    },
    updatedAtMs: 160,
  });
  state = followUpProjection.finalSession;
  assert.deepEqual(effectKinds(followUpProjection), []);
  assert.deepEqual(followUpProjection.awaitRefresh, { requestedProjectionVersion: 'truth:11:t2' });

  const followUpRefresh = resolveAgentSubmitDriverProjectionRefresh({
    state,
    requestedProjectionVersion: 'truth:11:t2',
    refreshedBundle: authoritativeBundle(),
    draftText: '',
    streamSnapshot: streamState({
      phase: 'done',
      partialText: 'authoritative projection',
      traceId: 'trace-done',
    }),
  });
  assert.deepEqual(effectKinds(followUpRefresh), ['host']);
  assert.equal(followUpRefresh.hostPatchEffect?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
});

test('agent submit driver emits interrupted stream effect before interrupted host patch while waiting', () => {
  const interrupted = resolveInterruptedAgentSubmitDriverCheckpoint({
    state: createDriverState(),
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

  assert.deepEqual(effectKinds(interrupted), ['stream', 'host']);
  assert.equal(interrupted.streamEffects[0]?.type, 'error');
  assert.equal(interrupted.hostPatchEffect?.footerViewState.displayState, 'interrupted');
  assert.deepEqual(interrupted.hostPatchEffect?.bundle.draft, sampleDraft());
});

test('agent submit driver keeps sealed first-beat when canceled turn wins over late refresh', () => {
  let state = createDriverState();
  state = reduceAgentSubmitDriverEvent({
    state,
    event: {
      type: 'message-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      text: 'sealed first beat',
    },
    updatedAtMs: 130,
  }).finalSession;
  state = reduceAgentSubmitDriverEvent({
    state,
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
    updatedAtMs: 140,
  }).finalSession;

  const interrupted = resolveInterruptedAgentSubmitDriverCheckpoint({
    state,
    refreshedBundle: null,
    runtimeError: {
      code: 'OPERATION_ABORTED',
      message: 'Generation stopped.',
    },
    draft: sampleDraft(),
    updatedAtMs: 150,
    streamSnapshot: streamState({
      phase: 'cancelled',
      interrupted: true,
      partialText: 'sealed first beat',
      errorMessage: 'Generation stopped.',
      reasonCode: ReasonCode.OPERATION_ABORTED,
      traceId: 'trace-tail',
      cancelSource: 'user',
    }),
  });
  state = interrupted.finalSession;
  assert.deepEqual(effectKinds(interrupted), ['host']);
  assert.equal(interrupted.hostPatchEffect?.bundle.messages.at(-1)?.contentText, 'sealed first beat');

  const lateRefresh = resolveAgentSubmitDriverProjectionRefresh({
    state,
    requestedProjectionVersion: 'truth:10:t1',
    refreshedBundle: authoritativeBundle(),
    draftText: 'retry this',
    streamSnapshot: streamState({
      phase: 'cancelled',
      interrupted: true,
      partialText: 'sealed first beat',
      errorMessage: 'Generation stopped.',
      reasonCode: ReasonCode.OPERATION_ABORTED,
      traceId: 'trace-tail',
      cancelSource: 'user',
    }),
  });
  assert.deepEqual(effectKinds(lateRefresh), []);
});
