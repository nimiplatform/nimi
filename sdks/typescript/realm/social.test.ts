import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RealmSourceConnectionDto,
  RelationshipPublicSourceLocatorDto,
  RelationshipSourceRefDto,
} from '../core-generated/realm-typed-client';
import {
  NIMI_REALM_FEED_SCOPES,
  addNimiRealmFriendById,
  blockNimiRealmUser,
  buildEmptyNimiRealmPostFeedResponse,
  connectNimiRealmSource,
  connectNimiRealmPublicSource,
  createNimiRealmPost,
  createNimiRealmReport,
  deleteNimiRealmPost,
  executeNimiRealmSocialMutation,
  isNimiRealmFeedScope,
  listNimiRealmSourceConnections,
  likeNimiRealmPost,
  loadNimiRealmCurrentUserProfile,
  loadNimiRealmExploreFeedItems,
  loadNimiRealmLikedPosts,
  loadNimiRealmPostById,
  loadNimiRealmPostFeed,
  loadNimiRealmSocialSnapshot,
  loadNimiRealmUserProfileById,
  resolveNimiRealmBaseUrl,
  removeNimiRealmFriendById,
  resolveNimiRealmMediaUrl,
  unblockNimiRealmUser,
  unlikeNimiRealmPost,
  updateNimiRealmCurrentUserProfile,
  updateNimiRealmPostVisibility,
} from './index';

const realmPersonaSourceRef: RelationshipSourceRefDto = {
  kind: 'realmPersona',
  worldId: 'world-1',
  sourceId: 'persona-1',
  sourceContentHash: 'sha256:persona',
};

const realmPersonaPublicSource: RelationshipPublicSourceLocatorDto = {
  kind: 'realmPersona',
  worldId: 'world-1',
  sourceId: 'persona-1',
};

