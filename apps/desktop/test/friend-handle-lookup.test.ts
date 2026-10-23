import assert from 'node:assert/strict';
import test from 'node:test';
import type { RealmApiCaller } from '../src/shell/renderer/features/social/data/social-snapshot.js';
import { requestFriendByHandle } from '../src/shell/renderer/features/relationship/friend-handle-lookup.js';
import { validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

test('friend requests use the exact handle mutation without reading a complete profile', async () => {
  const requests: unknown[] = [];
  const callApi: RealmApiCaller = async (task) => task({
    social: { addFriendByHandle: async (request: unknown) => {
      requests.push(request);
      return { outcome: 'requested' };
    } },
  } as never);
  const result = await requestFriendByHandle(callApi, ' @alice ');
  assert.deepEqual(requests, [{ path: { handle: 'alice' }, body: {} }]);
  assert.deepEqual(result, { outcome: 'requested' });
  await assert.rejects(requestFriendByHandle(callApi, ' @ '), /complete account handle/);
  assert.equal(requests.length, 1, 'empty handles do not reach Realm');
});

test('friend requests preserve denial/offline failures and reject unconfirmed outcomes', async () => {
  const denied = new Error('Friend requests are private');
  await assert.rejects(requestFriendByHandle(async () => { throw denied; }, 'alice'), (error) => error === denied);
  const callApi: RealmApiCaller = async (task) => task({
    social: { addFriendByHandle: async () => ({ outcome: 'unknown' }) },
  } as never);
  await assert.rejects(requestFriendByHandle(callApi, 'alice'), /invalid friend request outcome/);
});

test('launch navigation retains source catalogs and rejects deferred feed destinations', () => {
  assert.equal(validateHomeDestination({ id: 'explore', exploreSection: 'worlds' }).exploreSection, 'worlds');
  assert.equal(validateHomeDestination({ id: 'explore', exploreSection: 'personas' }).exploreSection, 'personas');
  assert.throws(() => validateHomeDestination({ id: 'activity' }), /Unknown Home destination/);
  assert.throws(() => validateHomeDestination({ id: 'explore', exploreSection: 'activity' }), /Invalid Home exploreSection/);
});
