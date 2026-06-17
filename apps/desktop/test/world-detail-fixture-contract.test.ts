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
      characters?: Array<Record<string, unknown>>;
      characterRuleSummary?: {
        totalCharacterRuleCount?: number;
        byLayer?: Record<string, unknown>;
        worldLinkedRuleCount?: number;
      };
    }>;
  };
};

test('detail-with-characters fixture route stays wired to the canonical endpoint', () => {
  assert.match(fixtureServerSource, /worldDetailWithCharactersMatch/);
  assert.match(fixtureServerSource, /detail-with-characters/);
  assert.match(fixtureServerSource, /\.\.\.world/);
});

test('authenticated base fixture includes character rule aggregate fields', () => {
  const world = authenticatedBaseProfile.realmFixture?.worlds?.find(
    (entry) => entry.id === 'world-e2e-1',
  );

  assert.ok(world, 'world-e2e-1 fixture must exist');
  assert.ok(Array.isArray(world.characters), 'detail-with-characters fixture must expose characters[]');
  assert.ok(world.characterRuleSummary, 'detail-with-characters fixture must expose characterRuleSummary');
  assert.equal(world.characterRuleSummary?.totalCharacterRuleCount, 3);
  assert.equal(world.characterRuleSummary?.worldLinkedRuleCount, 0);
  assert.deepEqual(world.characterRuleSummary?.byLayer, {
    DNA: 1,
    BEHAVIORAL: 1,
    RELATIONAL: 0,
    CONTEXTUAL: 1,
  });

  const firstCharacter = world.characters?.[0];
  assert.ok(firstCharacter, 'fixture must include at least one character');
  assert.equal(firstCharacter?.activeRuleCount, 3);
  assert.equal(firstCharacter?.bio, 'Fixture character profile used for desktop contract coverage.');
});
