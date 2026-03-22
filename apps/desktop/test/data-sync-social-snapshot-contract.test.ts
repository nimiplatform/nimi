import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContactList, loadSocialSnapshot } from '../src/runtime/data-sync/flows/profile-flow.js';

type DataSyncError = {
  action: string;
  error: unknown;
  details?: Record<string, unknown>;
};

function createEmitter(errors: DataSyncError[]) {
  return (action: string, error: unknown, details?: Record<string, unknown>) => {
    errors.push({ action, error, details });
  };
}

test('loadContactList skips creator agents when warming the social graph', async () => {
  const errors: DataSyncError[] = [];
  let creatorAgentsCalls = 0;

  const result = await loadContactList(
    async (task) => task({
      services: {
        MeService: {
          listMyFriendsWithDetails: async () => ({ items: [] }),
          getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
          getMyBlockedUsers: async () => ({ items: [] }),
        },
        CreatorService: {
          creatorControllerListAgents: async () => {
            creatorAgentsCalls += 1;
            return [];
          },
        },
      },
    } as never),
    createEmitter(errors),
  );

  assert.equal(creatorAgentsCalls, 0);
  assert.deepEqual(result.agents, []);
  assert.equal(errors.length, 0);
});

test('loadSocialSnapshot still includes creator agents for contacts surfaces', async () => {
  const errors: DataSyncError[] = [];
  let creatorAgentsCalls = 0;

  const result = await loadSocialSnapshot(
    async (task) => task({
      services: {
        MeService: {
          listMyFriendsWithDetails: async () => ({ items: [] }),
          getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
          getMyBlockedUsers: async () => ({ items: [] }),
        },
        CreatorService: {
          creatorControllerListAgents: async () => {
            creatorAgentsCalls += 1;
            return [{ id: 'agent-1' }];
          },
        },
      },
    } as never),
    createEmitter(errors),
  );

  assert.equal(creatorAgentsCalls, 1);
  assert.equal(result.agents.length, 1);
  assert.equal(errors.length, 0);
});
