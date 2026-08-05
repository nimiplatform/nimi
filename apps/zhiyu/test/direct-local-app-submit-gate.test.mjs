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
      sourceReady: true,
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
