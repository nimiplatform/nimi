import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeAgentSnapshotRecoveryEvents,
  isRuntimeAgentProjectionEvent,
  matchesRuntimeAgentProjectionScope,
  recoverRuntimeAgentTerminalSnapshot,
  summarizeRuntimeAgentProjectionEvent,
  summarizeRuntimeAgentTimeline,
  type RuntimeAgentConsumeEvent,
} from '../../src/runtime/index.js';

function createTurnEvent(): RuntimeAgentConsumeEvent {
  return {
    eventName: 'runtime.agent.turn.text_delta',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    timeline: {
      turnId: 'turn-1',
      streamId: 'stream-1',
      channel: 'text',
      offsetMs: 42,
      sequence: 3,
      startedAtWall: '2026-05-17T04:16:50.000Z',
      observedAtWall: '2026-05-17T04:16:50.042Z',
      timebaseOwner: 'runtime',
      projectionRuleId: 'K-AGCORE-051',
      clockBasis: 'monotonic_with_wall_anchor',
      providerNeutral: true,
      appLocalAuthority: false,
    },
    detail: { text: 'hello' },
  };
}

test('runtime agent consumer helpers summarize runtime timeline metadata without creating truth', () => {
  const summary = summarizeRuntimeAgentTimeline(createTurnEvent());

  assert.deepEqual(summary, {
    turnId: 'turn-1',
    streamId: 'stream-1',
    channel: 'text',
    offsetMs: 42,
    sequence: 3,
    startedAtWall: '2026-05-17T04:16:50.000Z',
    observedAtWall: '2026-05-17T04:16:50.042Z',
    timebaseOwner: 'runtime',
    projectionRuleId: 'K-AGCORE-051',
    clockBasis: 'monotonic_with_wall_anchor',
    providerNeutral: true,
    appLocalAuthority: false,
  });
});

test('runtime agent consumer helpers match projection events by anchor and originating turn', () => {
  const projectionEvent = {
    eventName: 'runtime.agent.hook.pending',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    originatingTurnId: 'turn-1',
    originatingStreamId: 'stream-1',
    detail: { intentId: 'hook-1' },
  } as RuntimeAgentConsumeEvent;

  assert.equal(isRuntimeAgentProjectionEvent(projectionEvent), true);
  assert.equal(matchesRuntimeAgentProjectionScope({
    event: projectionEvent,
    conversationAnchorId: 'anchor-1',
    currentTurnAccepted: true,
    currentRuntimeTurnId: 'turn-1',
  }), true);
  assert.equal(matchesRuntimeAgentProjectionScope({
    event: projectionEvent,
    conversationAnchorId: 'anchor-2',
    currentTurnAccepted: true,
    currentRuntimeTurnId: 'turn-1',
  }), false);
  assert.deepEqual(summarizeRuntimeAgentProjectionEvent(projectionEvent), {
    eventName: 'runtime.agent.hook.pending',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    runtimeTurnId: 'turn-1',
    runtimeStreamId: 'stream-1',
    detail: { intentId: 'hook-1' },
  });
});

test('runtime agent snapshot recovery builds terminal consume events from public snapshot state', () => {
  const events = buildRuntimeAgentSnapshotRecoveryEvents({
    turn: {
      turnId: 'turn-1',
      status: 'completed',
      updatedAt: '2026-05-17T04:16:54.000Z',
      messageId: 'message-1',
      text: 'done',
      structured: {
        message: {
          message_id: 'message-1',
          text: 'done',
        },
      },
      finishReason: 'stop',
    },
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
    requestMessageId: '',
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
  });

  assert.deepEqual(events.map((event) => event.eventName), [
    'runtime.agent.turn.accepted',
    'runtime.agent.turn.structured',
    'runtime.agent.turn.message_committed',
    'runtime.agent.turn.completed',
  ]);
});

test('runtime agent snapshot recovery rejects stale terminal lastTurn from before current request', async () => {
  const enqueued: RuntimeAgentConsumeEvent[] = [];
  const result = await recoverRuntimeAgentTerminalSnapshot({
    reason: 'subscription_terminal_stall',
    request: {
      ownerUserId: 'user-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-1',
      threadId: 'thread-1',
    },
    requestId: 'request-2',
    requestMessageId: '',
    requestStartedAtMs: Date.parse('2026-05-17T04:16:50.000Z'),
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
    async querySnapshot() {
      return {
        lastTurn: {
          turnId: 'turn-old',
          status: 'completed',
          updatedAt: '2026-05-17T04:16:40.000Z',
          messageId: 'message-old',
          text: 'old',
          structured: {
            message: {
              message_id: 'message-old',
              text: 'old',
            },
          },
          finishReason: 'stop',
        },
      };
    },
    enqueue(event) {
      enqueued.push(event);
    },
    logEvent() {},
  });

  assert.equal(result, 'none');
  assert.equal(enqueued.length, 0);
});
