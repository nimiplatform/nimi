import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requireHumanAccountId,
  toHumanProfileData,
} from '../src/shell/renderer/features/profile/profile-model.js';

test('human profile projection preserves only UserProfile fields', () => {
  const profile = toHumanProfileData({
    id: 'account-a',
    displayName: 'Alice',
    handle: 'alice',
    avatarUrl: '/alice.png',
    profileCoverUrl: '/alice-cover.png',
    bio: 'Hello',
    createdAt: '2026-07-31T00:00:00.000Z',
    stats: {
      friendsCount: 3,
      postsCount: 4,
      likesCount: 5,
    },
    giftStats: {
      flower: 2,
      ignored: 'not-a-count',
    },
  });

  assert.equal(profile.id, 'account-a');
  assert.equal(profile.coverUrl, '/alice-cover.png');
  assert.deepEqual(profile.stats, {
    friendsCount: 3,
    postsCount: 4,
    likesCount: 5,
  });
  assert.deepEqual(profile.giftStats, { flower: 2 });
  assert.equal('sourceRef' in profile, false);
  assert.equal('isSource' in profile, false);
});

test('human profile projection fails closed on Character Source identity', () => {
  assert.throws(() => toHumanProfileData({
    id: 'character-a',
    displayName: 'Character A',
    handle: 'character-a',
    sourceRef: {
      kind: 'personaCharacter',
      id: 'character-a',
    },
  } as never), /cannot consume Character Source/i);

  assert.throws(() => toHumanProfileData({
    id: 'character-a',
    displayName: 'Character A',
    handle: 'character-a',
    isSource: true,
  } as never), /cannot consume Character Source/i);

  assert.throws(() => toHumanProfileData({
    id: 'account-a',
    displayName: 'Alice',
    handle: 'alice',
    isSource: false,
  } as never), /cannot consume Character Source/i);
});

test('human profile projection rejects Runtime LocalAgent references and missing account ids', () => {
  assert.equal(requireHumanAccountId(' account-a '), 'account-a');
  assert.throws(
    () => requireHumanAccountId('runtime-source:personaCharacter:world-a:persona-a'),
    /cannot be a Runtime LocalAgent reference/i,
  );

  assert.throws(() => toHumanProfileData({
    id: 'local-agent:account-a:agent-a',
    displayName: 'Agent A',
    handle: 'agent-a',
  }), /cannot be a Runtime LocalAgent reference/i);

  assert.throws(() => toHumanProfileData({
    displayName: 'Unknown',
    handle: 'unknown',
  }), /accountId is required/i);
});
