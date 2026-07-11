import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CreateSourceMaterializationPacketDto,
  SourceMaterializationPacketV2Dto,
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
  sourceContentHash: '7'.repeat(64),
};

const challengeDigest = 'a'.repeat(64);
const sourceMaterializationRequest: CreateSourceMaterializationPacketDto = {
  sourceRef: realmPersonaSourceRef,
  materializerAccountId: 'account-materializer-1',
  challengeId: 'challenge_test_0001',
  challengeDigest,
  intendedRuntimeAudience: 'nimi.runtime.instance.test',
  challengeExpiresAt: '2026-07-10T12:05:00.000Z',
  challengeLimits: {
    maxBundleBytes: 1_048_576,
    maxComponentCount: 128,
    maxChunkBytes: 65_536,
    maxChunks: 512,
  },
};

function createSourceMaterializationPacket(body: CreateSourceMaterializationPacketDto): SourceMaterializationPacketV2Dto {
  const sourceHash = 'b'.repeat(64);
  const worldHash = 'c'.repeat(64);
  const coverageHash = 'd'.repeat(64);
  const contextHash = 'e'.repeat(64);
  const payloadHash = 'f'.repeat(64);
  const manifestHash = '1'.repeat(64);
  const packetHash = '2'.repeat(64);
  const sourceComponentHash = '3'.repeat(64);
  const worldComponentHash = '4'.repeat(64);
  const sourceComponentId = 'realmPersona:persona-1';
  const worldComponentId = 'worldCore:world-1';
  const coverageManifest = {
    manifestSchemaVersion: 'realm.materialization-coverage/v1' as const,
    closurePolicyVersion: 'realm.materialization-closure/v1' as const,
    requiredSections: [
      { path: 'source.core.identity', state: 'present' as const },
      { path: 'source.core.personaStyle', state: 'present' as const },
      { path: 'materializationContext.owningWorld', state: 'present' as const },
    ],
    requiredRefs: [],
    optionalRefs: [],
    components: [
      {
        componentId: sourceComponentId,
        kind: 'realmPersona' as const,
        schemaVersion: 'realm.persona/v1',
        revision: 7,
        contentHash: sourceHash,
      },
      {
        componentId: worldComponentId,
        kind: 'worldCore' as const,
        schemaVersion: 'realm.world-core/v1',
        revision: 3,
        contentHash: worldHash,
      },
    ],
    crossReferenceChecks: [
      {
        checkId: 'persona-home-world',
        sourceRef: sourceComponentId,
        targetRef: worldComponentId,
        state: 'valid' as const,
      },
    ],
    aggregateStatus: 'complete' as const,
    coverageManifestHash: coverageHash,
  };
  const owningWorld = {
    id: 'world-1',
    creatorId: 'account-owner-1',
    visibility: 'private' as const,
    schemaVersion: 'realm.world-core/v1',
    contentRevision: 3,
    contentHash: worldHash,
    createdAt: '2026-07-10T11:00:00.000Z',
    updatedAt: '2026-07-10T11:00:00.000Z',
    origin: { kind: 'manual' as const },
    core: {
      identity: { name: 'Conformance World', summary: 'A complete fixture world.' },
      presentation: { displayName: 'Conformance World' },
      ontology: { entityKinds: [], relationshipTypes: [] },
      entities: [],
      relationships: [],
      scenes: [],
      timeline: { events: [] },
      timeModel: {
        mode: 'static' as const,
        anchor: {
          realStartedAt: '2026-07-10T11:00:00.000Z',
          worldStartedAt: '2026-07-10T11:00:00.000Z',
          worldStartedAtDisplay: 'Day 1',
        },
        flowRatio: 1,
        isPaused: false,
        pausedWorldTime: null,
        calendar: null,
        displayFormat: null,
      },
      systems: [],
      assets: { resourceRefs: [], intents: [] },
      authoring: { source: 'sdk-test-fixture' },
    },
  };
  return {
    packetSchemaVersion: 'realm.source-materialization-packet/v2',
    packetId: 'packet-1',
    issuer: 'https://realm.test',
    keyId: 'materialization-rs256-test-1',
    algorithm: 'RS256',
    keyUse: 'sig',
    issuedAt: '2026-06-18T00:00:00.000Z',
    expiresAt: '2026-06-18T00:05:00.000Z',
    nonce: 'nonce-1',
    intendedRuntimeAudience: body.intendedRuntimeAudience,
    challengeId: body.challengeId,
    challengeDigest: body.challengeDigest,
    challengeLimits: body.challengeLimits,
    materializerAccountId: body.materializerAccountId,
    sourceRef: body.sourceRef,
    payloadHash,
    bundleManifestHash: manifestHash,
    packetHash,
    packetProof: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Im1hdGVyaWFsaXphdGlvbi10ZXN0LTEifQ..signature',
    semanticPayload: {
      payloadSchemaVersion: 'realm.source-materialization-payload/v2',
      payloadAssemblyVersion: 'realm.materialization-assembly/v1',
      source: {
        kind: 'realmPersona',
        id: body.sourceRef.sourceId,
        ownerId: 'account-owner-1',
        visibility: 'private',
        homeWorldId: body.sourceRef.worldId,
        schemaVersion: 'realm.persona/v1',
        contentRevision: 7,
        contentHash: sourceHash,
        createdAt: '2026-07-10T11:00:00.000Z',
        updatedAt: '2026-07-10T11:00:00.000Z',
        origin: { kind: 'manual' },
        core: {
          identity: {
            name: 'Conformance Persona',
            handle: 'conformance-persona',
            summary: 'A complete fixture persona.',
          },
          presentation: {
            displayName: 'Conformance Persona',
            profileLine: 'Fixture persona',
          },
          personaStyle: {
            archetype: 'guide',
            traits: ['precise'],
            voice: 'calm',
            pacing: 'measured',
          },
          contentProfile: { topics: ['testing'], guidelines: [], boundaries: [] },
          interactionProfile: { homeWorldId: 'world-1', interactionModes: ['chat'] },
          assets: { resourceRefs: [], intents: [] },
          authoring: { source: 'sdk-test-fixture' },
        },
      },
      materializationContext: {
        contextSchemaVersion: 'realm.materialization-context/v1',
        sourceRef: body.sourceRef,
        owningWorld,
        dependencyClosure: { kind: 'realmPersona', explicitDependencies: [] },
        sourceComponentDigests: [
          { componentId: sourceComponentId, kind: 'realmPersona', contentHash: sourceHash },
        ],
        worldAndClosureComponentDigests: [
          { componentId: worldComponentId, kind: 'worldCore', contentHash: worldHash },
        ],
        closurePolicyVersion: 'realm.materialization-closure/v1',
        coverageManifestHash: coverageHash,
        materializationContextHash: contextHash,
      },
      coverageManifest,
      coverageManifestHash: coverageHash,
      materializationContextHash: contextHash,
    },
    bundleTransportManifest: {
      manifestSchemaVersion: 'realm.materialization-bundle-manifest/v1',
      payloadAssemblyVersion: 'realm.materialization-assembly/v1',
      packetId: 'packet-1',
      challengeDigest: body.challengeDigest,
      totalCanonicalBytes: 4,
      componentCount: 2,
      chunkCount: 2,
      components: [
        {
          componentId: sourceComponentId,
          kind: 'realmPersona',
          schemaVersion: 'realm.persona/v1',
          revision: 7,
          contentHash: sourceHash,
          canonicalBytesHash: sourceComponentHash,
          canonicalByteLength: 2,
        },
        {
          componentId: worldComponentId,
          kind: 'worldCore',
          schemaVersion: 'realm.world-core/v1',
          revision: 3,
          contentHash: worldHash,
          canonicalBytesHash: worldComponentHash,
          canonicalByteLength: 2,
        },
      ],
      chunks: [
        { globalOrdinal: 0, componentOffset: 0, length: 2, chunkSha256: '5'.repeat(64) },
        { globalOrdinal: 1, componentOffset: 0, length: 2, chunkSha256: '6'.repeat(64) },
      ],
    },
    orderedComponentChunks: [
      {
        componentId: sourceComponentId,
        kind: 'realmPersona',
        schemaVersion: 'realm.persona/v1',
        revision: 7,
        contentHash: sourceHash,
        canonicalBytesHash: sourceComponentHash,
        canonicalByteLength: 2,
        canonicalBytes: [
          { globalOrdinal: 0, componentOffset: 0, length: 2, chunkSha256: '5'.repeat(64), bytesBase64: 'e30=' },
        ],
      },
      {
        componentId: worldComponentId,
        kind: 'worldCore',
        schemaVersion: 'realm.world-core/v1',
        revision: 3,
        contentHash: worldHash,
        canonicalBytesHash: worldComponentHash,
        canonicalByteLength: 2,
        canonicalBytes: [
          { globalOrdinal: 1, componentOffset: 0, length: 2, chunkSha256: '6'.repeat(64), bytesBase64: 'e30=' },
        ],
      },
    ],
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
          const { sourceRef, intendedRuntimeAudience, challengeId } = request.body;
          calls.push(`materializeSource:${sourceRef.kind}:${sourceRef.sourceId}:${intendedRuntimeAudience}:${challengeId}`);
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

test('Realm source materialization packet helper preserves the complete Runtime challenge and packet v2 carrier', async () => {
  const { realm, calls } = createSocialRealmStub();
  const errors: string[] = [];

  const packet = await createNimiRealmSourceMaterializationPacket(
    realm,
    (action) => errors.push(action),
    sourceMaterializationRequest,
  );

  assert.equal(packet.packetSchemaVersion, 'realm.source-materialization-packet/v2');
  assert.equal(packet.intendedRuntimeAudience, sourceMaterializationRequest.intendedRuntimeAudience);
  assert.equal(packet.challengeId, sourceMaterializationRequest.challengeId);
  assert.equal(packet.challengeDigest, challengeDigest);
  assert.equal(packet.algorithm, 'RS256');
  assert.equal(packet.semanticPayload.source.kind, 'realmPersona');
  assert.equal(packet.bundleTransportManifest.componentCount, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(calls.filter((call) => call.startsWith('materializeSource:')), [
    'materializeSource:realmPersona:persona-1:nimi.runtime.instance.test:challenge_test_0001',
  ]);

  await createNimiRealmSourceMaterializationPacket(
    realm,
    (action) => errors.push(action),
    {
      ...sourceMaterializationRequest,
      sourceRef: {
        kind: 'worldCharacter',
        worldId: 'world-1',
        sourceId: 'character-1',
        sourceContentHash: '8'.repeat(64),
      },
    },
  );
  assert.equal(
    calls.filter((call) => call.startsWith('materializeSource:')).at(-1),
    'materializeSource:worldCharacter:character-1:nimi.runtime.instance.test:challenge_test_0001',
  );
});

test('Realm source materialization packet helper fails closed on incomplete, unknown, or forged challenge inputs', async () => {
  const { realm } = createSocialRealmStub();
  const errors: string[] = [];

  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), null),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_REQUEST_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {}),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_REQUEST_INVALID',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      sourceRef: { ...realmPersonaSourceRef, kind: 'profile' },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_KIND_UNSUPPORTED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      sourceRef: { ...realmPersonaSourceRef, worldId: ' ' },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_WORLD_ID_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      sourceRef: { ...realmPersonaSourceRef, sourceContentHash: 'sha256:forged' },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_CONTENT_HASH_REQUIRED',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      sourceRef: { ...realmPersonaSourceRef, unexpected: true },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_REF_INVALID',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      challengeDigest: 'forged',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_CHALLENGE_DIGEST_INVALID',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      intendedRuntimeAudience: ' ',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_AUDIENCE_INVALID',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      intendedRuntimeAudience: 'x'.repeat(513),
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_AUDIENCE_INVALID',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      intendedRuntimeAudience: 'runtime.不可见',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_AUDIENCE_INVALID',
  );
  for (const challengeExpiresAt of [
    '2026-07-10T12:05:00+00:00',
    '2026-02-30T12:05:00.000Z',
    '2026-07-10 12:05:00Z',
  ]) {
    await assert.rejects(
      () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
        ...sourceMaterializationRequest,
        challengeExpiresAt,
      }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_EXPIRY_INVALID',
    );
  }
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      challengeLimits: { ...sourceMaterializationRequest.challengeLimits, maxChunks: 0 },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_LIMITS_INVALID',
  );
  await assert.rejects(
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), {
      ...sourceMaterializationRequest,
      forged: true,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_SOURCE_MATERIALIZATION_REQUEST_INVALID',
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
    () => createNimiRealmSourceMaterializationPacket(realm, (action) => errors.push(action), sourceMaterializationRequest),
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
