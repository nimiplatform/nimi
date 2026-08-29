import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveZhiyuResourcePackPlacementAgentHandle } from '../src-electron/resource-pack-placement-agent-resolution.ts';

test('Zhiyu main resolves exactly one destination-session handle from the redeemed anchor', async () => {
  const calls = [];
  const result = await resolveZhiyuResourcePackPlacementAgentHandle({
    async agentReferenceList() {
      return [{ agentHandle: 'agent_ref_a' }, { agentHandle: 'agent_ref_b' }];
    },
    async conversationSnapshot(input) {
      calls.push(input);
      if (input.agentHandle === 'agent_ref_a') {
        throw Object.assign(new Error('selector mismatch'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' });
      }
      return { conversationAnchorId: input.conversationAnchorId };
    },
  }, 'conversation-anchor-1');
  assert.deepEqual(result, { status: 'ready', agentHandle: 'agent_ref_b' });
  assert.deepEqual(calls, [
    { agentHandle: 'agent_ref_a', conversationAnchorId: 'conversation-anchor-1' },
    { agentHandle: 'agent_ref_b', conversationAnchorId: 'conversation-anchor-1' },
  ]);
});

test('Zhiyu main distinguishes ambiguous ownership from destination session failure', async () => {
  assert.deepEqual(await resolveZhiyuResourcePackPlacementAgentHandle({
    async agentReferenceList() {
      return [{ agentHandle: 'agent_ref_a' }, { agentHandle: 'agent_ref_b' }];
    },
    async conversationSnapshot(input) {
      return { conversationAnchorId: input.conversationAnchorId };
    },
  }, 'conversation-anchor-1'), { status: 'failed', reasonCode: 'agent-resolution-failed' });

  const failure = Object.assign(new Error('Runtime unavailable'), { reasonCode: 'RUNTIME_UNAVAILABLE' });
  assert.deepEqual(await resolveZhiyuResourcePackPlacementAgentHandle({
    async agentReferenceList() {
      return [{ agentHandle: 'agent_ref_a' }];
    },
    async conversationSnapshot() {
      throw failure;
    },
  }, 'conversation-anchor-1'), { status: 'failed', reasonCode: 'destination-session-failed' });
});
