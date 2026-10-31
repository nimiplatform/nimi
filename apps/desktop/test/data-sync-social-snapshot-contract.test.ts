import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';

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

function signedInStore() {
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().setAuthSession({ id: 'alice', realmEnvironmentId: 'realm' });
  return store;
}

test('loadContactList skips creator agents when warming the social graph', async () => {
  const errors: RealmDataError[] = [];
  let creatorAgentsCalls = 0;
  const directions: string[] = [];

  const result = await loadContactList(
    async (task) => task({
      generated: {
        listMyFriendsWithDetails: async () => ({ items: [], nextCursor: null, total: 0 }),
        getMyPendingFriendRequests: async (request: { query: { direction: string } }) => {
          directions.push(request.query.direction);
          return { items: [], nextCursor: null, total: 0 };
        },
        getMyBlockedUsers: async () => ({ items: [], nextCursor: null, total: 0 }),
        getUser: async () => ({ id: 'unused', handle: 'unused', displayName: 'Unused', createdAt: 'now' }),
        creatorControllerListAgents: async () => {
          creatorAgentsCalls += 1;
          return [];
        },
      },
    } as never),
    createEmitter(errors),
    createSocialSnapshotStore(signedInStore()),
  );

  assert.equal(creatorAgentsCalls, 0);
  assert.equal('agents' in result, false);
  assert.equal(errors.length, 0);
  assert.deepEqual(directions.sort(), ['received', 'sent']);
});

test('loadSocialSnapshot does not list creator agents through the contacts social flow', async () => {
  const errors: RealmDataError[] = [];
  let creatorAgentsCalls = 0;

  const result = await loadSocialSnapshot(
    async (task) => task({
      generated: {
        listMyFriendsWithDetails: async () => ({ items: [], nextCursor: null, total: 0 }),
        getMyPendingFriendRequests: async () => ({ items: [], nextCursor: null, total: 0 }),
        getMyBlockedUsers: async () => ({ items: [], nextCursor: null, total: 0 }),
        getUser: async () => ({ id: 'unused', handle: 'unused', displayName: 'Unused', createdAt: 'now' }),
        creatorControllerListAgents: async () => {
          creatorAgentsCalls += 1;
          return [{ id: 'agent-1' }];
        },
      },
    } as never),
    createEmitter(errors),
    createSocialSnapshotStore(signedInStore()),
  );

  assert.equal(creatorAgentsCalls, 0);
  assert.equal('agents' in result, false);
  assert.equal(errors.length, 0);
});

test('social snapshot stores isolate cached and in-flight state per renderer instance', async () => {
  const first = createSocialSnapshotStore(signedInStore());
  const second = createSocialSnapshotStore(signedInStore());
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
        getMyPendingFriendRequests: async () => ({ items: [], nextCursor: null, total: 0 }),
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

test('a new login starts its own read and ignores a retired contact snapshot', async () => {
  const account = signedInStore();
  const snapshots = createSocialSnapshotStore(account);
  const empty = { friends: [], pendingReceived: [], pendingSent: [], blocked: [] };
  snapshots.update({ ...empty, friends: [{ id: 'only-alice' }] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reads: string[] = [];
  const contactsApi = (id: string) => ({
    generated: {
      listMyFriendsWithDetails: async () => {
        reads.push(id);
        return { items: [{ id, relationshipId: 'relationship', isDeleted: false, handle: id, displayName: id, createdAt: 'now' }], total: 1, nextCursor: null };
      },
      getMyPendingFriendRequests: async () => ({ items: [], nextCursor: null, total: 0 }),
      getMyBlockedUsers: async () => ({ items: [], nextCursor: null, total: 0 }),
    },
  });
  const retired = snapshots.load(async task => {
    const result = await task(contactsApi('only-alice') as never);
    await gate;
    return result;
  }, () => {});
  account.getState().setAuthSession({ id: 'bob', realmEnvironmentId: 'realm' });
  assert.deepEqual(snapshots.get().friends, []);
  const current = snapshots.load(task => task(contactsApi('only-bob') as never), () => {});
  release();
  const [fresh] = await Promise.all([current, assert.rejects(retired, { name: 'AbortError' })]);
  assert.deepEqual(reads, ['only-alice', 'only-bob']);
  assert.deepEqual(fresh.friends.map(friend => friend.id), ['only-bob']);
  assert.deepEqual(snapshots.get(), fresh);
  account.getState().clearAuthSession();
  account.getState().setAuthSession({ id: 'bob', realmEnvironmentId: 'realm' });
  assert.deepEqual(snapshots.get().friends, []);
  snapshots.reset();
});
