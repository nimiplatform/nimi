import assert from 'node:assert/strict';
import test from 'node:test';

import { loadHumanProfileWithRelationship } from '../src/shell/renderer/features/profile/profile-loader';
import type { SocialContactSnapshot } from '../src/shell/renderer/features/social/data/social-snapshot';

const cachedFriendContacts = {
  friends: [{ id: 'user_friend', displayName: 'Cached Friend' }],
  pendingSent: [{ userId: 'user_pending' }],
} as unknown as SocialContactSnapshot;

test('a failed profile read stays a failure even when the contact cache knows the person', async () => {
  const failure = new Error('realm-unavailable');
  await assert.rejects(
    loadHumanProfileWithRelationship('user_friend', {
      loadUserProfile: async () => { throw failure; },
      isFriend: () => true,
      contacts: () => cachedFriendContacts,
    }),
    (error) => error === failure,
  );
});

test('a loaded profile takes relationship facts from the owner contact list without reversing explicit ones', async () => {
  const loaded = await loadHumanProfileWithRelationship('user_friend', {
    loadUserProfile: async (id) => ({ id, displayName: 'Loaded' }),
    isFriend: (id) => id === 'user_friend',
    contacts: () => cachedFriendContacts,
  });
  assert.equal(loaded.displayName, 'Loaded');
  assert.equal(loaded.isFriend, true);
  assert.equal(loaded.isPendingFriendRequest, false);

  const pending = await loadHumanProfileWithRelationship('user_pending', {
    loadUserProfile: async (id) => ({ id, displayName: 'Pending' }),
    isFriend: () => false,
    contacts: () => cachedFriendContacts,
  });
  assert.equal(pending.isFriend, false);
  assert.equal(pending.isPendingFriendRequest, true);

  const explicit = await loadHumanProfileWithRelationship('user_friend', {
    loadUserProfile: async (id) => ({ id, displayName: 'Explicit', isFriend: false, isPendingFriendRequest: false }),
    isFriend: () => true,
    contacts: () => cachedFriendContacts,
  });
  assert.equal(explicit.isFriend, false);
  assert.equal(explicit.isPendingFriendRequest, false);
});
