import type {
  CreateRealmPersonaDto,
  CreateSourceMaterializationPacketDto,
  RealmPersonaDto,
  RealmWorldCoreModule,
  SourceMaterializationPacketDto,
  WorldCoreDto,
} from '@nimiplatform/sdk/realm';

export type TesterRealmPersonaCoreProjection = {
  personaId: string;
  worldCount: number;
  homeWorldId: string;
  runtimeSourceKind: string;
  sourceWorldId: string;
};

const testerWorldCore: WorldCoreDto = {
  contentHash: 'tester-world-core-hash',
  contentRevision: 1,
  core: {
    identity: { id: 'tester-world', name: 'Tester World' },
    timeline: { timeScale: 'slow' },
  },
  createdAt: '2026-06-18T00:00:00.000Z',
  creatorId: 'tester-user',
  id: 'tester-world',
  origin: { kind: 'manual' },
  schemaVersion: 'world-core.v1',
  updatedAt: '2026-06-18T00:00:00.000Z',
  visibility: 'private',
};

const testerPersonaCore: RealmPersonaDto = {
  contentHash: 'tester-persona-core-hash',
  contentRevision: 1,
  core: {
    identity: { id: 'tester-persona', name: 'Tester Persona' },
    voice: { style: 'precise' },
  },
  createdAt: '2026-06-18T00:00:00.000Z',
  homeWorldId: 'tester-world',
  id: 'tester-persona',
  origin: { kind: 'manual', parentWorldId: 'tester-world' },
  ownerId: 'tester-user',
  schemaVersion: 'realm-persona.v1',
  updatedAt: '2026-06-18T00:00:00.000Z',
  visibility: 'public',
};

function createTesterSourceMaterializationPacket(input: CreateSourceMaterializationPacketDto): SourceMaterializationPacketDto {
  return {
    expiresAt: '2026-06-18T00:05:01.000Z',
    intendedRuntimeAudience: input.intendedRuntimeAudience,
    issuedAt: '2026-06-18T00:00:01.000Z',
    nonce: 'tester-packet-nonce',
    packetHash: 'tester-source-materialization-packet-hash',
    packetId: 'tester-source-materialization-packet',
    packetProof: 'hmac-sha256:tester-proof',
    packetSchemaVersion: 'realm.source-materialization-packet/v1',
    payload: {
      persona: testerPersonaCore.core,
      sourceRef: input.sourceRef,
    },
    runtimeSourceRef: `runtime-source:${input.sourceRef.kind}:${input.sourceRef.sourceId}:${input.sourceRef.sourceContentHash}`,
    sourceDisplayMetadata: {
      displayName: 'Tester Persona',
      handle: 'tester-persona',
    },
    sourceContentHash: input.sourceRef.sourceContentHash,
    sourceContentRevision: testerPersonaCore.contentRevision,
    sourceId: input.sourceRef.sourceId,
    sourceKind: input.sourceRef.kind,
    sourceWorldId: input.sourceRef.worldId,
  };
}

export async function loadTesterRealmPersonaCoreProjection(): Promise<TesterRealmPersonaCoreProjection> {
  const worldCore: RealmWorldCoreModule = {
    worldCoreControllerBootstrapOasisWorld: async () => testerWorldCore,
    worldCoreControllerCreateRealmPersona: async (request: { body: CreateRealmPersonaDto }) => ({
      ...testerPersonaCore,
      core: request.body.core,
      homeWorldId: request.body.homeWorldId ?? testerPersonaCore.homeWorldId,
      id: request.body.id ?? testerPersonaCore.id,
      origin: request.body.origin,
    }),
    worldCoreControllerCreateSourceMaterializationPacket: async (request: { body: CreateSourceMaterializationPacketDto }) => createTesterSourceMaterializationPacket(request.body),
    worldCoreControllerCreateWorldCharacter: async () => {
      throw new Error('Tester persona core projection does not create WorldCharacterCore.');
    },
    worldCoreControllerCreateWorldCore: async () => testerWorldCore,
    worldCoreControllerCreateWorldEntity: async () => {
      throw new Error('Tester persona core projection does not create WorldEntityCore.');
    },
    worldCoreControllerCreateWorldRelationship: async () => {
      throw new Error('Tester persona core projection does not create WorldRelationshipCore.');
    },
    worldCoreControllerGetOasisWorld: async () => testerWorldCore,
    worldCoreControllerGetRealmPersona: async (request: { path: { personaId: string } }) => ({
      ...testerPersonaCore,
      id: request.path.personaId,
    }),
    worldCoreControllerGetWorldCharacter: async () => {
      throw new Error('Tester persona core projection does not read WorldCharacterCore.');
    },
    worldCoreControllerGetWorldCore: async (request: { path: { worldId: string } }) => ({
      ...testerWorldCore,
      id: request.path.worldId,
    }),
    worldCoreControllerGetWorldEntity: async () => {
      throw new Error('Tester persona core projection does not read WorldEntityCore.');
    },
    worldCoreControllerGetWorldRelationship: async () => {
      throw new Error('Tester persona core projection does not read WorldRelationshipCore.');
    },
    worldCoreControllerListRealmPersonas: async () => [testerPersonaCore],
    worldCoreControllerListWorldCharacters: async () => [],
    worldCoreControllerListWorldCores: async () => [testerWorldCore],
    worldCoreControllerListWorldEntities: async () => [],
    worldCoreControllerListWorldRelationships: async () => [],
    worldCoreControllerReplaceRealmPersona: async () => testerPersonaCore,
    worldCoreControllerReplaceWorldCharacter: async () => {
      throw new Error('Tester persona core projection does not replace WorldCharacterCore.');
    },
    worldCoreControllerReplaceWorldCore: async () => testerWorldCore,
    worldCoreControllerReplaceWorldEntity: async () => {
      throw new Error('Tester persona core projection does not replace WorldEntityCore.');
    },
    worldCoreControllerReplaceWorldRelationship: async () => {
      throw new Error('Tester persona core projection does not replace WorldRelationshipCore.');
    },
  } as RealmWorldCoreModule;

  const [worlds, persona, snapshot] = await Promise.all([
    worldCore.worldCoreControllerListWorldCores({ path: {}, query: { take: 1 }, body: {} }),
    worldCore.worldCoreControllerCreateRealmPersona({
      path: {},
      body: {
        core: testerPersonaCore.core,
        homeWorldId: testerPersonaCore.homeWorldId,
        id: testerPersonaCore.id,
        origin: testerPersonaCore.origin,
        visibility: testerPersonaCore.visibility,
      },
    }),
    worldCore.worldCoreControllerCreateSourceMaterializationPacket({
      path: {},
      body: {
        intendedRuntimeAudience: 'tester.runtime',
        sourceRef: {
          kind: 'realmPersona',
          sourceContentHash: testerPersonaCore.contentHash,
          sourceId: testerPersonaCore.id,
          worldId: testerPersonaCore.homeWorldId,
        },
      },
    }),
  ]);

  return {
    personaId: persona.id,
    worldCount: worlds.length,
    homeWorldId: persona.homeWorldId,
    runtimeSourceKind: snapshot.sourceKind,
    sourceWorldId: snapshot.sourceWorldId,
  };
}
