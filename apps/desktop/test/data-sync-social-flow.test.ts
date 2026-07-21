import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createOfflineNimiError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  blockUser,
  loadSocialSnapshot,
  rejectOrRemoveFriend,
  removeFriend,
  requestOrAcceptFriend,
  unblockUser,
} from '../src/shell/renderer/features/social/data/profile-data.js';
import { createSocialSnapshotStore } from '../src/shell/renderer/features/social/data/social-snapshot.js';
import type { RealmSocialOfflinePort } from '../src/shell/renderer/features/social/data/social-offline-port.js';

const profileFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/social/data/profile-data.ts'),
  'utf8',
);

const profileFlowSocialSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/social/data/social-snapshot.ts'),
  'utf8',
);
const snapshotStore = createSocialSnapshotStore();
const failClosedOffline: RealmSocialOfflinePort = Object.freeze({
  async syncProfileMetadata() {},
  async loadProfileMetadata() { return null; },
  markCacheFallbackUsed() {},
  markRealmUnreachable() {},
  async queueSocialMutation() {
    throw new Error('TEST_SOCIAL_OFFLINE_QUEUE_UNADMITTED');
  },
});

function resetCachedContacts() {
  snapshotStore.update({
    friends: [],
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

  test('D-DSYNC-004: reusable social snapshot DX lives in SDK Realm extension', () => {
    assert.match(profileFlowSocialSource, /loadNimiRealmSocialSnapshot/);
    assert.doesNotMatch(profileFlowSocialSource, /loadRealmSocialSnapshot/);
    assert.doesNotMatch(profileFlowSocialSource, /realm\.services\.MeService\.listMyFriendsWithDetails/);
  });

  test('D-DSYNC-004: friendship mutations fail closed offline instead of entering generic social outbox', async () => {
    const offline = createOfflineNimiError({
      source: 'realm',
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      message: 'realm offline',
      actionHint: 'retry',
    });
    const callApi = async () => {
      throw offline;
    };

    await assert.rejects(
      () => requestOrAcceptFriend({
        callApi: callApi as never,
        offline: failClosedOffline,
        userId: 'agent-or-human-1',
        reloadContacts: async () => undefined,
      }),
      /realm offline/,
    );
    await assert.rejects(
      () => removeFriend({
        callApi: callApi as never,
        offline: failClosedOffline,
        userId: 'agent-or-human-1',
        reloadContacts: async () => undefined,
      }),
      /realm offline/,
    );
    await assert.rejects(
      () => rejectOrRemoveFriend({
        callApi: callApi as never,
        offline: failClosedOffline,
        userId: 'agent-or-human-1',
        reloadContacts: async () => undefined,
      }),
      /realm offline/,
    );

  });
});

test('social snapshot ignores local test and fallback contacts when Realm returns none', async () => {
  resetCachedContacts();
  snapshotStore.update({
    friends: [
      { id: 'test-local-user', displayName: 'Local Test' },
      { id: 'fallback-user', displayName: 'Fallback', __localFallbackUntil: Date.now() + 60_000 },
    ],
    pendingReceived: [],
    pendingSent: [],
    blocked: [{ id: 'test-blocked-user', displayName: 'Local Blocked' }],
  });

  const snapshot = await loadSocialSnapshot(
    async (task) => task({
      generated: {
        listMyFriendsWithDetails: async () => ({ items: [] }),
        getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
        getMyBlockedUsers: async () => ({ items: [] }),
        getUser: async () => ({ id: 'unused' }),
      },
    } as never),
    () => undefined,
    snapshotStore,
  );

  assert.deepEqual(snapshot.friends, []);
  assert.deepEqual(snapshot.blocked, []);
  assert.deepEqual(snapshotStore.get().friends, []);
  assert.deepEqual(snapshotStore.get().blocked, []);
});

test('block and unblock test-prefixed contacts use Realm instead of local success state', async () => {
  resetCachedContacts();
  const calls: string[] = [];
  let reloads = 0;

  const callApi = async (task: (realm: unknown) => Promise<unknown>) => task({
    social: {
      blockUser: async (request: { path: { id: string } }) => {
        calls.push(`block:${request.path.id}`);
      },
      unblockUser: async (request: { path: { id: string } }) => {
        calls.push(`unblock:${request.path.id}`);
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
  assert.deepEqual(snapshotStore.get().friends, []);
  assert.deepEqual(snapshotStore.get().blocked, []);
});

test('unblock does not insert a fallback friend when Realm add-friend would fail', async () => {
  resetCachedContacts();
  const calls: string[] = [];

  await unblockUser(
    (async (task: (realm: unknown) => Promise<unknown>) => task({
      social: {
        unblockUser: async (request: { path: { id: string } }) => {
          calls.push(`unblock:${request.path.id}`);
        },
      },
    })) as never,
    { id: 'contact-1' },
    async () => undefined,
  );

  assert.deepEqual(calls, ['unblock:contact-1']);
  assert.deepEqual(snapshotStore.get().friends, []);
});

test('blocked user load failures fail close instead of becoming an empty social graph', async () => {
  resetCachedContacts();
  const errors: Array<{ action: string; error: unknown }> = [];

  await assert.rejects(
    () => loadSocialSnapshot(
      async (task) => task({
        generated: {
          listMyFriendsWithDetails: async () => ({ items: [] }),
          getMyPendingFriendRequests: async () => ({ received: [], sent: [] }),
          getMyBlockedUsers: async () => {
            throw new Error('blocked users unavailable');
          },
          getUser: async () => ({ id: 'unused' }),
        },
      } as never),
      (action, error) => {
        errors.push({ action, error });
      },
      snapshotStore,
    ),
    /blocked users unavailable/,
  );

  assert.deepEqual(
    errors.map((error) => error.action),
    ['load-blocked-users', 'load-social-snapshot'],
  );
});
