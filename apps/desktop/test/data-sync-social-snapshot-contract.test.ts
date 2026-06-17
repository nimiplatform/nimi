import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContactList, loadSocialSnapshot } from '../src/shell/renderer/features/social/data/profile-data.js';

type RealmDataError = {
  action: string;
  error: unknown;
  details?: Record<string, unknown>;
};

function createEmitter(errors: RealmDataError[]) {
  return (action: string, error: unknown, details?: Record<string, unknown>) => {
    errors.push({ action, error, details });
  };
}

test('loadContactList skips creator agents when warming the social graph', async () => {
  const errors: RealmDataError[] = [];
  let creatorAgentsCalls = 0;

  const result = await loadContactList(
    async (task) => task({
      generated: {
        listMyFriendsWithDetails: async () => ({ items: [] }),
        getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
        getMyBlockedUsers: async () => ({ items: [] }),
        getUser: async () => ({ id: 'unused' }),
        creatorControllerListAgents: async () => {
          creatorAgentsCalls += 1;
          return [];
        },
      },
    } as never),
    createEmitter(errors),
  );

  assert.equal(creatorAgentsCalls, 0);
  assert.equal('agents' in result, false);
  assert.equal(errors.length, 0);
});

test('loadSocialSnapshot does not list creator agents through the contacts social flow', async () => {
  const errors: RealmDataError[] = [];
  let creatorAgentsCalls = 0;

  const result = await loadSocialSnapshot(
    async (task) => task({
      generated: {
        listMyFriendsWithDetails: async () => ({ items: [] }),
        getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
        getMyBlockedUsers: async () => ({ items: [] }),
        getUser: async () => ({ id: 'unused' }),
        creatorControllerListAgents: async () => {
          creatorAgentsCalls += 1;
          return [{ id: 'agent-1' }];
        },
      },
    } as never),
    createEmitter(errors),
  );

  assert.equal(creatorAgentsCalls, 0);
  assert.equal('agents' in result, false);
  assert.equal(errors.length, 0);
});
