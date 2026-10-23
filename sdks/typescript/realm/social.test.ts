import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../types';

import {
  addNimiRealmFriendById,
  blockNimiRealmUser,
  createNimiRealmReport,
  loadNimiRealmCurrentUserProfile,
  loadNimiRealmSocialSnapshot,
  loadNimiRealmUserProfileById,
  resolveNimiRealmBaseUrl,
  removeNimiRealmFriendById,
  resolveNimiRealmMediaUrl,
  unblockNimiRealmUser,
  updateNimiRealmCurrentUserProfile,
} from './index';

function createSocialRealmStub() {
  const calls: string[] = [];
  return {
    calls,
    realm: {
      account: {
        async getMe() {
          calls.push('getMe');
          return { id: 'me', handle: 'me', displayName: 'Me', createdAt: 'now', role: 'USER' };
        },
        async updateMe(request: { body: Record<string, unknown> }) {
          calls.push(`updateMe:${request.body.displayName ?? ''}`);
          return {
            id: 'me',
            handle: 'me',
            displayName: request.body.displayName ?? 'Me',
            createdAt: 'now',
            role: 'USER',
          };
        },
      },
      social: {
        async addFriend(request: { path: { id: string } }) {
          calls.push(`add:${request.path.id}`);
          return {};
        },
        async removeFriend(request: { path: { id: string } }) {
          calls.push(`remove:${request.path.id}`);
          return {};
        },
        async blockUser(request: { path: { id: string }; body: { reason?: string } }) {
          calls.push(`block:${request.path.id}:${request.body.reason ?? ''}`);
          return {};
        },
        async unblockUser(request: { path: { id: string } }) {
          calls.push(`unblock:${request.path.id}`);
          return {};
        },
      },
      generated: {
        async listMyFriendsWithDetails() {
          return {
            items: [{ id: 'friend-1', handle: 'friend', displayName: 'Friend', createdAt: 'now' }],
            nextCursor: null,
            total: 1,
          };
        },
        async getMyPendingFriendRequests() {
          return {
            received: [
              {
                userId: 'pending-1',
                requestedAt: '2026-06-05T00:00:00Z',
                requestMessage: null,
              },
            ],
            sent: [],
          };
        },
        async getMyBlockedUsers() {
          return {
            items: [{
              avatarUrl: null,
              bio: null,
              blockedAt: 'now',
              displayName: 'Blocked',
              handle: 'blocked',
              id: 'blocked-1',
              reason: null,
            }],
            nextCursor: null,
            total: 1,
          };
        },
        async getUser(request: { path: { id: string } }) {
          calls.push(`getUser:${request.path.id}`);
          return {
            id: request.path.id,
            handle: request.path.id,
            displayName: request.path.id,
            createdAt: 'now',
          };
        },
        async reportControllerCreateReport(request: { body: Record<string, unknown> }) {
          calls.push(`report:${request.body.targetId ?? ''}:${request.body.reason ?? ''}`);
          return { id: 'report-1' };
        },
      },
    },
  };
}

test('Realm social snapshot helper projects generated friend, pending, and blocked records', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];
  const snapshot = await loadNimiRealmSocialSnapshot(realm, (action) => errors.push(action));
  assert.deepEqual(errors, []);
  assert.equal(snapshot.friends[0]?.id, 'friend-1');
  assert.equal(snapshot.pendingReceived[0]?.id, 'pending-1');
  assert.equal(snapshot.blocked[0]?.id, 'blocked-1');
});

