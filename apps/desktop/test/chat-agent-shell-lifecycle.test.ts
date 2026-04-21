import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationTurnEvent } from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  assertAgentTurnLifecycleCompleted,
  createInitialAgentTurnLifecycleState,
  reduceAgentTurnLifecycleState,
} from '../src/shell/renderer/features/chat/chat-agent-shell-lifecycle.js';

function applyEvents(events: readonly ConversationTurnEvent[]) {
  return events.reduce(
    (state, event) => reduceAgentTurnLifecycleState(state, event),
    createInitialAgentTurnLifecycleState(),
  );
}

test('agent shell lifecycle keeps projection rebuild and completed terminal state authoritative', () => {
  const state = applyEvents([
    {
      type: 'projection-rebuilt',
      threadId: 'thread-1',
      projectionVersion: 'truth:10:t1',
    },
    {
      type: 'turn-completed',
      turnId: 'turn-1',
      outputText: 'final answer',
      reasoningText: 'hidden',
      usage: {
        inputTokens: 11,
        outputTokens: 22,
      },
      trace: {
        traceId: 'trace-1',
        promptTraceId: 'prompt-1',
      },
      diagnostics: {
        transport: 'runtime.agent',
        sessionId: 'session-1',
        runtimeTurnId: 'runtime-turn-1',
        route: 'local',
        modelId: 'kimi-k2',
        connectorId: null,
      },
    },
  ]);

  const completed = assertAgentTurnLifecycleCompleted(state);
  assert.equal(completed.projectionVersion, 'truth:10:t1');
  assert.equal(completed.outputText, 'final answer');
  assert.equal(completed.reasoningText, 'hidden');
  assert.equal(completed.traceId, 'trace-1');
  assert.equal(completed.promptTraceId, 'prompt-1');
  assert.deepEqual(completed.runtimeAgentChat, {
    transport: 'runtime.agent',
    sessionId: 'session-1',
    runtimeTurnId: 'runtime-turn-1',
    route: 'local',
    modelId: 'kimi-k2',
    connectorId: null,
  });
  assert.deepEqual(completed.usage, {
    inputTokens: 11,
    outputTokens: 22,
  });
});

test('agent shell lifecycle captures failed terminals without pseudo-success', () => {
  const state = applyEvents([{
    type: 'turn-failed',
    turnId: 'turn-1',
    outputText: 'partial',
    reasoningText: 'hidden fail',
    error: {
      code: 'RUNTIME_CALL_FAILED',
      message: 'runtime failed',
    },
    trace: {
      traceId: 'trace-fail',
      promptTraceId: 'prompt-fail',
    },
  }]);

  assert.equal(state.terminal, 'failed');
  assert.deepEqual(state.error, {
    code: 'RUNTIME_CALL_FAILED',
    message: 'runtime failed',
  });
  assert.equal(state.outputText, 'partial');
  assert.equal(state.traceId, 'trace-fail');
  assert.throws(() => assertAgentTurnLifecycleCompleted(state), /terminal success event/);
});

test('agent shell lifecycle captures canceled terminals and stays fail-close on missing success', () => {
  const state = applyEvents([{
    type: 'turn-canceled',
    turnId: 'turn-1',
    scope: 'tail',
    outputText: 'sealed first beat',
    reasoningText: 'hidden cancel',
    trace: {
      traceId: 'trace-cancel',
      promptTraceId: 'prompt-cancel',
    },
  }]);

  assert.equal(state.terminal, 'canceled');
  assert.equal(state.outputText, 'sealed first beat');
  assert.equal(state.traceId, 'trace-cancel');
  assert.throws(() => assertAgentTurnLifecycleCompleted(state), /terminal success event/);
});

test('agent shell lifecycle preserves runtime.agent session evidence on failed and canceled terminals', () => {
  const failedState = applyEvents([{
    type: 'turn-failed',
    turnId: 'turn-failed',
    error: {
      code: 'RUNTIME_AGENT_CHAT_FAILED',
      message: 'runtime failed',
    },
    trace: {
      traceId: 'trace-runtime-fail',
      promptTraceId: 'prompt-runtime-fail',
    },
    diagnostics: {
      transport: 'runtime.agent',
      sessionId: 'session-runtime-fail',
      runtimeTurnId: 'runtime-turn-fail',
      route: 'cloud',
      modelId: 'gpt-5.4-mini',
      connectorId: 'connector-openai',
    },
  }]);
  const canceledState = applyEvents([{
    type: 'turn-canceled',
    turnId: 'turn-canceled',
    scope: 'turn',
    trace: {
      traceId: 'trace-runtime-cancel',
      promptTraceId: 'prompt-runtime-cancel',
    },
    diagnostics: {
      transport: 'runtime.agent',
      sessionId: 'session-runtime-cancel',
      runtimeTurnId: 'runtime-turn-cancel',
      route: 'local',
      modelId: 'kimi-k2',
      connectorId: null,
    },
  }]);

  assert.deepEqual(failedState.runtimeAgentChat, {
    transport: 'runtime.agent',
    sessionId: 'session-runtime-fail',
    runtimeTurnId: 'runtime-turn-fail',
    route: 'cloud',
    modelId: 'gpt-5.4-mini',
    connectorId: 'connector-openai',
  });
  assert.deepEqual(canceledState.runtimeAgentChat, {
    transport: 'runtime.agent',
    sessionId: 'session-runtime-cancel',
    runtimeTurnId: 'runtime-turn-cancel',
    route: 'local',
    modelId: 'kimi-k2',
    connectorId: null,
  });
});

test('agent shell lifecycle fails close when provider exits without terminal success event', () => {
  const state = applyEvents([{
    type: 'projection-rebuilt',
    threadId: 'thread-1',
    projectionVersion: 'truth:20:t1',
  }]);

  assert.equal(state.terminal, 'running');
  assert.throws(() => assertAgentTurnLifecycleCompleted(state), /terminal success event/);
});
