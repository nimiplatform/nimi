import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContactList, loadSocialSnapshot } from '../src/shell/renderer/features/social/data/profile-data.js';
import { createSocialSnapshotStore } from '../src/shell/renderer/features/social/data/social-snapshot.js';

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
        listMyFriendsWithDetails: async () => ({ items: [], nextCursor: null, total: 0 }),
        getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
        getMyBlockedUsers: async () => ({ items: [], nextCursor: null, total: 0 }),
        getUser: async () => ({ id: 'unused', handle: 'unused', displayName: 'Unused', createdAt: 'now' }),
        creatorControllerListAgents: async () => {
          creatorAgentsCalls += 1;
          return [];
        },
      },
    } as never),
    createEmitter(errors),
    createSocialSnapshotStore(),
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
        listMyFriendsWithDetails: async () => ({ items: [], nextCursor: null, total: 0 }),
        getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
        getMyBlockedUsers: async () => ({ items: [], nextCursor: null, total: 0 }),
        getUser: async () => ({ id: 'unused', handle: 'unused', displayName: 'Unused', createdAt: 'now' }),
        creatorControllerListAgents: async () => {
          creatorAgentsCalls += 1;
          return [{ id: 'agent-1' }];
        },
      },
    } as never),
    createEmitter(errors),
    createSocialSnapshotStore(),
  );

  assert.equal(creatorAgentsCalls, 0);
  assert.equal('agents' in result, false);
  assert.equal(errors.length, 0);
});

test('social snapshot stores isolate cached and in-flight state per renderer instance', async () => {
  const first = createSocialSnapshotStore();
  const second = createSocialSnapshotStore();
  first.update({
    friends: [{ id: 'first-friend' }],
    pendingReceived: [],
    pendingSent: [],
    blocked: [],
  });

  assert.deepEqual(first.get().friends.map((friend) => friend.id), ['first-friend']);
  assert.deepEqual(second.get().friends, []);

  let firstCalls = 0;
  let releaseFirst!: () => void;
  const firstCallApi = async (task: Parameters<Parameters<typeof first.load>[0]>[0]) => {
    firstCalls += 1;
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return task({
      generated: {
        listMyFriendsWithDetails: async () => ({ items: [], nextCursor: null, total: 0 }),
        getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
        getMyBlockedUsers: async () => ({ items: [], nextCursor: null, total: 0 }),
        getUser: async () => ({ id: 'unused', handle: 'unused', displayName: 'Unused', createdAt: 'now' }),
      },
    } as never);
  };
  const pendingA = first.load(firstCallApi as never, () => undefined);
  const pendingB = first.load(firstCallApi as never, () => undefined);
  assert.equal(pendingA, pendingB);
  assert.equal(firstCalls, 1);
  releaseFirst();
  await pendingA;
  assert.deepEqual(second.get().friends, []);
});
