import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const fixtureServerSource = readFileSync(
  resolve(import.meta.dirname, '../e2e/fixtures/realm-fixture-server.mjs'),
  'utf8',
);

const authenticatedBaseProfile = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../e2e/fixtures/profiles/_authenticated-base.json'),
    'utf8',
  ),
) as {
  realmFixture?: {
    worlds?: Array<{
      id?: string;
      media?: Record<string, unknown>;
      time?: Record<string, unknown>;
      stats?: Record<string, unknown>;
      characters?: Array<{
        sourceKind?: string;
        summary?: string;
        sourceRef?: Record<string, unknown>;
        relation?: Record<string, unknown>;
      }>;
      personas?: Array<Record<string, unknown>>;
    }>;
  };
};

test('detail-with-characters fixture route stays wired to the canonical endpoint', () => {
  assert.match(fixtureServerSource, /worldDetailWithCharactersMatch/);
  assert.match(fixtureServerSource, /detail-with-characters/);
  assert.match(fixtureServerSource, /world:\s*projectPublicWorld/);
  assert.match(fixtureServerSource, /sources:\s*\{/);
});

test('authenticated base fixture includes public source discovery fields', () => {
  const world = authenticatedBaseProfile.realmFixture?.worlds?.find(
    (entry) => entry.id === 'world-e2e-1',
  );

  assert.ok(world, 'world-e2e-1 fixture must exist');
  assert.ok(world.media, 'public world fixture must expose media');
  assert.ok(world.time, 'public world fixture must expose deterministic time');
  assert.ok(world.stats, 'public world fixture must expose stats');
  assert.ok(Array.isArray(world.characters), 'detail-with-characters fixture must expose character sources');
  assert.ok(Array.isArray(world.personas), 'detail-with-characters fixture must expose persona sources');

  const firstCharacter = world.characters?.[0];
  assert.ok(firstCharacter, 'fixture must include at least one character');
  assert.equal(firstCharacter?.sourceKind, 'worldCharacter');
  assert.equal(firstCharacter?.sourceRef?.kind, 'worldCharacter');
  assert.equal(firstCharacter?.sourceRef?.worldId, 'world-e2e-1');
  assert.equal(firstCharacter?.sourceRef?.sourceId, 'character-e2e-alpha');
  assert.equal(typeof firstCharacter?.sourceRef?.sourceContentHash, 'string');
  assert.ok(firstCharacter?.sourceRef?.sourceContentHash);
  assert.ok(!('runtimeSourceRef' in (firstCharacter?.relation ?? {})));
  assert.equal(firstCharacter?.summary, 'Fixture character profile used for desktop contract coverage.');
});
