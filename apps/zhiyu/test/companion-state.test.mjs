import assert from 'node:assert/strict';
import test from 'node:test';
import { probeZhiyuRuntimeCompanionState } from '../src/shell/agent/companion-state.ts';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

function conversationReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'conversation-anchor-open',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'Conversation ready.',
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: 'conversation-anchor:1',
    threadId: 'conversation-anchor:1',
  };
}

function embodimentSnapshot(overrides = {}) {
  return {
    sequence: '7',
    observedAt: { seconds: '1782950401', nanos: 0 },
    provenance: 'runtime_agent_owner',
    activity: {
      name: 'chat-active',
      category: 'conversation',
      intensity: 'moderate',
      source: 'runtime',
      turnRef: 'turn:1',
    },
    emotion: { name: 'confused', source: 'runtime' },
    posture: { actionFamily: 'listening', interruptMode: 'interruptible' },
    voiceTiming: null,
    ...overrides,
  };
}

test('projects common activity emotion and posture without relationship or identity sidebands', async () => {
  const calls = [];
  const companion = await probeZhiyuRuntimeCompanionState(conversationReady(), {
    observedAt: '2026-07-02T00:00:00.000Z',
    readEmbodiment: async (input) => {
      calls.push(input);
      return embodimentSnapshot();
    },
  });

  assert.deepEqual(calls, [{
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: 'conversation-anchor:1',
  }]);
  assert.equal(companion.ready, true);
  assert.equal(companion.reasonCode, 'runtime-embodiment-snapshot-projected');
  assert.equal(companion.executionState, 'chat-active');
  assert.equal(companion.activityCategory, 'conversation');
  assert.equal(companion.activityIntensity, 'moderate');
  assert.equal(companion.postureActionFamily, 'listening');
  assert.equal(companion.postureInterruptMode, 'interruptible');
  assert.equal(companion.currentEmotionId, 'confused');
  assert.equal(companion.currentEmotionCue, 'focus');
  assert.deepEqual(companion.projectedFields, ['activity', 'emotion', 'posture']);
  assert.doesNotMatch(JSON.stringify(companion), /ownerUserId|runtimeSourceRef|localAgentRef|activeUserId|activeWorldId/u);
});

test('fails closed before embodiment read without a current Conversation', async () => {
  let called = false;
  const companion = await probeZhiyuRuntimeCompanionState({
    ...conversationReady(),
    ready: false,
    agentHandle: null,
    conversationAnchorId: null,
  }, {
    readEmbodiment: async () => { called = true; },
  });

  assert.equal(called, false);
  assert.equal(companion.ready, false);
  assert.equal(companion.reasonCode, 'zhiyu-conversation-anchor-required');
});

test('fails closed when the common embodiment projection is unavailable', async () => {
  const companion = await probeZhiyuRuntimeCompanionState(conversationReady());
  assert.equal(companion.ready, false);
  assert.equal(companion.reasonCode, 'zhiyu-embodiment-projection-unavailable');
  assert.deepEqual(companion.projectedFields, []);
});

test('unknown emotion remains a bounded violation while other typed facts survive', async () => {
  const companion = await probeZhiyuRuntimeCompanionState(conversationReady(), {
    readEmbodiment: async () => embodimentSnapshot({ emotion: { name: 'focused', source: 'runtime' } }),
  });

  assert.equal(companion.ready, true);
  assert.equal(companion.currentEmotionId, null);
  assert.equal(companion.emotionViolation.rawValue, 'focused');
  assert.equal(companion.executionState, 'chat-active');
});

test('normalizes common embodiment failures without pseudo companion state', async () => {
  const companion = await probeZhiyuRuntimeCompanionState(conversationReady(), {
    readEmbodiment: async () => {
      throw Object.assign(new Error('Embodiment read failed.'), {
        reasonCode: 'LOCAL_APP_EMBODIMENT_UNAVAILABLE',
        actionHint: 'retry_formal_app_embodiment_projection',
        source: 'sdk',
      });
    },
  });

  assert.equal(companion.ready, false);
  assert.equal(companion.reasonCode, 'LOCAL_APP_EMBODIMENT_UNAVAILABLE');
  assert.equal(companion.agentHandle, AGENT_HANDLE);
  assert.equal(companion.currentEmotionId, null);
});
