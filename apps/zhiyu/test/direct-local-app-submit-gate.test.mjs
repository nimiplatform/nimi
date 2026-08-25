import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isZhiyuDirectLocalAppSubmitEnabled,
  refreshZhiyuDirectLocalAppSubmitGate,
} from '../src/shell/app/direct-local-app-submit-gate.ts';
import { createInitialZhiyuEvidence } from '../src/shell/app/evidence.ts';

function readyEvidence() {
  const initial = createInitialZhiyuEvidence();
  return {
    ...initial,
    conversation: {
      ...initial.conversation,
      ready: true,
      agentHandle: 'lah_v1_agent_opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      threadId: 'runtime-thread:opaque',
    },
    turn: {
      ...initial.turn,
      ready: true,
      reasonCode: 'runtime-turn-ready',
    },
  };
}

test('direct local-app composer gate requires an admitted conversation turn', () => {
  const evidence = readyEvidence();
  assert.equal(isZhiyuDirectLocalAppSubmitEnabled({
    evidence,
    draft: '发送到 direct localApp conversation',
  }), true);
  assert.equal(isZhiyuDirectLocalAppSubmitEnabled({
    evidence: {
      ...evidence,
      turn: {
        ...evidence.turn,
        ready: false,
        reasonCode: 'zhiyu-agents-interact-permission-denied',
      },
    },
    draft: '不得发送',
  }), false);
});

test('a Runtime-terminal failed turn does not close the Conversation composer', () => {
  const evidence = readyEvidence();
  const failed = {
    ...evidence,
    turn: {
      ...evidence.turn,
      ready: false,
      source: 'runtime',
      reasonCode: 'AI_LOCAL_CAPABILITY_MISMATCH',
      requestId: null,
      runtimeTurnId: 'runtime-turn-failed-1',
      messageId: null,
    },
    chat: {
      ...evidence.chat,
      ready: false,
      state: 'failed',
      source: 'runtime',
      reasonCode: 'AI_LOCAL_CAPABILITY_MISMATCH',
      requestId: null,
      runtimeTurnId: 'runtime-turn-failed-1',
    },
  };

  assert.equal(isZhiyuDirectLocalAppSubmitEnabled({
    evidence: failed,
    draft: '下一轮仍可发送',
  }), true);
});

test('a rotated protected session blocks resubmit until the partner is reselected', () => {
  const evidence = readyEvidence();
  assert.equal(isZhiyuDirectLocalAppSubmitEnabled({
    evidence: {
      ...evidence,
      chat: {
        ...evidence.chat,
        state: 'idle',
        ready: false,
        reasonCode: 'local-app-access-denied',
        actionHint: 'reselect_local_partner',
        source: 'runtime',
      },
    },
    draft: 'must wait for fresh partner handle',
  }), false);
});

test('submit preflight refreshes account permission inventory', async () => {
  const evidence = readyEvidence();
  const calls = [];
  const inventory = {
    ...evidence.inventory,
    ready: true,
    count: 1,
    localAgents: [{
      agentHandle: 'lah_v1_agent_opaque',
      displayName: '伙伴',
    }],
  };
  const refreshed = await refreshZhiyuDirectLocalAppSubmitGate({
    conversation: evidence.conversation,
    async loadAgentInventory() {
      calls.push('load-agent-inventory');
      return inventory;
    },
    projectTurnReadiness(conversation, currentInventory) {
      calls.push({
        agentHandle: conversation.agentHandle,
        inventory: currentInventory,
      });
      return evidence.turn;
    },
  });

  assert.deepEqual(calls, [
    'load-agent-inventory',
    {
      agentHandle: 'lah_v1_agent_opaque',
      inventory,
    },
  ]);
  assert.equal(refreshed.inventory, inventory);
  assert.equal(refreshed.turn, evidence.turn);
});