test('Realm social reads fail closed on malformed friends, blocked users, and profiles', async () => {
  const isDecodeError = (error: unknown) =>
    (error as { readonly reasonCode?: string }).reasonCode
      === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED;

  for (const malformedFriend of [
    {},
    { id: 'friend-1', handle: 'friend', displayName: 'Friend', createdAt: 'now', avatarUrl: 42 },
    {
      id: 'friend-1',
      handle: 'friend',
      displayName: 'Friend',
      createdAt: 'now',
      socialProfiles: [{ handle: 'friend', platform: 'site', followers: 'many' }],
    },
  ]) {
    const { realm } = createSocialRealmStub();
    realm.generated.listMyFriendsWithDetails = async () => ({
      items: [malformedFriend],
      nextCursor: null,
      total: 1,
    });
    const errors: string[] = [];
    await assert.rejects(
      () => loadNimiRealmSocialSnapshot(realm, (action) => errors.push(action)),
      isDecodeError,
    );
    assert.ok(errors.includes('load-friends'));
  }

  {
    const { realm } = createSocialRealmStub();
    realm.generated.getMyBlockedUsers = async () => ({ items: [], nextCursor: null });
    const errors: string[] = [];
    await assert.rejects(
      () => loadNimiRealmSocialSnapshot(realm, (action) => errors.push(action)),
      isDecodeError,
    );
    assert.ok(errors.includes('load-blocked-users'));
  }

  {
    const { realm } = createSocialRealmStub();
    realm.generated.getUser = async () => ({});
    const errors: string[] = [];
    await assert.rejects(
      () => loadNimiRealmSocialSnapshot(realm, (action) => errors.push(action)),
      isDecodeError,
    );
    assert.ok(errors.includes('load-pending-friend-request-profile'));
    await assert.rejects(
      () => loadNimiRealmUserProfileById(realm, (action) => errors.push(action), 'user-1'),
      isDecodeError,
    );
    assert.ok(errors.includes('load-user-profile'));

    realm.generated.getUser = async () => ({
      id: 'user-1',
      handle: 'user-one',
      displayName: 'User One',
      createdAt: 'now',
      avatarUrl: 42,
    });
    await assert.rejects(
      () => loadNimiRealmUserProfileById(realm, (action) => errors.push(action), 'user-1'),
      isDecodeError,
    );
  }
});

test('Realm friendship and block helpers call admitted facade methods and reject empty identities', async () => {
  const { realm, calls } = createSocialRealmStub();
  await addNimiRealmFriendById(realm, 'friend-2');
  await removeNimiRealmFriendById(realm, 'friend-2');
  await blockNimiRealmUser(realm, 'blocked-2', 'spam');
  await unblockNimiRealmUser(realm, 'blocked-2');
  assert.deepEqual(calls, [
    'add:friend-2',
    'remove:friend-2',
    'block:blocked-2:spam',
    'unblock:blocked-2',
  ]);
  await assert.rejects(() => addNimiRealmFriendById(realm, ''), /Realm user id is required/);
});

test('Realm media and endpoint helpers preserve public resource resolution', () => {
  assert.equal(
    resolveNimiRealmMediaUrl({ mediaUrl: 'https://cdn.nimi.dev/a.png' }),
    'https://cdn.nimi.dev/a.png',
  );
  assert.equal(
    resolveNimiRealmMediaUrl({ realmBaseUrl: 'http://localhost:3002/', mediaUrl: '/media/a.png' }),
    'http://localhost:3002/media/a.png',
  );
  assert.equal(resolveNimiRealmMediaUrl({ mediaUrl: '/media/a.png' }), undefined);
  assert.equal(resolveNimiRealmMediaUrl({ mediaUrl: 'storage-key' }), 'storage-key');
  assert.equal(resolveNimiRealmMediaUrl({ mediaUrl: '  ' }), undefined);
  assert.equal(resolveNimiRealmBaseUrl({ realmBaseUrl: 'http://localhost' }), 'http://localhost:3002');
});

test('Realm social profile helpers preserve explicit user mutations', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];
  const me = await loadNimiRealmCurrentUserProfile(realm, (action) => errors.push(action));
  const updated = await updateNimiRealmCurrentUserProfile(realm, (action) => errors.push(action), {
    displayName: 'Me 2',
  });
  const profile = await loadNimiRealmUserProfileById(realm, (action) => errors.push(action), 'user-2');

  assert.equal(me.id, 'me');
  assert.equal(updated.displayName, 'Me 2');
  assert.equal(profile.id, 'user-2');
  assert.deepEqual(errors, []);
});

test('Realm user report helper passes the caller payload to the generated owner', async () => {
  const { realm, calls } = createSocialRealmStub();
  const errors: string[] = [];
  const result = await createNimiRealmReport(realm, (action) => errors.push(action), {
    targetId: 'user-2',
    targetType: 'USER',
    reason: 'SPAM',
  });
  assert.equal(result.id, 'report-1');
  assert.deepEqual(calls, ['report:user-2:SPAM']);
  assert.deepEqual(errors, []);
});

test('Realm user report helper reports and propagates the actual owner failure', async () => {
  const { realm } = createSocialRealmStub();
  const failure = new Error('report write unavailable');
  realm.generated.reportControllerCreateReport = async () => { throw failure; };
  const errors: string[] = [];
  await assert.rejects(createNimiRealmReport(realm, (action) => errors.push(action), {
    targetId: 'user-2', targetType: 'USER', reason: 'SPAM',
  }), (error) => error === failure);
  assert.deepEqual(errors, ['create-report']);
});
