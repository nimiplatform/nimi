import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDesktopAvatarPresentationBinding } from '../src/shell/renderer/features/chat/chat-agent-avatar-live-instance-runtime-binding.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

test('Avatar presentation sideband is resolved from the canonical Agent handle', async () => {
  const requests: unknown[] = [];
  const binding = await resolveDesktopAvatarPresentationBinding({
    agentHandle: AGENT_HANDLE,
    sdk: {
      accountProduct: () => ({
        agents: {
          getLocalAppAgentPresentationSnapshot: async (request: unknown) => {
            requests.push(request);
            return {
              projection: undefined,
              privateBinding: {
                localAgentRef: 'local-agent:owner:agent',
                ownerUserId: 'owner',
                runtimeSourceRef: 'source',
              },
            };
          },
        },
      }),
    } as never,
  });
  assert.deepEqual(requests, [{ agentHandle: AGENT_HANDLE }]);
  assert.deepEqual(binding, {
    localAgentRef: 'local-agent:owner:agent',
    ownerUserId: 'owner',
    runtimeSourceRef: 'source',
  });
});

test('Avatar presentation sideband fails closed when Runtime omits its private binding', async () => {
  await assert.rejects(resolveDesktopAvatarPresentationBinding({
    agentHandle: AGENT_HANDLE,
    sdk: {
      accountProduct: () => ({
        agents: {
          getLocalAppAgentPresentationSnapshot: async () => ({ projection: undefined }),
        },
      }),
    } as never,
  }), /protected Avatar presentation binding/);
});
