import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAccountProfileLibraryProjection,
  parseAIProfile,
  parseExportedAccountProfileLibraryProfiles,
} from '../src/ai/index.js';

test('parseAIProfile decodes canonical profile payloads', () => {
  const profile = parseAIProfile({
    profileId: 'profile-1',
    title: 'Profile 1',
    description: 'A profile',
    tags: ['local'],
    capabilities: {
      'text.generate': {
        targetRef: {
          kind: 'local_runtime_target_ref',
          targetId: 'target-chat',
          profileId: 'profile-chat',
        },
      },
    },
  });

  assert.equal(profile.profileId, 'profile-1');
  assert.equal(profile.tags[0], 'local');
});

test('parseAIProfile rejects RuntimeRouteBinding payloads', () => {
  assert.throws(
    () => parseAIProfile({
      profileId: 'profile-1',
      title: 'Profile 1',
      description: 'A profile',
      tags: [],
      capabilities: {
        'text.generate': {
          binding: {
            source: 'local',
            connectorId: '',
            model: 'llama',
          },
        },
      },
    }),
    /binding is forbidden/,
  );
});

test('parseAIProfile fails closed for malformed canonical profile payloads', () => {
  assert.throws(
    () => parseAIProfile({
      profileId: 'profile-1',
      title: 'Profile 1',
      capabilities: {},
    }),
    /AIProfile payload description must be a string/,
  );
});

test('parseAccountProfileLibraryProjection decodes library rows without owning library truth', () => {
  const projection = parseAccountProfileLibraryProjection({
    accountId: 'account-1',
    libraryPath: '/tmp/library',
    index: {
      schemaVersion: 1,
      accountId: 'account-1',
      updatedAt: '2026-05-31T00:00:00Z',
      entries: [{
        profileId: 'user-profile',
        title: 'User Profile',
        origin: 'user',
        relativePath: 'user/user-profile.json',
        editable: true,
        removable: true,
        updatedAt: '2026-05-31T00:00:00Z',
      }],
    },
    profiles: [{
      profileId: 'user-profile',
      origin: 'user',
      editable: true,
      removable: true,
      createdAt: '2026-05-31T00:00:00Z',
      updatedAt: '2026-05-31T00:00:00Z',
      profile: {
        profileId: 'user-profile',
        title: 'User Profile',
        capabilities: {},
      },
    }],
  });

  assert.equal(projection.accountId, 'account-1');
  assert.equal(projection.profiles[0]?.profile.profileId, 'user-profile');
  assert.equal(projection.profiles[0]?.profile.description, '');
});

test('parseAccountProfileLibraryProjection rejects editable account-default rows', () => {
  assert.throws(
    () => parseAccountProfileLibraryProjection({
      accountId: 'account-1',
      libraryPath: '/tmp/library',
      index: {
        schemaVersion: 1,
        accountId: 'account-1',
        updatedAt: '2026-05-31T00:00:00Z',
        entries: [],
      },
      profiles: [{
        profileId: 'default',
        origin: 'account-default',
        editable: true,
        removable: false,
        createdAt: '2026-05-31T00:00:00Z',
        updatedAt: '2026-05-31T00:00:00Z',
        profile: {
          profileId: 'default',
          title: 'Default',
          capabilities: {},
        },
      }],
    }),
    /projected the Account Default Profile as editable/,
  );
});

test('parseExportedAccountProfileLibraryProfiles decodes editable exports', () => {
  const profiles = parseExportedAccountProfileLibraryProfiles([{
    profileId: 'exported',
    title: 'Exported',
    capabilities: {},
  }]);

  assert.equal(profiles[0]?.profileId, 'exported');
});
