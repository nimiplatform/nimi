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
      agents?: Array<Record<string, unknown>>;
      agentRuleSummary?: {
        totalAgentRuleCount?: number;
        byLayer?: Record<string, unknown>;
        worldLinkedRuleCount?: number;
      };
    }>;
  };
};

test('detail-with-agents fixture route stays wired to the canonical endpoint', () => {
  assert.match(fixtureServerSource, /worldDetailWithAgentsMatch/);
  assert.match(fixtureServerSource, /detail-with-agents/);
  assert.match(fixtureServerSource, /\.\.\.world/);
});

test('authenticated base fixture includes agent rule aggregate fields', () => {
  const world = authenticatedBaseProfile.realmFixture?.worlds?.find(
    (entry) => entry.id === 'world-e2e-1',
  );

  assert.ok(world, 'world-e2e-1 fixture must exist');
  assert.ok(Array.isArray(world.agents), 'detail-with-agents fixture must expose agents[]');
  assert.ok(world.agentRuleSummary, 'detail-with-agents fixture must expose agentRuleSummary');
  assert.equal(world.agentRuleSummary?.totalAgentRuleCount, 3);
  assert.equal(world.agentRuleSummary?.worldLinkedRuleCount, 0);
  assert.deepEqual(world.agentRuleSummary?.byLayer, {
    DNA: 1,
    BEHAVIORAL: 1,
    RELATIONAL: 0,
    CONTEXTUAL: 1,
  });

  const firstAgent = world.agents?.[0];
  assert.ok(firstAgent, 'fixture must include at least one agent');
  assert.equal(firstAgent?.activeRuleCount, 3);
  assert.equal(firstAgent?.bio, 'Fixture agent profile used for desktop contract coverage.');
});
