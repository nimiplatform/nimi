import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveZhiyuResourcePackPlacementTarget } from '../src/production/resource-pack-placement-destination.ts';

test('destination revalidates the main-resolved handle and opens its canonical current Conversation', async () => {
  const calls = [];
  const result = await resolveZhiyuResourcePackPlacementTarget({
    agentHandle: 'agent_ref_current_b',
    client: {
      auth: {
        async status() {
          calls.push(['auth']);
          return { sessionBound: true, reasonCode: null, actionHint: null };
        },
      },
      agents: {
        async listReferences() {
          calls.push(['references']);
          return [
            { agentHandle: 'agent_ref_current_a', displayName: 'A', avatarUrl: null },
            { agentHandle: 'agent_ref_current_b', displayName: 'B', avatarUrl: null },
          ];
        },
      },
      conversation: {
        async open(input) {
          calls.push(['open', input]);
          return { conversationAnchorId: 'conversation-anchor-1', activeTurnId: null };
        },
      },
    },
  });
  assert.deepEqual(result, {
    agentHandle: 'agent_ref_current_b',
    conversationAnchorId: 'conversation-anchor-1',
  });
  assert.deepEqual(calls, [
    ['auth'],
    ['references'],
    ['open', { agentHandle: 'agent_ref_current_b' }],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /candidateBytes|sourceApp|ownerUserId|localAgentRef/u);
});

test('destination fails before Agent probes when its protected session is not bound', async () => {
  let listed = false;
  await assert.rejects(() => resolveZhiyuResourcePackPlacementTarget({
    agentHandle: 'agent_ref_current_b',
    client: {
      auth: {
        async status() {
          return { sessionBound: false, reasonCode: 'SESSION_UNAVAILABLE', actionHint: 'retry_session' };
        },
      },
      agents: {
        async listReferences() {
          listed = true;
          return [];
        },
      },
      conversation: { async open() { throw new Error('must not run'); } },
    },
  }), (error) => error.code === 'ZHIYU_RESOURCE_PACK_PLACEMENT_SESSION_UNAVAILABLE');
  assert.equal(listed, false);
});
