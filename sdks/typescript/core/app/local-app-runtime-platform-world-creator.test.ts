import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppWorldCreatorClient, type NimiLocalAppWorldCreatorShell } from './local-app-runtime-platform-world-creator.js';

const hash = 'a'.repeat(64);
function world() {
  return {
    id: 'world-1', creatorId: 'creator-1', schemaVersion: '1', contentRevision: 1,
    contentHash: hash, origin: { kind: 'manual' }, visibility: 'private',
    lorebookDeclaration: { identityBaseSetting: 'Bearer abcdefgh.abcdefgh.abcdefgh is a fictional password.', rolePlacements: [], worldRules: [] },
    core: { identity: { name: 'Harbor' }, presentation: {}, ontology: {}, timeModel: {}, timeline: {}, entities: [], relationships: [], systems: [], scenes: [], assets: {}, authoring: {} },
    createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
  };
}
function character() {
  const { core: _core, ...base } = world();
  return { ...base, id: 'character-1', worldId: 'world-1', schemaVersion: 'realm.world-character-core/v1',
    worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' },
    profile: { profileSchemaVersion: 'realm.character-profile-core/v1', identity: { name: 'Keeper' }, narrative: { token: 'a fictional token' }, profileHash: hash, profileCoverage: {} },
    validity: { status: 'valid', issues: [] }, materializationReadiness: { status: 'ready', blockers: [] }, sourceHash: hash,
  };
}
function shell(overrides: Partial<NimiLocalAppWorldCreatorShell> = {}): NimiLocalAppWorldCreatorShell {
  const unavailable = async (): Promise<never> => { throw new Error('test shell operation not configured'); };
  return { getCreationEligibility: unavailable, get: unavailable, replace: unavailable,
    listCharacters: unavailable, getCharacter: unavailable, createCharacter: unavailable, replaceCharacter: unavailable,
    listEntities: unavailable, getEntity: unavailable, createEntity: unavailable,
    listRelationships: unavailable, getRelationship: unavailable, ...overrides };
}

test('creation eligibility accepts only the Realm boolean and never derives permission', async () => {
  for (const allowed of [false, true]) {
    const client = createNimiLocalAppWorldCreatorClient(shell({ getCreationEligibility: async () => ({ canCreateWorld: allowed }) }));
    assert.deepEqual(await client.getCreationEligibility(), { canCreateWorld: allowed });
  }
  for (const value of [{}, { canCreateWorld: 'true' }, { canCreateWorld: true, role: 'ADMIN' }, { subscription: 'PRO' }]) {
    await assert.rejects(() => createNimiLocalAppWorldCreatorClient(shell({ getCreationEligibility: async () => value })).getCreationEligibility());
  }
});

test('world replacement forwards the CAS request intact and preserves source prose', async () => {
  const record = world();
  const input = { core: record.core, lorebookDeclaration: record.lorebookDeclaration, origin: { kind: 'manual' }, baseContentHash: hash };
  const calls: unknown[] = [];
  const client = createNimiLocalAppWorldCreatorClient(shell({ replace: async (...args) => { calls.push(args); return record; } }));
  assert.deepEqual(await client.replace('world-1', input as never), record);
  assert.deepEqual(calls, [['world-1', input]]);
  for (const body of [{ ...input, id: 'another-world' }, { ...input, baseContentHash: '' }, { ...input, accountId: 'creator-1' }]) {
    await assert.rejects(() => client.replace('world-1', body as never));
  }
  assert.equal(calls.length, 1);
});

test('character creation enforces the world binding before and after transport', async () => {
  const record = character();
  const { profileHash: _hash, profileCoverage: _coverage, ...profile } = record.profile;
  const input = { profile, worldEntityRef: record.worldEntityRef, lorebookDeclaration: record.lorebookDeclaration, origin: { kind: 'manual' } };
  let calls = 0;
  let result = record;
  const client = createNimiLocalAppWorldCreatorClient(shell({ createCharacter: async () => { calls++; return result; } }));
  assert.deepEqual(await client.createCharacter('world-1', input as never), record);
  await assert.rejects(() => client.createCharacter('world-2', input as never));
  assert.equal(calls, 1);
  result = { ...record, worldEntityRef: { ...record.worldEntityRef, entityId: 'another-entity' } };
  await assert.rejects(() => client.createCharacter('world-1', input as never));
});

test('list queries are bounded and a foreign-world row rejects the entire response', async () => {
  const calls: unknown[] = [];
  let rows = [character()];
  const client = createNimiLocalAppWorldCreatorClient(shell({ listCharacters: async (...args) => { calls.push(args); return rows; } }));
  assert.equal((await client.listCharacters('world-1', { take: 50, afterId: 'previous', visibility: 'private' })).length, 1);
  assert.deepEqual(calls[0], ['world-1', { take: 50, afterId: 'previous', visibility: 'private' }]);
  for (const query of [{ take: 501 }, { take: 0 }, { take: 1.5 }, { creatorId: 'other' }]) await assert.rejects(() => client.listCharacters('world-1', query as never));
  assert.equal(calls.length, 1);
  rows = [...rows, { ...character(), worldId: 'world-2' }];
  await assert.rejects(() => client.listCharacters('world-1'));
});

test('identity mismatches and credential-bearing frames are rejected', async () => {
  for (const value of [{ ...world(), id: 'world-2' }, { ...world(), accessToken: 'secret' }]) {
    await assert.rejects(() => createNimiLocalAppWorldCreatorClient(shell({ get: async () => value })).get('world-1'));
  }
});

test('Realm access and conflict failures retain their original typed error', async () => {
  for (const code of ['access-denied', 'conflict', 'realm-unavailable']) {
    const error = Object.assign(new Error(code), { reasonCode: code, retryable: false });
    const client = createNimiLocalAppWorldCreatorClient(shell({ get: async () => { throw error; } }));
    await assert.rejects(() => client.get('world-1'), (actual) => actual === error);
  }
});
