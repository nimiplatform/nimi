import { afterEach, expect, it } from 'vitest';
import { createNimiLocalAppStandardShellSurface } from '../src/bridge/local-app.js';
import { dispatchElectronLocalAppCommand } from '../../electron/src/main/local-app-commands.js';

afterEach(() => { delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__; });

it('preserves dynamic world content through all four methods and rejects authority in the frame', async () => {
  const world = { id: 'world-1', core: { systems: [{ systemId: 'economy', name: 'Economy', summary: 'Trade.', parameters: { token: 'coin', generation: 3 } }] } };
  let value: Record<string, unknown> = world;
  (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
    invoke: async (command: string) => command.endsWith('realmWorldCoreList') ? [value] : value,
    listen: () => () => {},
  };
  const api = createNimiLocalAppStandardShellSurface().realm.worldCore;
  const body = { core: world.core, lorebookDeclaration: {}, origin: { kind: 'manual' } };
  const calls = [() => api.list(), () => api.get('world-1'), () => api.create(body),
    () => api.replace('world-1', { ...body, baseContentHash: 'a'.repeat(64) })];
  for (const call of calls) {
    const result = await call();
    expect(Array.isArray(result) ? result[0] : result).toEqual(world);
  }
  value = { ...world, accessToken: 'unexpected' };
  for (const call of calls) await expect(call()).rejects.toBeDefined();
});

it('routes every world creator renderer method through its exact Electron command and host envelope', async () => {
  const calls: { name: string; payload: unknown }[] = [];
  const methods = ['realmWorldCreationEligibilityGet', 'realmWorldCoreGet', 'realmWorldCoreReplace',
    'realmWorldCharacterList', 'realmWorldCharacterGet', 'realmWorldCharacterCreate', 'realmWorldCharacterReplace',
    'realmWorldEntityList', 'realmWorldEntityGet', 'realmWorldEntityCreate', 'realmWorldRelationshipList', 'realmWorldRelationshipGet'];
  const host = Object.fromEntries(methods.map(name => [name, async (payload: unknown) => {
    calls.push({ name, payload });
    if (name === 'realmWorldCreationEligibilityGet') return { canCreateWorld: false };
    const record = { id: 'record-1', core: { classification: { token: 'fictional token' } } };
    return name.endsWith('List') ? [record] : record;
  }])) as never;
  (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
    invoke: (command: string, input: { payload?: Record<string, unknown> }) => dispatchElectronLocalAppCommand({ host, command, payload: input.payload ?? input }),
    listen: () => () => {},
  };
  const api = createNimiLocalAppStandardShellSurface().realm.worldCore;
  const origin = { kind: 'manual' };
  const worldBody = { core: {}, lorebookDeclaration: {}, origin, baseContentHash: 'a'.repeat(64) };
  const characterBody = { profile: {}, lorebookDeclaration: {}, origin, worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' } };
  const entityBody = { core: {}, kind: 'person', origin };
  expect(await api.getCreationEligibility()).toEqual({ canCreateWorld: false });
  await api.get('world-1');
  await api.replace('world-1', worldBody);
  await api.listCharacters('world-1', { take: 20, afterId: 'previous', visibility: 'private' });
  await api.getCharacter('character-1');
  await api.createCharacter('world-1', characterBody);
  await api.replaceCharacter('character-1', { ...characterBody, baseContentHash: 'b'.repeat(64) });
  await api.listEntities('world-1', { kind: 'person' });
  await api.getEntity('entity-1');
  await api.createEntity('world-1', entityBody);
  await api.listRelationships('world-1', { type: 'knows', sourceEntityId: 'entity-1' });
  await api.getRelationship('relationship-1');
  expect(calls).toEqual([
    { name: methods[0], payload: undefined },
    { name: methods[1], payload: { worldId: 'world-1' } },
    { name: methods[2], payload: { worldId: 'world-1', body: worldBody } },
    { name: methods[3], payload: { worldId: 'world-1', take: 20, afterId: 'previous', visibility: 'private' } },
    { name: methods[4], payload: { characterId: 'character-1' } },
    { name: methods[5], payload: { worldId: 'world-1', body: characterBody } },
    { name: methods[6], payload: { characterId: 'character-1', body: { ...characterBody, baseContentHash: 'b'.repeat(64) } } },
    { name: methods[7], payload: { worldId: 'world-1', kind: 'person' } },
    { name: methods[8], payload: { entityId: 'entity-1' } },
    { name: methods[9], payload: { worldId: 'world-1', body: entityBody } },
    { name: methods[10], payload: { worldId: 'world-1', type: 'knows', sourceEntityId: 'entity-1' } },
    { name: methods[11], payload: { relationshipId: 'relationship-1' } },
  ]);
  for (const payload of [{ accountId: 'other' }, { canCreateWorld: true }]) {
    await expect(dispatchElectronLocalAppCommand({ host, command: 'nimi.shell.localApp.realmWorldCreationEligibilityGet', payload })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
  }
  expect(() => api.listCharacters('world-1', { take: 501 })).toThrow();
  expect(calls).toHaveLength(12);
});

it('rejects malformed creation eligibility at the renderer boundary', async () => {
  for (const value of [{ canCreateWorld: 'true' }, { canCreateWorld: true, accountId: 'other' }, {}]) {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = { invoke: async () => value, listen: () => () => {} };
    await expect(createNimiLocalAppStandardShellSurface().realm.worldCore.getCreationEligibility()).rejects.toBeDefined();
  }
});
