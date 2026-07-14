import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CreateSourceMaterializationPacketDto,
  SourceMaterializationPacketV2Dto,
} from '../core-generated/realm-typed-client';
import {
  AgentContextProjectionReasonCode,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentLocalSourceContextSchemaVersion,
  AgentLocalSourceContextState,
  AgentLocalSourceSnapshotSchemaVersion,
  AgentSourceMaterializationChallengeState,
  AgentSourceMaterializationReasonCode,
  AgentSourceMaterializationSourceKind,
  AgentSourceMaterializationUploadState,
  type CommitSourceMaterializationResponse,
  type SourceMaterializationSourceRef,
} from '../core-generated/runtime-typed-client';
import { toNimiRuntimeTimestamp } from './runtime-agent-values';
import {
  createNimiHostRuntimeAgentMaterializationSurface,
  type NimiRuntimeAgentMaterializationModule,
} from './runtime-agent-materialization';

const OWNER_USER_ID = 'materializer-account-1';
const SOURCE_REF = {
  kind: 'worldCharacter',
  worldId: 'world-1',
  sourceId: 'character-1',
  sourceContentHash: 'a'.repeat(64),
} as const;
const RUNTIME_SOURCE_REF: SourceMaterializationSourceRef = {
  kind: AgentSourceMaterializationSourceKind.WORLD_CHARACTER,
  worldId: SOURCE_REF.worldId,
  sourceId: SOURCE_REF.sourceId,
  sourceContentHash: SOURCE_REF.sourceContentHash,
};
const CHALLENGE_ID = 'runtime-challenge-opaque-0001';
const CHALLENGE_DIGEST = 'b'.repeat(64);
const AUDIENCE = 'runtime-instance:opaque-audience-1';
const PACKET_HASH = 'c'.repeat(64);
const MANIFEST_HASH = 'd'.repeat(64);
const CHUNK_HASH = 'e'.repeat(64);
const UPLOAD_ID = 'runtime-upload-1';
const LOCAL_AGENT_REF = 'local-agent:runtime-created-1';

