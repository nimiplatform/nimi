import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadExplorePersonas,
  type RealmExploreApiCaller,
} from '../src/shell/renderer/features/explore/data/realm-explore-data.js';

function callerFor(rows: unknown[]): RealmExploreApiCaller {
  return async (task) => task({
    worldCore: {
      worldCoreControllerListPersonaCharacters: async () => rows,
    },
  } as never);
}

function personaProfile(assets: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'persona-resource-ref-boundary',
    ownerAccountId: 'account-1',
    worldId: 'world-1',
    sourceHash: 'a'.repeat(64),
    visibility: 'public',
    profile: {
      identity: { name: 'Resource Ref Boundary' },
      presentation: {
        displayName: 'Resource Ref Boundary',
        avatarResourceRef: 'forge-publication-ledger-record-persona-avatar',
      },
      assets,
    },
  };
}

test('Explore Persona projection never treats an avatar resource id as an image URL', async () => {
  const result = await loadExplorePersonas(callerFor([personaProfile()]), () => undefined);
  assert.equal(result.items[0]?.avatarUrl, null);
});

test('Explore Persona projection accepts only an explicit public avatar URI', async () => {
  const avatarUrl = 'https://media.nimi.test/persona/avatar.png';
  const result = await loadExplorePersonas(callerFor([personaProfile({
    externalRefs: [
      { kind: 'avatar', uri: 'forge-publication-ledger-record-persona-avatar' },
      { kind: 'avatar', uri: avatarUrl },
    ],
  })]), () => undefined);
  assert.equal(result.items[0]?.avatarUrl, avatarUrl);
});
