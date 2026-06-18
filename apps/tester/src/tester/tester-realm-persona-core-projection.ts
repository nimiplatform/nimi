import type {
  CreateRealmPersonaDto,
  CreateRuntimeSourceSnapshotDto,
  RealmPersonaDto,
  RealmWorldCoreModule,
  RuntimeSourceSnapshotDto,
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

function createTesterRuntimeSnapshot(input: CreateRuntimeSourceSnapshotDto): RuntimeSourceSnapshotDto {
  return {
    capturedAt: '2026-06-18T00:00:01.000Z',
    payload: {
      persona: testerPersonaCore.core,
      sourceRef: input.sourceRef,
    },
    payloadHash: 'tester-runtime-source-snapshot-hash',
    runtimeSourceRef: `runtime-source:${input.sourceRef.kind}:${input.sourceRef.sourceId}:${input.sourceRef.sourceContentHash}`,
    snapshotId: 'tester-runtime-source-snapshot',
    snapshotSchemaVersion: 'runtime-source-snapshot.v1',
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
    worldCoreControllerCreateRuntimeSourceSnapshot: async (request: { body: CreateRuntimeSourceSnapshotDto }) => createTesterRuntimeSnapshot(request.body),
    worldCoreControllerCreateWorldCharacter: async () => {
      throw new Error('Tester persona core projection does not create WorldCharacterCore.');
    },
    worldCoreControllerCreateWorldCore: async () => testerWorldCore,
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
    worldCoreControllerListRealmPersonas: async () => [testerPersonaCore],
    worldCoreControllerListWorldCharacters: async () => [],
    worldCoreControllerListWorldCores: async () => [testerWorldCore],
    worldCoreControllerReplaceRealmPersona: async () => testerPersonaCore,
    worldCoreControllerReplaceWorldCharacter: async () => {
      throw new Error('Tester persona core projection does not replace WorldCharacterCore.');
    },
    worldCoreControllerReplaceWorldCore: async () => testerWorldCore,
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
    worldCore.worldCoreControllerCreateRuntimeSourceSnapshot({
      path: {},
      body: {
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
