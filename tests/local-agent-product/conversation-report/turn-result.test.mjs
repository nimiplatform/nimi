import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conversationReportExecutionStatus,
  resolveConversationTurnOutcome,
} from './turn-result.mjs';

test('turn outcome preserves a completed assistant response without semantic judgment', () => {
  const outcome = resolveConversationTurnOutcome({
    snapshot: { lastTurn: { turnId: 'turn-1', status: 'completed' } },
    outputText: 'raw model response',
  });
  assert.deepEqual(outcome, {
    status: 'completed',
    outputText: 'raw model response',
    transportFailure: null,
  });
  assert.equal(conversationReportExecutionStatus([{ transportFailure: null }]), 'completed');
});

test('turn outcome records Runtime/UI protocol failure without retry or semantic verdict', () => {
  const outcome = resolveConversationTurnOutcome({
    snapshot: {
      lastTurn: {
        turnId: 'turn-2',
        status: 'failed',
        reasonCode: 'AI_OUTPUT_INVALID',
        message: 'unsupported APML message tag <text>',
      },
    },
    outputText: '',
    runtimeTurnId: 'turn-2',
    pageErrors: ['unsupported APML message tag <text>'],
    consoleErrors: ['action:host-error AI_OUTPUT_INVALID'],
  });
  assert.equal(outcome.status, 'transport_failure');
  assert.equal(outcome.outputText, '');
  assert.deepEqual(outcome.transportFailure, {
    stage: 'runtime_turn',
    reasonCode: 'AI_OUTPUT_INVALID',
    message: 'unsupported APML message tag <text>',
  });
  assert.equal(conversationReportExecutionStatus([{ transportFailure: outcome.transportFailure }]), 'completed_with_transport_failure');
});

test('turn outcome fails closed when neither response nor terminal transport failure exists', () => {
  assert.throws(
    () => resolveConversationTurnOutcome({ snapshot: { lastTurn: { turnId: 'turn-3', status: 'running' } }, outputText: '' }),
    /neither.*assistant response.*transport failure/iu,
  );
});