function createRealmSourceConnection(sourceRef: RelationshipSourceRefDto): RealmSourceConnectionDto {
  return {
    id: 'source-connection-1',
    ownerUserId: 'me',
    sourceRef,
    runtimeSourceRef: `runtime-source:${sourceRef.kind}:${sourceRef.worldId}:${sourceRef.sourceId}:${sourceRef.sourceContentHash}`,
    status: 'active',
    connectedAt: '2026-06-18T00:00:00.000Z',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    removedAt: null,
  };
}

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
          };
        },
        async getMyPendingFriendRequests() {
          return {
            received: [{ userId: 'pending-1', requestedAt: '2026-06-05T00:00:00Z' }],
            sent: [],
          };
        },
        async getMyBlockedUsers() {
          return { items: [{ id: 'blocked-1', handle: 'blocked' }] };
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
        async likePost(request: { path: { postId: string } }) {
          calls.push(`like:${request.path.postId}`);
          return {};
        },
        async unlikePost(request: { path: { postId: string } }) {
          calls.push(`unlike:${request.path.postId}`);
          return {};
        },
        async getHomeFeed(request: { query: Record<string, unknown> }) {
          calls.push(`home:${request.query.visibility ?? ''}:${request.query.limit ?? ''}`);
          return {
            items: [{ id: 'home-post', createdAt: 'now' }],
            page: { cursor: request.query.cursor ?? null, nextCursor: null },
          };
        },
        async getExploreFeed(request: { query: Record<string, unknown> }) {
          calls.push(`explore:${request.query.tag ?? ''}:${request.query.cursor ?? ''}`);
          return {
            items: [{ id: 'explore-post', createdAt: 'now' }],
            page: { cursor: request.query.cursor ?? null, nextCursor: 'next' },
          };
        },
        async listLikedPosts(request: { query: Record<string, unknown> }) {
          calls.push(
            `liked:${request.query.userId}:${request.query.limit}:${request.query.cursor ?? ''}`,
          );
          return {
            items: [{ id: 'liked-post', createdAt: 'now' }],
            page: { cursor: request.query.cursor ?? null, nextCursor: null },
          };
        },
        async getPost(request: { path: { id: string } }) {
          calls.push(`getPost:${request.path.id}`);
          return { id: request.path.id, createdAt: 'now' };
        },
        async createPost(request: { body: Record<string, unknown> }) {
          calls.push(`createPost:${request.body.body ?? ''}`);
          return { id: 'post-1', createdAt: 'now', ...request.body };
        },
        async deletePost(request: { path: { id: string } }) {
          calls.push(`deletePost:${request.path.id}`);
          return {};
        },
        async updatePost(request: { path: { id: string }; body: Record<string, unknown> }) {
          calls.push(`updatePost:${request.path.id}:${request.body.visibility ?? ''}`);
          return { id: request.path.id, createdAt: 'now', ...request.body };
        },
        async reportControllerCreateReport(request: { body: Record<string, unknown> }) {
          calls.push(`report:${request.body.targetId ?? ''}:${request.body.reason ?? ''}`);
          return { id: 'report-1' };
        },
        async sourceConnectionControllerConnect(request: { body: { sourceRef: RelationshipSourceRefDto } }) {
          const { sourceRef } = request.body;
          calls.push(`connectSource:${sourceRef.kind}:${sourceRef.sourceId}`);
          return createRealmSourceConnection(sourceRef);
        },
        async sourceConnectionControllerConnectPublicSource(request: { body: { source: RelationshipPublicSourceLocatorDto } }) {
          const { source } = request.body;
          calls.push(`connectPublicSource:${source.kind}:${source.sourceId}:${'sourceContentHash' in source ? 'hash' : 'nohash'}`);
          return createRealmSourceConnection({
            ...source,
            sourceContentHash: 'resolved-server-hash',
          });
        },
        async sourceConnectionControllerList(request: { query: { status?: string } }) {
          calls.push(`listSources:${request.query.status ?? ''}`);
          return [createRealmSourceConnection(realmPersonaSourceRef)];
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

test('Realm social helpers call generated/facade methods and fail closed on unsupported mutations', async () => {
  const { realm, calls } = createSocialRealmStub();
  await addNimiRealmFriendById(realm, 'friend-2');
  await removeNimiRealmFriendById(realm, 'friend-2');
  await blockNimiRealmUser(realm, 'blocked-2', 'spam');
  await unblockNimiRealmUser(realm, 'blocked-2');
  await executeNimiRealmSocialMutation(realm, { kind: 'post-like', payload: { postId: 'post-1' } });
  await executeNimiRealmSocialMutation(realm, { kind: 'post-unlike', payload: { postId: 'post-1' } });
  assert.deepEqual(calls, [
    'add:friend-2',
    'remove:friend-2',
    'block:blocked-2:spam',
    'unblock:blocked-2',
    'like:post-1',
    'unlike:post-1',
  ]);
  await assert.rejects(
    () => executeNimiRealmSocialMutation(realm, { kind: 'unknown', payload: {} }),
    /not supported/,
  );
  await assert.rejects(() => addNimiRealmFriendById(realm, ''), /Realm user id is required/);
});

test('Realm social feed empty response keeps generated page shape', () => {
  assert.deepEqual([...NIMI_REALM_FEED_SCOPES], [
    'personal',
    'friends',
    'persona_activity',
    'world_character_activity',
  ]);
  assert.equal(isNimiRealmFeedScope('friends'), true);
  assert.equal(isNimiRealmFeedScope('persona_activity'), true);
  assert.equal(isNimiRealmFeedScope('source-activity'), false);
  assert.equal(isNimiRealmFeedScope(null), false);
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
  assert.deepEqual(buildEmptyNimiRealmPostFeedResponse({ cursor: 'c1', limit: 10 }), {
    items: [],
    page: { cursor: 'c1', limit: 10 },
  });
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

test('Realm source connection helpers require hash-bearing source refs and map generated responses', async () => {
  const { realm, calls } = createSocialRealmStub();
  const errors: string[] = [];

  const connection = await connectNimiRealmSource(
    realm,
    (action) => errors.push(action),
    realmPersonaSourceRef,
  );
  const connections = await listNimiRealmSourceConnections(realm, (action) => errors.push(action));

  assert.equal(connection.id, 'source-connection-1');
  assert.equal(
    connection.runtimeSourceRef,
    'runtime-source:realmPersona:world-1:persona-1:sha256:persona',
  );
  assert.equal(connections[0]?.sourceRef.sourceContentHash, 'sha256:persona');
  assert.deepEqual(errors, []);
  assert.deepEqual(calls.filter((call) => /^(connectSource|listSources):/.test(call)), [
    'connectSource:realmPersona:persona-1',
    'listSources:active',
  ]);
});

test('Realm public source connection helper sends locator without client-side hashes', async () => {
  const { realm, calls } = createSocialRealmStub();
  const errors: string[] = [];

  const connection = await connectNimiRealmPublicSource(
    realm,
    (action) => errors.push(action),
    realmPersonaPublicSource,
  );

  assert.equal(connection.sourceRef.sourceContentHash, 'resolved-server-hash');
  assert.deepEqual(errors, []);
  assert.deepEqual(calls.filter((call) => call.startsWith('connectPublicSource:')), [
    'connectPublicSource:realmPersona:persona-1:nohash',
  ]);
});

test('Realm public source connection helper fails closed on incomplete locators', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];

  await assert.rejects(
    () => connectNimiRealmPublicSource(realm, (action) => errors.push(action), null),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_PUBLIC_SOURCE_LOCATOR_REQUIRED',
  );
  await assert.rejects(
    () => connectNimiRealmPublicSource(realm, (action) => errors.push(action), {}),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_KIND_REQUIRED',
  );
  await assert.rejects(
    () => connectNimiRealmPublicSource(realm, (action) => errors.push(action), {
      ...realmPersonaPublicSource,
      kind: 'profile',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_KIND_UNSUPPORTED',
  );
  await assert.rejects(
    () => connectNimiRealmPublicSource(realm, (action) => errors.push(action), {
      ...realmPersonaPublicSource,
      worldId: ' ',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_WORLD_ID_REQUIRED',
  );
  await assert.rejects(
    () => connectNimiRealmPublicSource(realm, (action) => errors.push(action), {
      ...realmPersonaPublicSource,
      sourceId: '',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_ID_REQUIRED',
  );
  assert.deepEqual(errors, []);
});

test('Realm source connection helpers fail closed on incomplete source refs', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];

  await assert.rejects(
    () => connectNimiRealmSource(realm, (action) => errors.push(action), null),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_REF_REQUIRED',
  );
  await assert.rejects(
    () => connectNimiRealmSource(realm, (action) => errors.push(action), {}),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_KIND_REQUIRED',
  );
  await assert.rejects(
    () => connectNimiRealmSource(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      kind: 'profile',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_KIND_UNSUPPORTED',
  );
  await assert.rejects(
    () => connectNimiRealmSource(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      worldId: ' ',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_WORLD_ID_REQUIRED',
  );
  await assert.rejects(
    () => connectNimiRealmSource(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      sourceId: '',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_ID_REQUIRED',
  );
  await assert.rejects(
    () => connectNimiRealmSource(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      sourceContentHash: '',
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_CONTENT_HASH_REQUIRED',
  );
  assert.deepEqual(errors, []);
});

test('Realm source connection helpers emit operation-specific generated API failures', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];
  realm.generated.sourceConnectionControllerConnect = async () => {
    throw new Error('connect failed');
  };
  realm.generated.sourceConnectionControllerList = async () => {
    throw new Error('list failed');
  };

  await assert.rejects(
    () => connectNimiRealmSource(realm, (action) => errors.push(action), realmPersonaSourceRef),
    /connect failed/,
  );
  await assert.rejects(
    () => listNimiRealmSourceConnections(realm, (action) => errors.push(action)),
    /list failed/,
  );
  assert.deepEqual(errors, ['connect-source', 'list-source-connections']);
});

test('Realm social post, feed, report, and explore helpers map SDK inputs to generated requests', async () => {
  const { realm, calls } = createSocialRealmStub();
  const errors: string[] = [];

  assert.equal(
    (
      await loadNimiRealmPostFeed(realm, (action) => errors.push(action), {
        visibility: 'PUBLIC',
        worldId: 'world-1',
        authorId: 'user-1',
        limit: 5,
        cursor: 'cursor-1',
      })
    ).items[0]?.id,
    'home-post',
  );
  assert.equal(
    (await loadNimiRealmLikedPosts(realm, (action) => errors.push(action), 'user-1', 7, 'liked-cursor'))
      .items[0]?.id,
    'liked-post',
  );
  assert.equal((await loadNimiRealmPostById(realm, (action) => errors.push(action), 'post-1')).id, 'post-1');
  assert.equal(
    (await createNimiRealmPost(realm, (action) => errors.push(action), { body: 'hello' } as never)).id,
    'post-1',
  );
  await deleteNimiRealmPost(realm, (action) => errors.push(action), 'post-1');
  assert.equal(
    (await updateNimiRealmPostVisibility(realm, (action) => errors.push(action), 'post-1', 'FRIENDS'))
      .visibility,
    'FRIENDS',
  );
  await likeNimiRealmPost(realm, (action) => errors.push(action), 'post-2');
  await unlikeNimiRealmPost(realm, (action) => errors.push(action), 'post-2');
  assert.equal(
    (
      await createNimiRealmReport(realm, (action) => errors.push(action), {
        targetId: 'post-2',
        targetType: 'POST',
        reason: 'SAFETY',
      } as never)
    ).id,
    'report-1',
  );
  assert.equal(
    (await loadNimiRealmExploreFeedItems(realm, (action) => errors.push(action), 'ai', 4, 'explore-cursor'))
      .items[0]?.id,
    'explore-post',
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(
    calls.filter((call) =>
      /^(home|liked|getPost|createPost|deletePost|updatePost|like|unlike|report|explore):/.test(call),
    ),
    [
      'home:PUBLIC:5',
      'liked:user-1:7:liked-cursor',
      'getPost:post-1',
      'createPost:hello',
      'deletePost:post-1',
      'updatePost:post-1:FRIENDS',
      'like:post-2',
      'unlike:post-2',
      'report:post-2:SAFETY',
      'explore:ai:explore-cursor',
    ],
  );
});
