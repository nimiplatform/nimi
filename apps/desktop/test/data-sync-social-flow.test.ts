import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  blockUser,
  loadSocialSnapshot,
  unblockUser,
} from '../src/shell/renderer/features/social/data/profile-data.js';
import {
  getCachedContacts,
  updateCachedContacts,
} from '../src/shell/renderer/features/social/data/social-snapshot.js';

const profileFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/social/data/profile-data.ts'),
  'utf8',
);

const profileFlowSocialSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/social/data/social-snapshot.ts'),
  'utf8',
);

function resetCachedContacts() {
  updateCachedContacts({
    friends: [],
    agents: [],
    groups: [],
    pendingReceived: [],
    pendingSent: [],
    blocked: [],
  });
}

describe('D-DSYNC-004: social flow source scanning', () => {
  test('D-DSYNC-004: source includes requestOrAcceptFriend flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function requestOrAcceptFriend'),
      'requestOrAcceptFriend must be exported from profile-flow',
    );
  });

  test('D-DSYNC-004: source includes blockUser flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function blockUser'),
      'blockUser must be exported from profile-flow',
    );
  });

  test('D-DSYNC-004: source includes unblockUser flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function unblockUser'),
      'unblockUser must be exported from profile-flow',
    );
  });

  test('D-DSYNC-004: source includes removeFriend flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function removeFriend'),
      'removeFriend must be exported from profile-flow',
    );
  });

  test('D-DSYNC-004: social graph flow does not promote test or fallback contacts', () => {
    assert.doesNotMatch(profileFlowSource, /startsWith\('test-'\)/);
    assert.doesNotMatch(profileFlowSocialSource, /startsWith\('test-'\)/);
    assert.doesNotMatch(profileFlowSource, /__localFallbackUntil/);
    assert.doesNotMatch(profileFlowSocialSource, /__localFallbackUntil/);
  });
});

test('social snapshot ignores local test and fallback contacts when Realm returns none', async () => {
  resetCachedContacts();
  updateCachedContacts({
    friends: [
      { id: 'test-local-user', displayName: 'Local Test' },
      { id: 'fallback-user', displayName: 'Fallback', __localFallbackUntil: Date.now() + 60_000 },
    ],
    agents: [],
    groups: [],
    pendingReceived: [],
    pendingSent: [],
    blocked: [{ id: 'test-blocked-user', displayName: 'Local Blocked' }],
  });

  const snapshot = await loadSocialSnapshot(
    async (task) => task({
      services: {
        MeService: {
          listMyFriendsWithDetails: async () => ({ items: [] }),
          getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
          getMyBlockedUsers: async () => ({ items: [] }),
        },
        UserService: {},
      },
    } as never),
    () => undefined,
  );

  assert.deepEqual(snapshot.friends, []);
  assert.deepEqual(snapshot.blocked, []);
  assert.deepEqual(getCachedContacts().friends, []);
  assert.deepEqual(getCachedContacts().blocked, []);
});

test('block and unblock test-prefixed contacts use Realm instead of local success state', async () => {
  resetCachedContacts();
  const calls: string[] = [];
  let reloads = 0;

  const callApi = async (task: (realm: unknown) => Promise<unknown>) => task({
    services: {
      MeService: {
        blockUser: async (id: string) => {
          calls.push(`block:${id}`);
        },
        unblockUser: async (id: string) => {
          calls.push(`unblock:${id}`);
        },
      },
      UserService: {
        addFriend: async () => {
          calls.push('addFriend');
        },
      },
    },
  });

  await blockUser(callApi as never, { id: 'test-contact' }, async () => {
    reloads += 1;
  });
  await unblockUser(callApi as never, { id: 'test-contact' }, async () => {
    reloads += 1;
  });

  assert.deepEqual(calls, ['block:test-contact', 'unblock:test-contact']);
  assert.equal(reloads, 2);
  assert.deepEqual(getCachedContacts().friends, []);
  assert.deepEqual(getCachedContacts().blocked, []);
});

test('unblock does not insert a fallback friend when Realm add-friend would fail', async () => {
  resetCachedContacts();
  const calls: string[] = [];

  await unblockUser(
    (async (task: (realm: unknown) => Promise<unknown>) => task({
      services: {
        MeService: {
          unblockUser: async (id: string) => {
            calls.push(`unblock:${id}`);
          },
        },
        UserService: {
          addFriend: async () => {
            calls.push('addFriend');
            throw new Error('privacy denied');
          },
        },
      },
    })) as never,
    { id: 'contact-1' },
    async () => undefined,
  );

  assert.deepEqual(calls, ['unblock:contact-1']);
  assert.deepEqual(getCachedContacts().friends, []);
});

test('blocked user load failures fail close instead of becoming an empty social graph', async () => {
  resetCachedContacts();
  const errors: Array<{ action: string; error: unknown }> = [];

  await assert.rejects(
    () => loadSocialSnapshot(
      async (task) => task({
        services: {
          MeService: {
            listMyFriendsWithDetails: async () => ({ items: [] }),
            getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
            getMyBlockedUsers: async () => {
              throw new Error('blocked users unavailable');
            },
          },
          UserService: {},
        },
      } as never),
      (action, error) => {
        errors.push({ action, error });
      },
    ),
    /blocked users unavailable/,
  );

  assert.deepEqual(
    errors.map((error) => error.action),
    ['load-blocked-users', 'load-social-snapshot'],
  );
});
