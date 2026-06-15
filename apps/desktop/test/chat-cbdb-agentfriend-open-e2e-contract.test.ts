import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');
const cbdbAgentId = 'cbdb-song-slice-real-20260614-agent-8af2c5ca8a';

const registrySource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/registry.mjs'),
  'utf8',
);
const e2eIdsSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/testability/e2e-ids.ts'),
  'utf8',
);
const e2eSelectorsSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/selectors.mjs'),
  'utf8',
);
const agentCardSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/explore/explore-agent-recommendation-card.tsx'),
  'utf8',
);
const fixtureServerSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/fixtures/realm-fixture-server.mjs'),
  'utf8',
);
const specSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/specs/chat.cbdb-agentfriend-open.e2e.mjs'),
  'utf8',
);
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(desktopRoot, 'e2e/fixtures/profiles/chat.cbdb-agentfriend-open.json'),
    'utf8',
  ),
) as {
  realmFixture?: {
    agentFriendLimit?: { used?: number; limit?: number; canAdd?: boolean };
    friends?: { items?: Array<Record<string, unknown>> };
    searchUsers?: { items?: Array<Record<string, unknown>> };
    worlds?: Array<Record<string, unknown>>;
  };
};

test('CBDB AgentFriend open-chat journey is registered in the desktop E2E registry', () => {
  assert.match(
    registrySource,
    /\['chat\.cbdb-agentfriend-open',\s*\{\s*bucket:\s*'journeys',\s*profile:\s*'chat\.cbdb-agentfriend-open\.json',\s*spec:\s*'apps\/desktop\/e2e\/specs\/chat\.cbdb-agentfriend-open\.e2e\.mjs'\s*\}\]/,
  );
});

test('CBDB AgentFriend fixture exposes the same RealmAgent through social, explore, and world projections', () => {
  const friend = fixture.realmFixture?.friends?.items?.find((item) => item.id === cbdbAgentId);
  const searchUser = fixture.realmFixture?.searchUsers?.items?.find((item) => item.id === cbdbAgentId);
  const world = fixture.realmFixture?.worlds?.find((item) => item.id === 'cbdb-song-slice-real-20260614-world');
  const worldAgents = Array.isArray(world?.agents) ? world.agents as Array<Record<string, unknown>> : [];
  const worldAgent = worldAgents.find((item) => item.id === cbdbAgentId);

  assert.equal(fixture.realmFixture?.agentFriendLimit?.canAdd, true);
  assert.equal(friend?.isAgent, true);
  assert.equal(searchUser?.isAgent, true);
  assert.equal(worldAgent?.id, cbdbAgentId);
  assert.equal((friend?.agentProfile as Record<string, unknown> | undefined)?.systemOwnerAccount, 'halliday@nimi.ai');
  assert.equal((searchUser?.agentProfile as Record<string, unknown> | undefined)?.ownerScope, 'forge-imported-system');
});

test('CBDB AgentFriend open-chat journey uses renderer-owned Explore Agent selectors', () => {
  assert.match(e2eIdsSource, /exploreAgentCard:\s*\(agentId: string\) => `explore-agent-card:\$\{agentId\}`/);
  assert.match(e2eIdsSource, /exploreAgentPrimaryAction:\s*\(agentId: string\) => `explore-agent-primary-action:\$\{agentId\}`/);
  assert.match(e2eSelectorsSource, /readRendererSelectorFactory\('exploreAgentCard', 'agentId'\)/);
  assert.match(e2eSelectorsSource, /readRendererSelectorFactory\('exploreAgentPrimaryAction', 'agentId'\)/);
  assert.match(agentCardSource, /data-testid=\{E2E_IDS\.exploreAgentCard\(agent\.id\)\}/);
  assert.match(agentCardSource, /data-testid=\{E2E_IDS\.exploreAgentPrimaryAction\(agent\.id\)\}/);
});

test('CBDB AgentFriend open-chat spec proves friend state before opening LocalAgent Chat', () => {
  assert.match(fixtureServerSource, /\/api\/human\/me\/friends\/agent-limit/);
  assert.match(fixtureServerSource, /creatorAgentMatch/);
  assert.match(specSource, /clickByTestId\('explore-section-tab-agents'\)/);
  assert.match(specSource, /waitForTestId\('explore-agents-section'\)/);
  assert.match(specSource, /data-friend-state'\), 'friend'/);
  assert.match(specSource, /data-primary-action'\), 'open_agent_chat'/);
  assert.match(specSource, /E2E_IDS\.chatTarget\(CBDB_LOCAL_AGENT_REF\)/);
});
