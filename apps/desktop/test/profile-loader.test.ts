import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContextualHumanProfile } from '../src/shell/renderer/features/profile/profile-loader.js';

test('an unrelated failed profile read stays a failure even when the contact list knows the person', async () => {
  const failure = new Error('realm-unavailable');
  await assert.rejects(loadContextualHumanProfile('person-a', {
    loadUserProfile: async () => { throw failure; },
    loadRelationship: async () => { throw new Error('An unrelated failure must not read a relationship fallback'); },
  }, { id: 'person-a', displayName: 'Cached identity', handle: 'person_a' }), error => error === failure);
});

test('a loaded profile preserves the owner relationship without needing a second read', async () => {
  const relationship = { state: 'active' as const, relationshipId: 'friendship-a', blockedByMe: false, canMessage: true, canRequest: false };
  const profile = await loadContextualHumanProfile('person-a', {
    loadUserProfile: async () => ({ id: 'person-a', displayName: 'A', handle: 'person_a', relationship, relationshipId: relationship.relationshipId, isFriend: true }),
    loadRelationship: async () => { throw new Error('Do not repeat the owner relationship read'); },
  });
  assert.equal(profile.isFriend, true);
  assert.equal(profile.relationshipId, 'friendship-a');
  assert.deepEqual(profile.relationship, relationship);
});

test('restricted contextual profiles retain only minimal identity and freshly admitted relationship actions', async () => {
  const profile = await loadContextualHumanProfile('person-a', {
    loadUserProfile: async () => { throw Object.assign(new Error('Restricted'), { status: 403 }); },
    loadRelationship: async () => ({ state: 'pending_incoming', relationshipId: 'request-a', blockedByMe: false, canMessage: false, canRequest: false }),
  }, { id: 'person-a', displayName: 'A', handle: 'person_a', bio: 'stale private bio', city: 'private city', tags: ['private'], friendsCount: 20 });
  assert.equal(profile.accessState, 'restricted');
  assert.equal(profile.displayName, 'A');
  assert.equal(profile.bio, null);
  assert.equal(profile.city, null);
  assert.deepEqual(profile.tags, []);
  assert.equal(profile.stats, null);
  assert.equal(profile.isFriend, false);
  assert.equal(profile.relationshipId, 'request-a');
  assert.equal(profile.relationship?.state, 'pending_incoming');
});
