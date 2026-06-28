import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CreateSourceMaterializationPacketDto,
  SourceMaterializationPacketDto,
  TypedSourceRefDto,
} from '../core-generated/realm-typed-client';
import {
  NIMI_REALM_FEED_SCOPES,
  addNimiRealmFriendById,
  blockNimiRealmUser,
  buildEmptyNimiRealmPostFeedResponse,
  createNimiRealmSourceMaterializationPacket,
  createNimiRealmPost,
  createNimiRealmReport,
  deleteNimiRealmPost,
  executeNimiRealmSocialMutation,
  isNimiRealmFeedScope,
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

const realmPersonaSourceRef: TypedSourceRefDto = {
  kind: 'realmPersona',
  worldId: 'world-1',
  sourceId: 'persona-1',
  sourceContentHash: 'sha256:persona',
};

function createSourceMaterializationPacket(body: CreateSourceMaterializationPacketDto): SourceMaterializationPacketDto {
  const { sourceRef, intendedRuntimeAudience } = body;
  return {
    packetSchemaVersion: 'realm.source-materialization-packet/v1',
    packetId: 'packet-1',
    sourceKind: sourceRef.kind,
    sourceId: sourceRef.sourceId,
    sourceWorldId: sourceRef.worldId,
    sourceContentRevision: 7,
    sourceContentHash: sourceRef.sourceContentHash,
    issuedAt: '2026-06-18T00:00:00.000Z',
    expiresAt: '2026-06-18T00:05:00.000Z',
    nonce: 'nonce-1',
    packetHash: 'packet-hash-1',
    packetProof: 'hmac-sha256:proof-1',
    intendedRuntimeAudience,
    runtimeSourceRef: `runtime-source:${sourceRef.kind}:${sourceRef.worldId}:${sourceRef.sourceId}:${sourceRef.sourceContentHash}`,
    sourceDisplayMetadata: { displayName: 'Persona 1' },
    payload: { sourceRef },
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
        async worldCoreControllerCreateSourceMaterializationPacket(request: { body: CreateSourceMaterializationPacketDto }) {
          const { sourceRef, intendedRuntimeAudience } = request.body;
          calls.push(`materializeSource:${sourceRef.kind}:${sourceRef.sourceId}:${intendedRuntimeAudience}`);
          return createSourceMaterializationPacket(request.body);
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

test('Realm source materialization packet helper requires hash-bearing source refs and audience', async () => {
  const { realm, calls } = createSocialRealmStub();
  const errors: string[] = [];

  const packet = await createNimiRealmSourceMaterializationPacket(
    realm,
    (action) => errors.push(action),
    realmPersonaSourceRef,
    'desktop.runtime',
  );

  assert.equal(packet.packetSchemaVersion, 'realm.source-materialization-packet/v1');
  assert.equal(packet.intendedRuntimeAudience, 'desktop.runtime');
  assert.equal(packet.packetProof, 'hmac-sha256:proof-1');
  assert.equal(
    packet.runtimeSourceRef,
    'runtime-source:realmPersona:world-1:persona-1:sha256:persona',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(calls.filter((call) => call.startsWith('materializeSource:')), [
    'materializeSource:realmPersona:persona-1:desktop.runtime',
  ]);
});

test('Realm source materialization packet helper fails closed on incomplete inputs', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];

  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), null, 'desktop.runtime'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_REF_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {}, 'desktop.runtime'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_KIND_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      kind: 'profile',
    }, 'desktop.runtime'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_KIND_UNSUPPORTED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      worldId: ' ',
    }, 'desktop.runtime'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_WORLD_ID_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      sourceId: '',
    }, 'desktop.runtime'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_ID_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...realmPersonaSourceRef,
      sourceContentHash: '',
    }, 'desktop.runtime'),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_CONTENT_HASH_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), realmPersonaSourceRef, ' '),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_AUDIENCE_REQUIRED',
  );
  assert.deepEqual(errors, []);
});

test('Realm source materialization packet helper emits operation-specific generated API failures', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];
  realm.generated.worldCoreControllerCreateSourceMaterializationPacket = async () => {
    throw new Error('packet failed');
  };

  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), realmPersonaSourceRef, 'desktop.runtime'),
    /packet failed/,
  );
  assert.deepEqual(errors, ['create-source-materialization-packet']);
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
