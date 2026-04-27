import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
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

function createSession() {
  return createInitialAgentSubmitSessionState({
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    submittedText: 'retry this',
    workingBundle: baseUserBundle(),
  });
}

const VISIBLE_BUNDLE_FLUSH_TEXT = ' visible tail keeps bundle flushes on threshold';

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
      type: 'message-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      text: 'sealed first beat',
    },
    updatedAtMs: 130,
  });
  session = firstBeatStep.state;
  assert.equal(firstBeatStep.visibleBundle?.messages.at(-1)?.contentText, 'sealed first beat');
  assert.deepEqual(firstBeatStep.streamEvent, {
    type: 'done',
    finalText: 'sealed first beat',
    finalReasoningText: '',
  });
  assert.equal(session.assistantVisible, true);

  const postFirstBeatText = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'text-delta',
      turnId: 'turn-1',
      textDelta: VISIBLE_BUNDLE_FLUSH_TEXT,
    },
    updatedAtMs: 140,
  });
  assert.equal(
    postFirstBeatText.visibleBundle?.messages.at(-1)?.contentText,
    `sealed first beat${VISIBLE_BUNDLE_FLUSH_TEXT}`,
  );
  assert.equal(postFirstBeatText.visibleBundle?.messages.at(-1)?.reasoningText, 'thinking');
});

test('agent submit session shows a pending image card when an image beat is planned', () => {
  const session = createSession();

  const step = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'beat-planned',
      turnId: 'turn-1',
      beatId: 'turn-1:beat:1',
      beatIndex: 1,
      modality: 'image',
    },
    updatedAtMs: 135,
  });

  const imageMessage = step.visibleBundle?.messages.at(-1);
  assert.equal(imageMessage?.kind, 'image');
  assert.equal(imageMessage?.status, 'pending');
  assert.equal(imageMessage?.contentText, 'Generating image...');
});

test('agent submit session ignores text beat planning because follow-up now uses a separate turn', () => {
  const session = createSession();

  const step = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'beat-planned',
      turnId: 'turn-1',
      beatId: 'turn-1:beat:1',
      beatIndex: 1,
      modality: 'text',
    },
    updatedAtMs: 132,
  });

  const tailMessage = step.state.workingBundle?.messages.find((message) => message.id.endsWith(':message:1'));
  assert.equal(tailMessage, undefined);
});

test('agent submit session keeps the sealed message visible', () => {
  let session = createSession();

  const firstBeatStep = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'message-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      messageId: 'message-1',
      text: 'hello',
    },
    updatedAtMs: 130,
  });
  session = firstBeatStep.state;
  assert.equal(firstBeatStep.visibleBundle?.messages.at(-1)?.contentText, 'hello');
  assert.equal(session.assistantVisible, true);
});

test('agent submit session treats message sealed as visible done without terminal lifecycle completion', () => {
  const session = createSession();

  const sealedStep = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'message-sealed',
      turnId: 'turn-1',
      beatId: 'beat-1',
      messageId: 'message-1',
      text: 'visible answer',
    },
    updatedAtMs: 130,
  });

  assert.deepEqual(sealedStep.streamEvent, {
    type: 'done',
    finalText: 'visible answer',
    finalReasoningText: '',
  });
  assert.equal(sealedStep.state.lifecycle.terminal, 'running');

  const completedStep = reduceAgentSubmitSessionEvent(sealedStep.state, {
    event: {
      type: 'turn-completed',
      turnId: 'turn-1',
      outputText: 'visible answer',
      reasoningText: '',
      usage: {
        inputTokens: 1,
        outputTokens: 2,
      },
      trace: {
        traceId: 'trace-completed',
      },
    },
    updatedAtMs: 160,
  });

  assert.equal(completedStep.state.lifecycle.terminal, 'completed');
  assert.deepEqual(completedStep.streamEvent, {
    type: 'done',
    usage: {
      inputTokens: 1,
      outputTokens: 2,
    },
    finalText: 'visible answer',
    finalReasoningText: undefined,
  });
});

test('agent submit session keeps authoritative projection when stale text delta arrives after projection rebuild', () => {
  let session = createSession();
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'message-sealed',
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
      textDelta: VISIBLE_BUNDLE_FLUSH_TEXT,
    },
    updatedAtMs: 150,
  });
  assert.equal(staleDelta.visibleBundle?.messages.at(-1)?.contentText, 'authoritative projection');
  assert.equal(staleDelta.visibleBundle?.messages.at(-1)?.reasoningText, 'authoritative reasoning');
});

test('agent submit session applies projection refresh after completed terminal for follow-up commits', () => {
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

  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'projection-rebuilt',
      threadId: 'thread-1',
      projectionVersion: 'truth:11:t2',
    },
    updatedAtMs: 160,
  }).state;

  const followUpRefresh = resolveProjectionRefreshAgentSubmitSession({
    state: session,
    requestedProjectionVersion: 'truth:11:t2',
    refreshedBundle: authoritativeBundle(),
    draftText: '',
    streamSnapshot: streamState({
      phase: 'done',
      partialText: 'authoritative projection',
      traceId: 'trace-done',
    }),
  });
  assert.ok(followUpRefresh.hostInteractionPatch);
  assert.equal(followUpRefresh.hostInteractionPatch?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
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
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    traceId: undefined,
  });
  assert.equal(interrupted.hostInteractionPatch.footerViewState.displayState, 'interrupted');
  assert.deepEqual(interrupted.hostInteractionPatch.bundle.draft, sampleDraft());
});

test('agent submit session preserves visible first-beat when the turn is canceled after seal', () => {
  let session = createSession();
  session = reduceAgentSubmitSessionEvent(session, {
    event: {
      type: 'message-sealed',
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
      reasonCode: ReasonCode.OPERATION_ABORTED,
      traceId: 'trace-tail',
      cancelSource: 'user',
    }),
  });

  assert.equal(interrupted.hostInteractionPatch.bundle.messages.at(-1)?.contentText, 'sealed first beat');
  assert.equal(interrupted.hostInteractionPatch.footerViewState.displayState, 'interrupted');
  assert.equal(interrupted.errorStreamEvent, undefined);
});
