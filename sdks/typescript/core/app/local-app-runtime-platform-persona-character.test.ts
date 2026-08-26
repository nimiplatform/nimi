import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiLocalAppPersonaCharacterClient,
  type NimiLocalAppPersonaCharacterCreateInput,
  type NimiLocalAppPersonaCharacterProfileInput,
  type NimiLocalAppPersonaCharacterShell,
} from './local-app-runtime-platform-persona-character.js';

const hash = (value: string) => value.repeat(64);

function createInput(): NimiLocalAppPersonaCharacterCreateInput {
  return {
    worldId: 'world-1',
    visibility: 'private',
    origin: { kind: 'manual' },
    lorebookDeclaration: {
      identity: 'Nimi Lab Persona',
      behavior: ['Respond as the authored persona.'],
      speaking: ['Use the authored greeting and interaction profile.'],
      immutableBoundaries: ['Do not replace the authored identity.'],
      relationshipPostures: [],
    },
    profile: {
      profileSchemaVersion: 'realm.character-profile-core/v1',
      identity: { name: 'Nimi Lab Persona', summary: 'Owner PersonaCharacter acceptance', handle: 'nimi-lab-persona' },
      presentation: { displayName: 'Nimi Lab Persona', avatarResourceRef: 'avatar-resource-1' },
      narrative: { summary: 'Owner PersonaCharacter acceptance', traits: [] },
      interactionProfile: { interactionModes: [], greeting: 'Hello' },
      assets: {
        resourceRefs: [{ refId: 'avatar-resource-1', kind: 'image' }],
        intents: [],
        externalRefs: [{ refId: 'public-avatar', kind: 'image', uri: 'https://cdn.example.test/avatar.png' }],
      },
      authoring: {
        source: 'nimi.lab.realm-app-access',
        extensions: {
          'works.nimi.diagnostics': {
            extensionSchemaVersion: 'diag/v1', namespace: 'works.nimi.diagnostics', productSemantic: false,
            fields: { marker: 'acceptance' },
          },
        },
      },
    },
  };
}

function persona() {
  return {
    id: 'persona-1', worldId: 'world-1', schemaVersion: 'realm.persona-character-core/v1',
    contentHash: hash('a'), contentRevision: 1, sourceHash: hash('b'), visibility: 'private',
    origin: { kind: 'manual' },
    lorebookDeclaration: createInput().lorebookDeclaration,
    profile: {
      ...createInput().profile,
      profileHash: hash('c'),
      profileCoverage: {
        manifestSchemaVersion: 'realm.character-profile-coverage/v1',
        requiredSections: [], optionalSections: [], requiredRefs: [], optionalRefs: [], diagnostics: [],
        aggregateStatus: 'complete', profileCoverageHash: hash('d'),
      },
    },
    validity: { status: 'valid', issues: [] },
    materializationReadiness: { status: 'ready', blockers: [] },
    createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  } as const;
}

const outputProfile = persona().profile;
// @ts-expect-error output-only hash and coverage make a projected profile invalid as write input
const invalidRoundtripProfile: NimiLocalAppPersonaCharacterProfileInput = outputProfile;
void invalidRoundtripProfile;

function shell(overrides: Partial<NimiLocalAppPersonaCharacterShell> = {}): NimiLocalAppPersonaCharacterShell {
  return {
    listOwned: async () => [persona()],
    getOwned: async () => persona(),
    create: async () => persona(),
    replace: async () => ({ ...persona(), contentRevision: 2, contentHash: hash('e') }),
    delete: async (personaCharacterId) => ({ personaCharacterId, deleted: true }),
    ...overrides,
  };
}

test('PersonaCharacter owner client projects and freezes the exact safe DTO', async () => {
  const client = createNimiLocalAppPersonaCharacterClient(shell());
  const listed = await client.listOwned({ worldId: 'world-1', visibility: 'private', take: 1 });
  assert.equal(listed.items[0]?.id, 'persona-1');
  assert.equal(listed.nextAfterId, 'persona-1');
  assert.equal(Object.isFrozen(listed.items[0]), true);
  assert.equal(Object.isFrozen(listed.items[0]?.profile), true);
  assert.equal('ownerAccountId' in (listed.items[0] as unknown as Record<string, unknown>), false);

  const replaced = await client.replace({
    ...createInput(), personaCharacterId: 'persona-1', baseContentHash: hash('a'),
  });
  assert.equal(replaced.contentRevision, 2);
  assert.equal(replaced.contentHash, hash('e'));
  const deleted = await client.delete('persona-1');
  assert.deepEqual(deleted, { personaCharacterId: 'persona-1', deleted: true });
  assert.equal(Object.isFrozen(deleted), true);
});