test('materialization helper uses Runtime challenge, Realm packet v2, ordered chunks, and Commit', async () => {
  const calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }> = [];
  const runtime = materializationRuntime(calls);
  let realmBody: CreateSourceMaterializationPacketDto | undefined;
  const surface = createNimiHostRuntimeAgentMaterializationSurface({
    getRuntime: () => ({
      appId: 'nimi.desktop',
      auth: {} as never,
      agent: runtime,
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (scopes, operation) => {
      assert.deepEqual(scopes, ['runtime.agent.admin']);
      return operation({ metadata: { scopes: scopes.join(' ') } });
    },
  });

  const result = await surface.materializeRealmSource({
    sourceRef: SOURCE_REF,
    requestId: 'materialize-request-1',
    realm: {
      generated: {
        async worldCoreControllerCreateSourceMaterializationPacket(request: { body: CreateSourceMaterializationPacketDto }) {
          realmBody = request.body;
          return packetFor(request.body);
        },
      } as never,
    },
    emitRealmDataError() {},
  });

  assert.equal(realmBody?.challengeId, CHALLENGE_ID);
  assert.equal(realmBody?.challengeDigest, CHALLENGE_DIGEST);
  assert.equal(realmBody?.intendedRuntimeAudience, AUDIENCE);
  assert.equal(realmBody?.materializerAccountId, OWNER_USER_ID);
  assert.deepEqual(calls.map((call) => call.method), [
    'challenge',
    'begin',
    'put',
    'commit',
  ]);
  const challengeContext = calls[0]?.request.context as Record<string, unknown>;
  assert.equal(challengeContext.runtimeSourceRef, `runtime-source:worldCharacter:world-1:character-1:${SOURCE_REF.sourceContentHash}`);
  assert.equal(challengeContext.localAgentRef, '');
  assert.equal((calls[2]?.request.bytes as Uint8Array).byteLength, 2);
  assert.equal(result.localAgentRef, LOCAL_AGENT_REF);
  assert.equal(result.sourceContextStatus.snapshotHash, 'f'.repeat(64));
});

test('materialization helper uses the same challenge and upload path for RealmPersona', async () => {
  const calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }> = [];
  const personaSourceRef = {
    kind: 'realmPersona',
    worldId: 'world-2',
    sourceId: 'persona-1',
    sourceContentHash: '6'.repeat(64),
  } as const;
  const runtimePersonaSourceRef: SourceMaterializationSourceRef = {
    kind: AgentSourceMaterializationSourceKind.REALM_PERSONA,
    worldId: personaSourceRef.worldId,
    sourceId: personaSourceRef.sourceId,
    sourceContentHash: personaSourceRef.sourceContentHash,
  };
  const surface = createNimiHostRuntimeAgentMaterializationSurface({
    getRuntime: () => ({
      appId: 'nimi.desktop',
      auth: {} as never,
      agent: materializationRuntime(calls, { sourceRef: runtimePersonaSourceRef }),
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (_scopes, operation) => operation({}),
  });

  const result = await surface.materializeRealmSource({
    sourceRef: personaSourceRef,
    requestId: 'materialize-persona-1',
    realm: {
      generated: {
        async worldCoreControllerCreateSourceMaterializationPacket(request: { body: CreateSourceMaterializationPacketDto }) {
          return packetFor(request.body);
        },
      } as never,
    },
    emitRealmDataError() {},
  });

  assert.deepEqual(calls.map((call) => call.method), ['challenge', 'begin', 'put', 'commit']);
  assert.equal(
    result.runtimeSourceRef,
    `runtime-source:realmPersona:world-2:persona-1:${personaSourceRef.sourceContentHash}`,
  );
  assert.equal(result.sourceContextStatus.sourceRef.kind, 'realmPersona');
});

test('materialization helper aborts an open upload and preserves the original post-Begin error', async () => {
  const calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }> = [];
  const original = new Error('put failed');
  const runtime = materializationRuntime(calls, {
    async put() {
      throw original;
    },
    async abort() {
      throw new Error('abort failed');
    },
  });
  const surface = createNimiHostRuntimeAgentMaterializationSurface({
    getRuntime: () => ({
      appId: 'nimi.desktop',
      auth: {} as never,
      agent: runtime,
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (_scopes, operation) => operation({}),
  });

  await assert.rejects(
    () => surface.materializeRealmSource({
      sourceRef: SOURCE_REF,
      requestId: 'materialize-request-failure',
      realm: {
        generated: {
          async worldCoreControllerCreateSourceMaterializationPacket(request: { body: CreateSourceMaterializationPacketDto }) {
            return packetFor(request.body);
          },
        } as never,
      },
      emitRealmDataError() {},
    }),
    (error: unknown) => error === original,
  );
  assert.deepEqual(calls.map((call) => call.method), ['challenge', 'begin', 'put', 'abort']);
  assert.equal(calls[3]?.request.abortRequestId, 'materialize-request-failure:abort');
});

test('materialization helper rejects unknown Runtime enums before requesting Realm packet', async () => {
  let realmCalled = false;
  const runtime = materializationRuntime([]);
  runtime.createSourceMaterializationChallenge = async () => ({
    ...challengeResponse(),
    state: 99,
  });
  const surface = createNimiHostRuntimeAgentMaterializationSurface({
    getRuntime: () => ({
      appId: 'nimi.desktop',
      auth: {} as never,
      agent: runtime,
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (_scopes, operation) => operation({}),
  });

  await assert.rejects(() => surface.materializeRealmSource({
    sourceRef: SOURCE_REF,
    requestId: 'materialize-request-unknown-enum',
    realm: {
      generated: {
        async worldCoreControllerCreateSourceMaterializationPacket(request: { body: CreateSourceMaterializationPacketDto }) {
          realmCalled = true;
          return packetFor(request.body);
        },
      } as never,
    },
    emitRealmDataError() {},
  }), /Unknown AgentSourceMaterializationChallengeState numeric value/u);
  assert.equal(realmCalled, false);
});

test('materialization helper rejects mismatched or partial READY source status', async (t) => {
  const cases: Array<{
    readonly name: string;
    readonly mutate: (response: CommitSourceMaterializationResponse) => CommitSourceMaterializationResponse;
  }> = [
    {
      name: 'localAgentRef mismatch',
      mutate: (response) => ({
        ...response,
        sourceContextStatus: {
          ...response.sourceContextStatus!,
          localAgentRef: 'local-agent:different-runtime-agent',
        },
      }),
    },
    {
      name: 'sourceRef mismatch',
      mutate: (response) => ({
        ...response,
        sourceContextStatus: {
          ...response.sourceContextStatus!,
          sourceRef: {
            ...response.sourceContextStatus!.sourceRef!,
            sourceId: 'different-source',
          },
        },
      }),
    },
    {
      name: 'digest and coverage mismatch',
      mutate: (response) => ({
        ...response,
        sourceContextStatus: {
          ...response.sourceContextStatus!,
          snapshotHash: '',
          coverageSections: [{
            section: AgentLocalSourceCoverageSection.WORLD_CORE,
            state: AgentLocalSourceCoverageState.COMPLETE,
            requiredCount: 2,
            resolvedCount: 1,
            omittedCount: 0,
          }],
        },
      }),
    },
    {
      name: 'timestamp and context hash mismatch',
      mutate: (response) => ({
        ...response,
        sourceContextStatus: {
          ...response.sourceContextStatus!,
          capturedAt: undefined,
          worldContentHash: '',
          materializationContextHash: '',
        },
      }),
    },
    {
      name: 'source schema mismatch',
      mutate: (response) => ({
        ...response,
        sourceContextStatus: {
          ...response.sourceContextStatus!,
          sourceSchemaVersion: 'realm.persona/v1',
        },
      }),
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }> = [];
      const surface = createNimiHostRuntimeAgentMaterializationSurface({
        getRuntime: () => ({
          appId: 'nimi.desktop',
          auth: {} as never,
          agent: materializationRuntime(calls, { commitResponse: testCase.mutate }),
        }),
        getSubjectUserId: () => OWNER_USER_ID,
        withScopes: async (_scopes, operation) => operation({}),
      });

      await assert.rejects(
        () => surface.materializeRealmSource({
          sourceRef: SOURCE_REF,
          requestId: `materialize-invalid-status-${testCase.name}`,
          realm: {
            generated: {
              async worldCoreControllerCreateSourceMaterializationPacket(request: { body: CreateSourceMaterializationPacketDto }) {
                return packetFor(request.body);
              },
            } as never,
          },
          emitRealmDataError() {},
        }),
        (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_MATERIALIZATION_RESPONSE_INVALID',
      );
      assert.deepEqual(calls.map((call) => call.method), ['challenge', 'begin', 'put', 'commit', 'abort']);
    });
  }
});

function materializationRuntime(
  calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }>,
  overrides: {
    readonly put?: NimiRuntimeAgentMaterializationModule['putSourceMaterializationChunk'];
    readonly abort?: NimiRuntimeAgentMaterializationModule['abortSourceMaterializationUpload'];
    readonly sourceRef?: SourceMaterializationSourceRef;
    readonly commitResponse?: (response: CommitSourceMaterializationResponse) => CommitSourceMaterializationResponse;
  } = {},
): NimiRuntimeAgentMaterializationModule {
  const sourceRef = overrides.sourceRef ?? RUNTIME_SOURCE_REF;
  return {
    async createSourceMaterializationChallenge(request) {
      calls.push({ method: 'challenge', request: request as unknown as Record<string, unknown> });
      return challengeResponse(sourceRef);
    },
    async beginSourceMaterializationUpload(request) {
      calls.push({ method: 'begin', request: request as unknown as Record<string, unknown> });
      return {
        uploadId: UPLOAD_ID,
        packetHash: PACKET_HASH,
        bundleManifestHash: MANIFEST_HASH,
        uploadState: AgentSourceMaterializationUploadState.OPEN,
        challengeState: AgentSourceMaterializationChallengeState.LEASED,
        reasonCode: AgentSourceMaterializationReasonCode.NONE,
        expiresAt: toNimiRuntimeTimestamp('2099-01-01T00:05:00.000Z'),
      };
    },
    async putSourceMaterializationChunk(request, options) {
      calls.push({ method: 'put', request: request as unknown as Record<string, unknown> });
      if (overrides.put) return overrides.put(request, options);
      return {
        uploadId: UPLOAD_ID,
        globalOrdinal: 0,
        componentId: 'component-1',
        idempotentReplay: false,
        uploadState: AgentSourceMaterializationUploadState.OPEN,
        reasonCode: AgentSourceMaterializationReasonCode.NONE,
      };
    },
    async commitSourceMaterialization(request) {
      calls.push({ method: 'commit', request: request as unknown as Record<string, unknown> });
      const response: CommitSourceMaterializationResponse = {
        uploadId: UPLOAD_ID,
        localAgentRef: LOCAL_AGENT_REF,
        uploadState: AgentSourceMaterializationUploadState.COMMITTED,
        challengeState: AgentSourceMaterializationChallengeState.CONSUMED,
        reasonCode: AgentSourceMaterializationReasonCode.NONE,
        sourceContextStatus: {
          schemaVersion: AgentLocalSourceContextSchemaVersion.V1,
          ready: true,
          state: AgentLocalSourceContextState.READY,
          reasonCode: AgentContextProjectionReasonCode.NONE,
          localAgentRef: LOCAL_AGENT_REF,
          sourceRef,
          sourceSchemaVersion: sourceRef.kind === AgentSourceMaterializationSourceKind.REALM_PERSONA
            ? 'realm.persona/v1'
            : 'realm.world-character-core/v1',
          snapshotSchemaVersion: AgentLocalSourceSnapshotSchemaVersion.V1,
          snapshotHash: 'f'.repeat(64),
          capturedAt: toNimiRuntimeTimestamp('2099-01-01T00:00:01.000Z'),
          worldContentHash: '1'.repeat(64),
          materializationContextHash: '2'.repeat(64),
          coverageSections: sourceCoverage(sourceRef.kind),
        },
      };
      return overrides.commitResponse ? overrides.commitResponse(response) : response;
    },
    async abortSourceMaterializationUpload(request, options) {
      calls.push({ method: 'abort', request: request as unknown as Record<string, unknown> });
      if (overrides.abort) return overrides.abort(request, options);
      return {
        uploadId: UPLOAD_ID,
        uploadState: AgentSourceMaterializationUploadState.ABORTED,
        challengeState: AgentSourceMaterializationChallengeState.INVALIDATED,
        reasonCode: AgentSourceMaterializationReasonCode.ABORTED,
        idempotentReplay: false,
      };
    },
  };
}

function sourceCoverage(kind: AgentSourceMaterializationSourceKind) {
  const complete = (section: AgentLocalSourceCoverageSection) => ({
    section,
    state: AgentLocalSourceCoverageState.COMPLETE,
    requiredCount: 1,
    resolvedCount: 1,
    omittedCount: 0,
  });
  const sourceSections = kind === AgentSourceMaterializationSourceKind.REALM_PERSONA
    ? [
        AgentLocalSourceCoverageSection.IDENTITY,
        AgentLocalSourceCoverageSection.PRESENTATION,
        AgentLocalSourceCoverageSection.INTERACTION_PROFILE,
        AgentLocalSourceCoverageSection.ASSETS,
        AgentLocalSourceCoverageSection.AUTHORING,
        AgentLocalSourceCoverageSection.PERSONA_STYLE,
        AgentLocalSourceCoverageSection.CONTENT_PROFILE,
      ]
    : [
        AgentLocalSourceCoverageSection.IDENTITY,
        AgentLocalSourceCoverageSection.PRESENTATION,
        AgentLocalSourceCoverageSection.PLACEMENT,
        AgentLocalSourceCoverageSection.BIOGRAPHY,
        AgentLocalSourceCoverageSection.PSYCHOLOGY,
        AgentLocalSourceCoverageSection.KNOWLEDGE,
        AgentLocalSourceCoverageSection.RELATIONSHIPS,
        AgentLocalSourceCoverageSection.CAPABILITIES,
        AgentLocalSourceCoverageSection.INTERACTION_PROFILE,
        AgentLocalSourceCoverageSection.ASSETS,
        AgentLocalSourceCoverageSection.AUTHORING,
      ];
  return [
    ...sourceSections.map(complete),
    complete(AgentLocalSourceCoverageSection.WORLD_CORE),
    ...(kind === AgentSourceMaterializationSourceKind.WORLD_CHARACTER
      ? [complete(AgentLocalSourceCoverageSection.BOUND_ENTITY)]
      : []),
    complete(AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE),
  ];
}

function challengeResponse(sourceRef: SourceMaterializationSourceRef = RUNTIME_SOURCE_REF) {
  return {
    challengeId: CHALLENGE_ID,
    intendedRuntimeAudience: AUDIENCE,
    challengeDigest: CHALLENGE_DIGEST,
    expiresAt: toNimiRuntimeTimestamp('2099-01-01T00:05:00.000Z'),
    limits: {
      maxBundleBytes: '1024',
      maxComponentCount: 8,
      maxChunkBytes: '64',
      maxChunks: 16,
    },
    state: AgentSourceMaterializationChallengeState.ISSUED,
    reasonCode: AgentSourceMaterializationReasonCode.NONE,
    sourceRef,
    materializerAccountId: OWNER_USER_ID,
  };
}

function packetFor(request: CreateSourceMaterializationPacketDto): SourceMaterializationPacketV2Dto {
  const componentKind = request.sourceRef.kind;
  const componentSchemaVersion = componentKind === 'realmPersona'
    ? 'realm.persona/v1'
    : 'realm.world-character-core/v1';
  return {
    packetSchemaVersion: 'realm.source-materialization-packet/v2',
    packetId: 'packet-1',
    issuer: 'https://realm.example.test',
    keyId: 'materialization-key-1',
    algorithm: 'RS256',
    keyUse: 'sig',
    issuedAt: '2099-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:05:00.000Z',
    nonce: 'nonce-1',
    intendedRuntimeAudience: request.intendedRuntimeAudience,
    challengeId: request.challengeId,
    challengeDigest: request.challengeDigest,
    challengeLimits: request.challengeLimits,
    materializerAccountId: request.materializerAccountId,
    sourceRef: request.sourceRef,
    payloadHash: '3'.repeat(64),
    bundleManifestHash: MANIFEST_HASH,
    packetHash: PACKET_HASH,
    packetProof: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Im1hdGVyaWFsaXphdGlvbi1rZXktMSIsInR5cCI6InJlYWxtLXNvdXJjZS1tYXRlcmlhbGl6YXRpb24ifQ..c2lnbmF0dXJl',
    semanticPayload: {} as never,
    bundleTransportManifest: {
      manifestSchemaVersion: 'realm.materialization-bundle-manifest/v1',
      payloadAssemblyVersion: 'realm.materialization-assembly/v1',
      packetId: 'packet-1',
      challengeDigest: request.challengeDigest,
      totalCanonicalBytes: 2,
      componentCount: 1,
      chunkCount: 1,
      components: [{
        componentId: 'component-1',
        kind: componentKind,
        schemaVersion: componentSchemaVersion,
        revision: 1,
        contentHash: '4'.repeat(64),
        canonicalBytesHash: '5'.repeat(64),
        canonicalByteLength: 2,
      }],
      chunks: [{
        globalOrdinal: 0,
        componentOffset: 0,
        length: 2,
        chunkSha256: CHUNK_HASH,
      }],
    },
    orderedComponentChunks: [{
      componentId: 'component-1',
      kind: componentKind,
      schemaVersion: componentSchemaVersion,
      revision: 1,
      contentHash: '4'.repeat(64),
      canonicalBytesHash: '5'.repeat(64),
      canonicalByteLength: 2,
      canonicalBytes: [{
        globalOrdinal: 0,
        componentOffset: 0,
        length: 2,
        chunkSha256: CHUNK_HASH,
        bytesBase64: 'e30=',
      }],
    }],
  };
}
