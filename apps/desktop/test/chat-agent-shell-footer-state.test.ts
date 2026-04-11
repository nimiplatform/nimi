import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialAgentTurnLifecycleState,
  reduceAgentTurnLifecycleState,
} from '../src/shell/renderer/features/chat/chat-agent-shell-lifecycle.js';
import { resolveAgentFooterViewState } from '../src/shell/renderer/features/chat/chat-agent-shell-footer-state.js';
import type { StreamState } from '../src/shell/renderer/features/turns/stream-controller.js';

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

test('agent footer state shows streaming and pending first-beat while waiting without partial content', () => {
  const viewState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'waiting',
    }),
    lifecycle: createInitialAgentTurnLifecycleState(),
    currentHostFooterState: 'hidden',
    isSubmitting: false,
  });

  assert.deepEqual(viewState, {
    displayState: 'streaming',
    pendingFirstBeat: true,
  });
});

test('agent footer state shows streaming but not pending first-beat once partial content exists', () => {
  const viewState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'streaming',
      partialText: 'partial answer',
    }),
    lifecycle: createInitialAgentTurnLifecycleState(),
    currentHostFooterState: 'hidden',
    isSubmitting: false,
  });

  assert.deepEqual(viewState, {
    displayState: 'streaming',
    pendingFirstBeat: false,
  });
});

test('agent footer state shows interrupted for canceled or failed interrupted terminal snapshots', () => {
  let canceledLifecycle = createInitialAgentTurnLifecycleState();
  canceledLifecycle = reduceAgentTurnLifecycleState(canceledLifecycle, {
    type: 'turn-canceled',
    turnId: 'turn-1',
    scope: 'tail',
    outputText: 'sealed first beat',
    reasoningText: '',
    trace: {
      traceId: 'trace-cancel',
      promptTraceId: 'prompt-cancel',
    },
  });

  const canceledState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'cancelled',
      interrupted: true,
      partialText: 'sealed first beat',
      errorMessage: 'Generation stopped.',
      reasonCode: 'OPERATION_ABORTED',
    }),
    lifecycle: canceledLifecycle,
    currentHostFooterState: 'interrupted',
    isSubmitting: false,
  });
  assert.equal(canceledState.displayState, 'interrupted');

  let failedLifecycle = createInitialAgentTurnLifecycleState();
  failedLifecycle = reduceAgentTurnLifecycleState(failedLifecycle, {
    type: 'turn-failed',
    turnId: 'turn-1',
    outputText: 'partial answer',
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

  const failedState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'error',
      interrupted: true,
      partialText: 'partial answer',
      errorMessage: 'runtime broke',
      reasonCode: 'RUNTIME_CALL_FAILED',
    }),
    lifecycle: failedLifecycle,
    currentHostFooterState: 'interrupted',
    isSubmitting: false,
  });
  assert.equal(failedState.displayState, 'interrupted');
});

test('agent footer state hides completed terminals even when done snapshot remains', () => {
  let lifecycle = createInitialAgentTurnLifecycleState();
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

  const viewState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'done',
      partialText: 'final answer',
    }),
    lifecycle,
    currentHostFooterState: 'done',
    isSubmitting: false,
  });

  assert.deepEqual(viewState, {
    displayState: 'hidden',
    pendingFirstBeat: false,
  });
});

test('agent footer state does not regress to interrupted when completed turn leaves behind a stale interrupted snapshot', () => {
  let lifecycle = createInitialAgentTurnLifecycleState();
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

  const viewState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'error',
      interrupted: true,
      partialText: 'stale partial',
      errorMessage: 'stale interrupted state',
    }),
    lifecycle,
    currentHostFooterState: 'done',
    isSubmitting: false,
  });

  assert.deepEqual(viewState, {
    displayState: 'hidden',
    pendingFirstBeat: false,
  });
});

test('agent footer state is unaffected by projection rebuild while terminal has not arrived', () => {
  let lifecycle = createInitialAgentTurnLifecycleState();
  lifecycle = reduceAgentTurnLifecycleState(lifecycle, {
    type: 'projection-rebuilt',
    threadId: 'thread-1',
    projectionVersion: 'truth:10:t1',
  });

  const viewState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'streaming',
      partialText: 'partial answer',
    }),
    lifecycle,
    currentHostFooterState: 'hidden',
    isSubmitting: false,
  });

  assert.deepEqual(viewState, {
    displayState: 'streaming',
    pendingFirstBeat: false,
  });
});

test('agent footer state shows optimistic streaming and pending first-beat while submitting before stream starts', () => {
  const viewState = resolveAgentFooterViewState({
    streamState: streamState({
      phase: 'idle',
    }),
    lifecycle: createInitialAgentTurnLifecycleState(),
    currentHostFooterState: 'hidden',
    isSubmitting: true,
  });

  assert.deepEqual(viewState, {
    displayState: 'streaming',
    pendingFirstBeat: true,
  });
});
