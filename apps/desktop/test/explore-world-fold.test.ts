import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { worldAdmitsUserCreatedRealmAgents } from '../src/shell/renderer/features/world/world-create-agent-admission.js';

function readRendererFile(relativePath: string): string {
  return fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer', relativePath),
    'utf8',
  );
}

function readDesktopFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const explorePanelSource = readRendererFile('features/explore/explore-panel.tsx');
const exploreViewSource = readRendererFile('features/explore/explore-view.tsx');
const exploreSectionNavSource = readRendererFile('features/explore/explore-section-nav.tsx');
const mainLayoutViewSource = readRendererFile('app-shell/layouts/main-layout-view.tsx');
const mainLayoutTitlebarContentSource = readRendererFile('app-shell/layouts/main-layout-titlebar-content.tsx');
const worldListSource = readRendererFile('features/world/world-list.tsx');
const worldDetailSource = readRendererFile('features/world/world-detail.tsx');
const worldCreateAgentAdmissionSource = readRendererFile('features/world/world-create-agent-admission.ts');
const agentRecommendationCardSource = readRendererFile('features/explore/explore-agent-recommendation-card.tsx');
const e2eRegistrySource = readDesktopFile('e2e/helpers/registry.mjs');

test('Explore fold mounts complete Worlds catalog under Explore', () => {
  assert.match(worldListSource, /export function WorldCatalogContent/);
  assert.match(exploreViewSource, /WorldCatalogContent/);
  assert.match(exploreViewSource, /data-testid="explore-worlds-section"/);
  assert.match(worldListSource, /data-testid="explore-worlds-catalog"/);
  assert.match(explorePanelSource, /worldCatalogItems=\{worldsQuery\.data \?\? \[\]\}/);
  assert.match(explorePanelSource, /worldsLoading=\{worldsQuery\.isPending\}/);
  assert.match(explorePanelSource, /worldsError=\{worldsQuery\.isError\}/);
});

test('Explore fold keeps RealmAgent discovery as Explore-owned discovery without direct RealmAgent chat', () => {
  assert.match(explorePanelSource, /dataSync\.loadExploreAgents/);
  assert.match(exploreViewSource, /data-testid="explore-agents-section"/);
  assert.match(exploreViewSource, /<AgentRecommendationCard/);
  assert.match(agentRecommendationCardSource, /worldName/);
  // D-EXPL-006: the RealmAgent card renders the friend-state primary action
  // via the shared friend-state model — never an unconditional Add Friend, and
  // never a direct RealmAgent chat affordance.
  assert.match(agentRecommendationCardSource, /describeRealmAgentPrimaryAction/);
  assert.doesNotMatch(exploreViewSource, /<ExploreAgentCard/);
  // No RealmAgent direct-chat path: world-detail's handleChatAgent declaration
  // and onChatAgent prop binding drift is removed (T3 / D-EXPL-006).
  assert.doesNotMatch(worldDetailSource, /const handleChatAgent\b/);
  assert.doesNotMatch(worldDetailSource, /onChatAgent=\{/);
});

test('Explore exposes the canonical three-section discovery IA', () => {
  // D-EXPL-002: Worlds / Agents / Activity.
  assert.match(exploreViewSource, /data-testid="explore-worlds-section"/);
  assert.match(exploreViewSource, /data-testid="explore-agents-section"/);
  assert.match(exploreViewSource, /data-testid="explore-activity-section"/);
  assert.doesNotMatch(exploreViewSource, /ExploreCreateAgentSection/);
  assert.doesNotMatch(exploreViewSource, /explore-create-agent-section/);
  assert.match(exploreSectionNavSource, /EXPLORE_SECTION_IDS:\s*readonly ExploreSectionId\[\]\s*=\s*\[\s*'worlds',\s*'agents',\s*'activity'/);
  assert.match(mainLayoutViewSource, /<MainLayoutTitlebarContent/);
  assert.match(mainLayoutTitlebarContentSource, /<ExploreSectionNav[\s\S]*active=\{props\.exploreActiveSection\}[\s\S]*variant="topbar"/);
  // Agents section is a full discovery grid, not a truncated carousel.
  assert.doesNotMatch(explorePanelSource, /TOP_AGENTS_COUNT/);
});

test('Create Agent is admitted only by selected World projection and fails closed otherwise', () => {
  assert.equal(worldAdmitsUserCreatedRealmAgents({
    status: 'ACTIVE',
    nativeCreationState: 'OPEN',
    nativeAgentLimit: 4,
    agentCount: 3,
  }), true);
  assert.equal(worldAdmitsUserCreatedRealmAgents({
    status: 'ACTIVE',
    nativeCreationState: 'NATIVE_CREATION_FROZEN',
    nativeAgentLimit: 4,
    agentCount: 3,
  }), false);
  assert.equal(worldAdmitsUserCreatedRealmAgents({
    status: 'SUSPENDED',
    nativeCreationState: 'OPEN',
    nativeAgentLimit: 4,
    agentCount: 3,
  }), false);
  assert.equal(worldAdmitsUserCreatedRealmAgents({
    status: 'ACTIVE',
    nativeCreationState: 'OPEN',
    nativeAgentLimit: 3,
    agentCount: 3,
  }), false);
});

test('World Detail passes Create Agent only behind the admission guard', () => {
  assert.match(worldCreateAgentAdmissionSource, /world\.status === 'ACTIVE'/);
  assert.match(worldCreateAgentAdmissionSource, /world\.nativeCreationState === 'OPEN'/);
  assert.match(worldCreateAgentAdmissionSource, /world\.nativeAgentLimit > world\.agentCount/);
  assert.match(worldDetailSource, /worldAdmitsUserCreatedRealmAgents\(worldData\)/);
  assert.match(worldDetailSource, /onCreateAgent=\{createAgentAdmitted \? \(input\) => createAgentMutation\.mutate\(input\) : undefined\}/);
  assert.match(worldDetailSource, /This World is not admitting new user-created RealmAgents/);
});

test('World Tour remains Tester internal evidence and is not a registered ordinary E2E journey', () => {
  assert.doesNotMatch(e2eRegistrySource, /\['tester\.world-tour'/);
});
