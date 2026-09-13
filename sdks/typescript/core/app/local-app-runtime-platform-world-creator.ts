import type { RealmModel } from '../../realm/generated.js';
import { asRecord, assertExactKeys, assertSafeProjection, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiLocalAppWorldCharacterListInput = {
  readonly visibility?: 'private' | 'unlisted' | 'public' | 'system';
  readonly afterId?: string;
  readonly take?: number;
};

export type NimiLocalAppWorldEntityListInput = {
  readonly kind?: string;
  readonly afterId?: string;
  readonly take?: number;
};

export type NimiLocalAppWorldRelationshipListInput = {
  readonly entityId?: string;
  readonly sourceEntityId?: string;
  readonly targetEntityId?: string;
  readonly type?: string;
  readonly afterId?: string;
  readonly take?: number;
};

export type NimiLocalAppWorldCreatorShell = {
  readonly getCreationEligibility: () => Promise<unknown>;
  readonly get: (worldId: string) => Promise<unknown>;
  readonly replace: (worldId: string, input: unknown) => Promise<unknown>;
  readonly listCharacters: (worldId: string, input?: NimiLocalAppWorldCharacterListInput) => Promise<unknown>;
  readonly getCharacter: (characterId: string) => Promise<unknown>;
  readonly createCharacter: (worldId: string, input: unknown) => Promise<unknown>;
  readonly replaceCharacter: (characterId: string, input: unknown) => Promise<unknown>;
  readonly listEntities: (worldId: string, input?: NimiLocalAppWorldEntityListInput) => Promise<unknown>;
  readonly getEntity: (entityId: string) => Promise<unknown>;
  readonly createEntity: (worldId: string, input: unknown) => Promise<unknown>;
  readonly listRelationships: (worldId: string, input?: NimiLocalAppWorldRelationshipListInput) => Promise<unknown>;
  readonly getRelationship: (relationshipId: string) => Promise<unknown>;
};

export type NimiLocalAppWorldCreatorClient = {
  readonly getCreationEligibility: () => Promise<RealmModel<'WorldCreationEligibilityDto'>>;
  readonly get: (worldId: string) => Promise<RealmModel<'WorldCoreDto'>>;
  readonly replace: (worldId: string, input: RealmModel<'ReplaceWorldCoreDto'>) => Promise<RealmModel<'WorldCoreDto'>>;
  readonly listCharacters: (worldId: string, input?: NimiLocalAppWorldCharacterListInput) => Promise<readonly RealmModel<'WorldCharacterCoreDto'>[]>;
  readonly getCharacter: (characterId: string) => Promise<RealmModel<'WorldCharacterCoreDto'>>;
  readonly createCharacter: (worldId: string, input: RealmModel<'CreateWorldCharacterCoreDto'>) => Promise<RealmModel<'WorldCharacterCoreDto'>>;
  readonly replaceCharacter: (characterId: string, input: RealmModel<'ReplaceWorldCharacterCoreDto'>) => Promise<RealmModel<'WorldCharacterCoreDto'>>;
  readonly listEntities: (worldId: string, input?: NimiLocalAppWorldEntityListInput) => Promise<readonly RealmModel<'WorldEntityCoreDto'>[]>;
  readonly getEntity: (entityId: string) => Promise<RealmModel<'WorldEntityCoreDto'>>;
  readonly createEntity: (worldId: string, input: RealmModel<'CreateWorldEntityCoreDto'>) => Promise<RealmModel<'WorldEntityCoreDto'>>;
  readonly listRelationships: (worldId: string, input?: NimiLocalAppWorldRelationshipListInput) => Promise<readonly RealmModel<'WorldRelationshipCoreDto'>[]>;
  readonly getRelationship: (relationshipId: string) => Promise<RealmModel<'WorldRelationshipCoreDto'>>;
};

// @nimi-authority: rule.nimi.platform.core-protocol.world-creator-app-operations
export function createNimiLocalAppWorldCreatorClient(shell: NimiLocalAppWorldCreatorShell): NimiLocalAppWorldCreatorClient {
  return Object.freeze({
    getCreationEligibility: async (): Promise<RealmModel<'WorldCreationEligibilityDto'>> => {
      const value = closedRecord(await shell.getCreationEligibility(), ['canCreateWorld'], ['canCreateWorld'], 'world creation eligibility', true);
      if (typeof value.canCreateWorld !== 'boolean') localAppProjectionError('world creation eligibility');
      return Object.freeze({ canCreateWorld: value.canCreateWorld });
    },
    get: async (worldId: string): Promise<RealmModel<'WorldCoreDto'>> => {
      creatorId(worldId, 'worldId');
      const value = await shell.get(worldId);
      const record = creatorResult(value, 'world', worldId, undefined);
      return record as unknown as RealmModel<'WorldCoreDto'>;
    },
    replace: async (worldId: string, input: RealmModel<'ReplaceWorldCoreDto'>): Promise<RealmModel<'WorldCoreDto'>> => {
      creatorId(worldId, 'worldId');
      validateCreatorWrite(input, 'world', true, worldId);
      const value = await shell.replace(worldId, input);
      const record = creatorResult(value, 'world', worldId, undefined);
      assertCreatorWriteResult(record, input, 'world');
      return record as unknown as RealmModel<'WorldCoreDto'>;
    },
    listCharacters: async (worldId: string, input: NimiLocalAppWorldCharacterListInput = {}): Promise<readonly RealmModel<'WorldCharacterCoreDto'>[]> => {
      creatorId(worldId, 'worldId');
      const query = creatorQuery(input, ['visibility', 'afterId', 'take']);
      const value = await shell.listCharacters(worldId, query);
      if (!Array.isArray(value) || value.length > 500) localAppProjectionError('WorldCharacterCoreDto list');
      return Object.freeze(value.map(item => creatorResult(item, 'character', undefined, worldId))) as unknown as readonly RealmModel<'WorldCharacterCoreDto'>[];
    },
    getCharacter: async (characterId: string): Promise<RealmModel<'WorldCharacterCoreDto'>> => {
      creatorId(characterId, 'characterId');
      const value = await shell.getCharacter(characterId);
      const record = creatorResult(value, 'character', characterId, undefined);
      return record as unknown as RealmModel<'WorldCharacterCoreDto'>;
    },
    createCharacter: async (worldId: string, input: RealmModel<'CreateWorldCharacterCoreDto'>): Promise<RealmModel<'WorldCharacterCoreDto'>> => {
      creatorId(worldId, 'worldId');
      validateCreatorWrite(input, 'character', false, undefined);
      if (input.worldEntityRef.worldId !== worldId) invalidInput('worldEntityRef.worldId');
      const value = await shell.createCharacter(worldId, input);
      const record = creatorResult(value, 'character', input.id, worldId);
      assertCreatorWriteResult(record, input, 'character');
      return record as unknown as RealmModel<'WorldCharacterCoreDto'>;
    },
    replaceCharacter: async (characterId: string, input: RealmModel<'ReplaceWorldCharacterCoreDto'>): Promise<RealmModel<'WorldCharacterCoreDto'>> => {
      creatorId(characterId, 'characterId');
      validateCreatorWrite(input, 'character', true, characterId);
      const value = await shell.replaceCharacter(characterId, input);
      const record = creatorResult(value, 'character', characterId, undefined);
      assertCreatorWriteResult(record, input, 'character');
      return record as unknown as RealmModel<'WorldCharacterCoreDto'>;
    },
    listEntities: async (worldId: string, input: NimiLocalAppWorldEntityListInput = {}): Promise<readonly RealmModel<'WorldEntityCoreDto'>[]> => {
      creatorId(worldId, 'worldId');
      const query = creatorQuery(input, ['kind', 'afterId', 'take']);
      const value = await shell.listEntities(worldId, query);
      if (!Array.isArray(value) || value.length > 500) localAppProjectionError('WorldEntityCoreDto list');
      return Object.freeze(value.map(item => creatorResult(item, 'entity', undefined, worldId))) as unknown as readonly RealmModel<'WorldEntityCoreDto'>[];
    },
    getEntity: async (entityId: string): Promise<RealmModel<'WorldEntityCoreDto'>> => {
      creatorId(entityId, 'entityId');
      const value = await shell.getEntity(entityId);
      const record = creatorResult(value, 'entity', entityId, undefined);
      return record as unknown as RealmModel<'WorldEntityCoreDto'>;
    },
    createEntity: async (worldId: string, input: RealmModel<'CreateWorldEntityCoreDto'>): Promise<RealmModel<'WorldEntityCoreDto'>> => {
      creatorId(worldId, 'worldId');
      validateCreatorWrite(input, 'entity', false, undefined);
      const value = await shell.createEntity(worldId, input);
      const record = creatorResult(value, 'entity', input.id, worldId);
      assertCreatorWriteResult(record, input, 'entity');
      return record as unknown as RealmModel<'WorldEntityCoreDto'>;
    },
    listRelationships: async (worldId: string, input: NimiLocalAppWorldRelationshipListInput = {}): Promise<readonly RealmModel<'WorldRelationshipCoreDto'>[]> => {
      creatorId(worldId, 'worldId');
      const query = creatorQuery(input, ['entityId', 'sourceEntityId', 'targetEntityId', 'type', 'afterId', 'take']);
      const value = await shell.listRelationships(worldId, query);
      if (!Array.isArray(value) || value.length > 500) localAppProjectionError('WorldRelationshipCoreDto list');
      return Object.freeze(value.map(item => creatorResult(item, 'relationship', undefined, worldId))) as unknown as readonly RealmModel<'WorldRelationshipCoreDto'>[];
    },
    getRelationship: async (relationshipId: string): Promise<RealmModel<'WorldRelationshipCoreDto'>> => {
      creatorId(relationshipId, 'relationshipId');
      const value = await shell.getRelationship(relationshipId);
      const record = creatorResult(value, 'relationship', relationshipId, undefined);
      return record as unknown as RealmModel<'WorldRelationshipCoreDto'>;
    },
  });
}

type CreatorFamily = 'world' | 'character' | 'entity' | 'relationship';
function invalidInput(field: string): never {
  return localAppError(`World creator input is invalid: ${field}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_typed_world_creator_input');
}
function creatorId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 512 || value.includes('\0')) invalidInput(field);
}
function creatorQuery(input: object, keys: readonly string[]): Record<string, string | number> {
  assertExactKeys(input, keys, 'world creator list');
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'take') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 500) invalidInput(key);
      result[key] = value;
    } else {
      creatorId(value, key);
      if (key === 'visibility' && !['private', 'unlisted', 'public', 'system'].includes(value)) invalidInput(key);
      result[key] = value;
    }
  }
  return result;
}
function creatorJSON(value: unknown, output = false): void {
  const fail = () => output ? localAppProjectionError('world creator JSON') : invalidInput('JSON');
  let text: string;
  try { text = JSON.stringify(value); } catch { return fail(); }
  if (!text || new TextEncoder().encode(text).length > (output ? 1048576 : 2097152)) fail();
}
function closedRecord(value: unknown, allowed: readonly string[], required: readonly string[], field: string, output = false): Record<string, unknown> {
  const record = asRecord(value);
  if (!record || Object.keys(record).some(key => !allowed.includes(key)) || required.some(key => record[key] === undefined)) {
    return output ? localAppProjectionError(field) : invalidInput(field);
  }
  return record;
}
function entityRef(value: unknown, output = false): Record<string, unknown> {
  const ref = closedRecord(value, ['kind', 'worldId', 'entityId'], ['kind', 'worldId', 'entityId'], 'worldEntityRef', output);
  if (ref.kind !== 'worldEntity' || typeof ref.worldId !== 'string' || !ref.worldId || typeof ref.entityId !== 'string' || !ref.entityId) {
    return output ? localAppProjectionError('worldEntityRef') : invalidInput('worldEntityRef');
  }
  return ref;
}
function validateCreatorWrite(value: unknown, family: CreatorFamily, replace: boolean, id?: string): void {
  const required = family === 'world' ? ['core', 'lorebookDeclaration', 'origin'] : family === 'character' ? ['profile', 'worldEntityRef', 'lorebookDeclaration', 'origin'] : ['core', 'kind', 'origin'];
  const allowed = [...required, 'id', ...(family === 'entity' ? [] : ['visibility']), ...(replace ? ['baseContentHash'] : [])];
  const record = closedRecord(value, allowed, [...required, ...(replace ? ['baseContentHash'] : [])], 'world creator write');
  if (record.id !== undefined) { creatorId(record.id, 'id'); if (replace && record.id !== id) invalidInput('immutable id'); }
  if (replace && (typeof record.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.baseContentHash))) invalidInput('baseContentHash');
  if (record.visibility !== undefined && !['private', 'unlisted', 'public'].includes(String(record.visibility))) invalidInput('visibility');
  const origin = closedRecord(record.origin, ['kind', 'parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion'], ['kind'], 'origin');
  if (!['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(String(origin.kind))) invalidInput('origin.kind');
  if (family === 'character') {
    entityRef(record.worldEntityRef);
    const profile = asRecord(record.profile);
    if (!profile || Object.hasOwn(profile, 'profileHash') || Object.hasOwn(profile, 'profileCoverage')) invalidInput('profile');
  } else if (!asRecord(record.core)) invalidInput('core');
  if (family !== 'entity' && !asRecord(record.lorebookDeclaration)) invalidInput('lorebookDeclaration');
  if (family === 'entity') creatorId(record.kind, 'kind');
  creatorJSON(record);
}
function creatorResult(value: unknown, family: CreatorFamily, id?: string, worldId?: string): Readonly<Record<string, unknown>> {
  const common = ['id', 'schemaVersion', 'contentRevision', 'contentHash', 'origin', 'createdAt', 'updatedAt'];
  const specific = family === 'world' ? ['core', 'visibility', 'lorebookDeclaration'] : family === 'character' ? ['worldId', 'creatorId', 'worldEntityRef', 'visibility', 'lorebookDeclaration', 'profile', 'validity', 'materializationReadiness', 'sourceHash'] : family === 'entity' ? ['worldId', 'kind', 'core'] : ['worldId', 'sourceEntityId', 'targetEntityId', 'type', 'core'];
  const keys = [...common, ...specific];
  const record = closedRecord(value, family === 'world' ? [...keys, 'creatorId'] : keys, keys, family, true);
  for (const field of ['id', 'schemaVersion', 'contentHash', 'createdAt', 'updatedAt', ...(family === 'world' ? [] : ['worldId'])]) {
    if (typeof record[field] !== 'string' || !(record[field] as string).trim()) localAppProjectionError(`${family}.${field}`);
  }
  if (id !== undefined && record.id !== id) localAppProjectionError(`${family} identity mismatch`);
  if (worldId !== undefined && record.worldId !== worldId) localAppProjectionError(`${family} parent mismatch`);
  if (!Number.isSafeInteger(record.contentRevision) || Number(record.contentRevision) < 1 || !asRecord(record.origin)) localAppProjectionError(`${family} metadata`);
  if (family === 'world' || family === 'character') {
    if (!['private', 'unlisted', 'public', 'system'].includes(String(record.visibility)) || (record.lorebookDeclaration !== null && !asRecord(record.lorebookDeclaration))) localAppProjectionError(`${family} declaration`);
  }
  if (family === 'character') {
    const ref = entityRef(record.worldEntityRef, true);
    const profile = asRecord(record.profile);
    if (ref.worldId !== record.worldId || record.schemaVersion !== 'realm.world-character-core/v1' || typeof record.creatorId !== 'string' || !record.creatorId || typeof record.sourceHash !== 'string' || !record.sourceHash || !profile || profile.profileSchemaVersion !== 'realm.character-profile-core/v1' || typeof profile.profileHash !== 'string' || !asRecord(profile.profileCoverage) || !asRecord(record.validity) || !asRecord(record.materializationReadiness)) localAppProjectionError('world character source');
  } else {
    const core = asRecord(record.core);
    const requiredCore = family === 'world' ? ['identity', 'presentation', 'ontology', 'timeModel', 'timeline', 'entities', 'relationships', 'systems', 'scenes', 'assets', 'authoring'] : family === 'entity' ? ['identity', 'classification', 'facts', 'assets', 'evidence', 'authoring'] : ['endpoints', 'evidence', 'presentation', 'authoring'];
    if (!core || requiredCore.some(key => core[key] === undefined)) localAppProjectionError(`${family} core`);
  }
  if (family === 'entity' && (typeof record.kind !== 'string' || !record.kind)) localAppProjectionError('entity kind');
  if (family === 'relationship') {
    const endpoints = asRecord(asRecord(record.core)?.endpoints);
    for (const key of ['sourceEntityId', 'targetEntityId', 'type']) if (typeof record[key] !== 'string' || !record[key] || endpoints?.[key] !== record[key]) localAppProjectionError('relationship endpoints');
  }
  assertSafeWorldCreatorProjection(record);
  return Object.freeze({ ...record });
}

// @nimi-authority: rule.nimi.platform.core-protocol.world-creator-app-operations
export function assertSafeWorldCreatorProjection(record: Record<string, unknown>): void {
  creatorJSON(record, true);
  // Canonical source content may contain ordinary keys such as token or generation.
  const { core, profile, ...frame } = record;
  assertSafeProjection(frame);
  if (core !== undefined) assertSafeProjection(core, new Set(), true);
  if (profile !== undefined) assertSafeProjection(profile, new Set(), true);
  const source = asRecord(profile) ?? asRecord(core);
  const assets = asRecord(source?.assets);
  if (assets?.externalRefs !== undefined) assertSafeProjection(assets.externalRefs);
}
function assertCreatorWriteResult(record: Readonly<Record<string, unknown>>, input: unknown, family: CreatorFamily): void {
  const body = asRecord(input)!;
  if (family !== 'entity' && record.lorebookDeclaration === null) localAppProjectionError('world creator write declaration');
  if (family === 'character') {
    const expected = entityRef(body.worldEntityRef);
    const actual = entityRef(record.worldEntityRef, true);
    if (expected.worldId !== actual.worldId || expected.entityId !== actual.entityId) localAppProjectionError('world character write binding');
  }
}
