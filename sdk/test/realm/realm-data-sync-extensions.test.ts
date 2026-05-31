import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadRealmSocialSnapshot,
  loadRealmWorldDetailById,
  loadRealmWorldSemanticBundle,
} from '../../src/realm/index.js';

test('Realm social snapshot extension composes public Realm services without local fallback contacts', async () => {
  const errors: Array<{ action: string; error: unknown }> = [];
  const calls: string[] = [];

  const snapshot = await loadRealmSocialSnapshot(
    async (task) => task({
      services: {
        MeService: {
          listMyFriendsWithDetails: async () => {
            calls.push('friends');
            return { items: [{ id: 'friend-1', displayName: 'Friend' }] };
          },
          getMyPendingFriendRequests: async () => {
            calls.push('pending');
            return { received: [{ userId: 'requester-1' }], sent: [] };
          },
          getMyBlockedUsers: async () => {
            calls.push('blocked');
            return { items: [{ id: 'blocked-1', handle: 'blocked' }] };
          },
        },
        UserService: {
          getUser: async (userId: string) => {
            calls.push(`user:${userId}`);
            return { id: userId, displayName: 'Requester', isAgent: false };
          },
        },
      },
    } as never),
    (action, error) => {
      errors.push({ action, error });
    },
  );

  assert.deepEqual(calls, ['friends', 'pending', 'blocked', 'user:requester-1']);
  assert.deepEqual(snapshot.friends.map((friend) => friend.id), ['friend-1']);
  assert.deepEqual(snapshot.pendingReceived.map((request) => request.userId), ['requester-1']);
  assert.deepEqual(snapshot.blocked.map((user) => user.id), ['blocked-1']);
  assert.equal(errors.length, 0);
});

test('Realm world extension fail-closes world id mismatches', async () => {
  const errors: Array<{ action: string; details?: Record<string, unknown> }> = [];

  await assert.rejects(
    () => loadRealmWorldDetailById(
      async () => ({ id: 'world-2' }) as never,
      (action, _error, details) => {
        errors.push({ action, details });
      },
      'world-1',
    ),
    /WORLD_DETAIL_WORLD_ID_MISMATCH/,
  );

  assert.deepEqual(errors, [{ action: 'load-world-detail', details: { worldId: 'world-1' } }]);
});

test('Realm world semantic bundle extension only loads worldview projection', async () => {
  const calls: string[] = [];

  const bundle = await loadRealmWorldSemanticBundle(
    async (task) => task({
      services: {
        WorldsService: {
          worldControllerGetWorldview: async (worldId: string) => {
            calls.push(`worldview:${worldId}`);
            return { id: 'view-1', coreSystem: null };
          },
          worldControllerGetWorld: async () => {
            calls.push('world-detail');
            return { id: 'world-1' };
          },
        },
      },
    } as never),
    () => undefined,
    'world-1',
  );

  assert.deepEqual(calls, ['worldview:world-1']);
  assert.equal(bundle.world, null);
  assert.equal(bundle.worldview?.id, 'view-1');
});