test('PersonaCharacter owner client rejects a malformed delete acknowledgement', async () => {
  const client = createNimiLocalAppPersonaCharacterClient(shell({
    delete: async () => ({ personaCharacterId: 'persona-other', deleted: true }),
  }));

  await assert.rejects(
    () => client.delete('persona-1'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'contract-invalid',
  );
});

test('PersonaCharacter owner client admits bounded pagination and rejects caller authority and stale write shape before transport', async () => {
  let calls = 0;
  let listedInput: unknown;
  const client = createNimiLocalAppPersonaCharacterClient(shell({
    listOwned: async (input) => { calls += 1; listedInput = input; return []; },
    create: async () => { calls += 1; return persona(); },
    replace: async () => { calls += 1; return persona(); },
  }));
  const emptyPage = await client.listOwned({ take: 10, afterId: 'persona-010' });
  assert.deepEqual(emptyPage, { items: [] });
  assert.deepEqual(listedInput, { afterId: 'persona-010', take: 10 });
  await assert.rejects(
    () => client.create({ ...createInput(), ownerAccountId: 'acct-1' } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'invalid-input',
  );
  await assert.rejects(
    () => client.replace({ ...createInput(), personaCharacterId: 'persona-1' } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'invalid-input',
  );
  await assert.rejects(
    () => client.listOwned({ take: 501 } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'invalid-input',
  );
  await assert.rejects(
    () => client.create({ ...createInput(), visibility: 'system' } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'invalid-input',
  );
  await assert.rejects(
    () => client.create({
      ...createInput(),
      profile: { ...createInput().profile, authoring: { source: 'oversized', notes: ['x'.repeat(2 * 1024 * 1024)] } },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'request-too-large',
  );
  assert.equal(calls, 1);
});

test('PersonaCharacter owner client leaves Realm-owned origin and extension semantics opaque while enforcing external HTTPS', async () => {
  let calls = 0;
  const client = createNimiLocalAppPersonaCharacterClient(shell({
    create: async () => { calls += 1; return persona(); },
  }));
  const canonical = structuredClone(createInput()) as any;
  canonical.origin = { kind: 'forge' };
  canonical.profile.narrative.summary = 'Bearer abcdefgh.abcdefgh.abcdefgh';
  canonical.profile.assets.externalRefs = [{
    refId: 'public-avatar', kind: 'image', uri: `https://cdn.example.test/avatar.png?description=${'a'.repeat(2_100)}`,
  }];
  canonical.profile.authoring.extensions = {
    'future.product': {
      extensionSchemaVersion: 'future/v1',
      namespace: 'future.product',
      productSemantic: true,
      fields: { token: 'product-token', secret: 'story-secret', classification: 'story', jwt: 'opaque.product.content' },
    },
  };
  await client.create(canonical);
  assert.equal(calls, 1);

  const longExternal = {
    ...persona(),
    profile: {
      ...persona().profile,
      assets: {
        ...persona().profile.assets,
        externalRefs: canonical.profile.assets.externalRefs,
      },
    },
  };
  await assert.doesNotReject(() => createNimiLocalAppPersonaCharacterClient(
    shell({ getOwned: async () => longExternal }),
  ).getOwned('persona-1'));

  await assert.rejects(
    () => client.create({
      ...createInput(),
      profile: { ...createInput().profile, assets: { ...createInput().profile.assets, externalRefs: [{ refId: 'x', kind: 'image', uri: 'http://local.test/a.png' }] } },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'invalid-input',
  );
  assert.equal(calls, 1);
});

test('PersonaCharacter owner client accepts Realm-owned long fields and opaque extension keys after a committed write', async () => {
  const longHandle = 'h'.repeat(5_000);
  const longFieldKey = 'k'.repeat(1_000);
  const canonical = structuredClone(persona()) as any;
  canonical.profile.identity.handle = longHandle;
  canonical.profile.authoring.extensions['works.nimi.diagnostics'].fields = {
    [longFieldKey]: 'Realm-owned product content',
  };
  let calls = 0;
  const client = createNimiLocalAppPersonaCharacterClient(shell({
    create: async () => { calls += 1; return canonical; },
  }));
  const input = structuredClone(createInput()) as any;
  input.profile.identity.handle = longHandle;
  input.profile.authoring.extensions['works.nimi.diagnostics'].fields = {
    [longFieldKey]: 'Realm-owned product content',
  };
  const created = await client.create(input);
  assert.equal(calls, 1);
  assert.equal(created.profile.identity.handle, longHandle);
  assert.equal(
    created.profile.authoring.extensions?.['works.nimi.diagnostics']?.fields[longFieldKey],
    'Realm-owned product content',
  );
});

test('PersonaCharacter owner client rejects URL-shaped values only in stable resource authority slots', async () => {
  let calls = 0;
  const client = createNimiLocalAppPersonaCharacterClient(shell({
    create: async () => { calls += 1; return persona(); },
  }));
  const unsafeInputs = [
    (input: any) => { input.profile.presentation.avatarResourceRef = 'https://cdn.example.test/a.png?token=credential'; },
    (input: any) => { input.profile.presentation.profileCoverResourceRef = 'file:/tmp/cover.png'; },
    (input: any) => { input.profile.assets.resourceRefs[0].refId = 'artifact-id#credential'; },
  ];
  for (const mutate of unsafeInputs) {
    const input = structuredClone(createInput()) as any;
    mutate(input);
    await assert.rejects(
      () => client.create(input),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'invalid-input',
    );
  }
  assert.equal(calls, 0);

  for (const mutate of unsafeInputs) {
    const output = structuredClone(persona()) as any;
    mutate({ profile: output.profile });
    await assert.rejects(
      () => createNimiLocalAppPersonaCharacterClient(shell({ getOwned: async () => output })).getOwned('persona-1'),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'contract-invalid',
    );
  }

  const stable = structuredClone(persona()) as any;
  stable.profile.presentation.profileCoverResourceRef = 'cover-resource-1';
  await assert.doesNotReject(() => createNimiLocalAppPersonaCharacterClient(
    shell({ getOwned: async () => stable }),
  ).getOwned('persona-1'));
});

test('PersonaCharacter profile roundtrip helper removes output-only canonical fields', async () => {
  let replaceInput: NimiLocalAppPersonaCharacterCreateInput | undefined;
  const client = createNimiLocalAppPersonaCharacterClient(shell({
    replace: async (input) => { replaceInput = input; return persona(); },
  }));
  const detail = await client.getOwned('persona-1');
  assert.ok(detail.lorebookDeclaration);
  const profile = client.toProfileInput(detail.profile);
  assert.equal('profileHash' in profile, false);
  assert.equal('profileCoverage' in profile, false);
  await client.replace({
    personaCharacterId: detail.id,
    baseContentHash: detail.contentHash,
    worldId: detail.worldId,
    visibility: 'private',
    origin: detail.origin,
    lorebookDeclaration: detail.lorebookDeclaration,
    profile,
  });
  assert.equal(replaceInput?.profile, profile);
  await assert.rejects(
    () => client.replace({
      personaCharacterId: detail.id,
      baseContentHash: detail.contentHash,
      worldId: detail.worldId,
      visibility: 'private',
      origin: detail.origin,
      lorebookDeclaration: detail.lorebookDeclaration,
      profile: detail.profile as never,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'invalid-input',
  );
});

test('PersonaCharacter owner client rejects malformed or owner-bearing projection', async () => {
  for (const malformed of [
    { ...persona(), ownerAccountId: 'acct-1' },
    { ...persona(), state: 'PUBLIC' },
    { ...persona(), profile: { ...persona().profile, profileHash: 'bad' } },
    {
      ...persona(),
      profile: {
        profileSchemaVersion: 'realm.character-profile-core/v1',
        profileHash: hash('c'),
        profileCoverage: persona().profile.profileCoverage,
      },
    },
    { ...persona(), profile: { ...persona().profile, assets: { ...persona().profile.assets, externalRefs: [{ refId: 'x', kind: 'image', uri: 'http://local.test/a.png' }] } } },
    { ...persona(), contentRevision: -1.5 },
    { ...persona(), createdAt: '2026-08-21T00:00:00Z' },
    { ...persona(), validity: { status: 'invalid', issues: [{ path: '', code: '', message: '' }] } },
  ]) {
    const client = createNimiLocalAppPersonaCharacterClient(shell({ getOwned: async () => malformed }));
    await assert.rejects(
      () => client.getOwned('persona-1'),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'contract-invalid',
    );
  }
});

test('PersonaCharacter owner client exposes only the canonical sanitized failure taxonomy', async () => {
  const conflict = createNimiLocalAppPersonaCharacterClient(shell({
    replace: async () => { throw Object.assign(new Error('private upstream detail'), { reasonCode: 'content-conflict' }); },
  }));
  await assert.rejects(
    () => conflict.replace({ ...createInput(), personaCharacterId: 'persona-1', baseContentHash: hash('a') }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'content-conflict'
      && !String((error as Error).message).includes('private upstream detail'),
  );

  const owner = createNimiLocalAppPersonaCharacterClient(shell({
    getOwned: async () => { throw Object.assign(new Error('hidden owner'), { reasonCode: 'local-app-owner-unavailable' }); },
  }));
  await assert.rejects(
    () => owner.getOwned('persona-1'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'owner-authority-missing',
  );
});
