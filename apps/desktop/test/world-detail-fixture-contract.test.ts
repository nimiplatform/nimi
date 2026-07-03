import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { requireWorldPublicDetailDto } from '../src/shell/renderer/features/world/data/world-public-projection.js';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';

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

test('detail-with-characters fixture response preserves scene object contract', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'nimi-desktop-world-fixture-'));
  const manifestPath = resolve(tempDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(authenticatedBaseProfile), 'utf8');
  const server = await startRealmFixtureServer({ manifestPath });

  try {
    const response = await fetch(`${server.origin}/api/world/by-id/world-e2e-1/detail-with-characters`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      world?: unknown;
    };
    const world = requireWorldPublicDetailDto(payload.world, 'world-e2e-1');
    const scenes = world.scenes as unknown[];
    assert.equal(scenes.length, 1);
    assert.equal(typeof scenes[0], 'object');
    assert.equal((scenes[0] as Record<string, unknown>).sceneId, 'fixture-plaza');
  } finally {
    await server.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});
