import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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
const realmExploreDataSource = readRendererFile('features/explore/data/realm-explore-data.ts');
const exploreViewSource = readRendererFile('features/explore/explore-view.tsx');
const exploreSectionNavSource = readRendererFile('features/explore/explore-section-nav.tsx');
const mainLayoutViewSource = readRendererFile('app-shell/layouts/main-layout-view.tsx');
const mainLayoutTitlebarContentSource = readRendererFile('app-shell/layouts/main-layout-titlebar-content.tsx');
const worldListSource = readRendererFile('features/world/world-list.tsx');
const worldDetailSource = readRendererFile('features/world/world-detail.tsx');
const worldDetailTemplateSource = readRendererFile('features/world/world-detail-template.tsx');
const personaSourceCardSource = readRendererFile('features/explore/explore-persona-source-card.tsx');
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

test('Explore fold keeps RealmPersona discovery as Explore-owned discovery without direct source chat', () => {
  assert.match(explorePanelSource, /realmExploreData\.loadExplorePersonas/);
  assert.match(realmExploreDataSource, /worldCoreControllerListRealmPersonas/);
  assert.match(realmExploreDataSource, /loadNimiRealmExploreFeedItems/);
  assert.doesNotMatch(realmExploreDataSource, /realm\.generated\.searchIndexedUsers/);
  assert.doesNotMatch(realmExploreDataSource, /realm\.generated\.getExploreFeed/);
  assert.match(exploreViewSource, /data-testid="explore-personas-section"/);
  assert.match(exploreViewSource, /<PersonaSourceCard/);
  assert.match(personaSourceCardSource, /worldName/);
  // RealmPersona cards render source admission handoff state, never an
  // unconditional Add Friend or direct source chat affordance.
  assert.match(personaSourceCardSource, /describeRealmPersonaPrimaryAction/);
  assert.doesNotMatch(exploreViewSource, /<ExploreAgentCard/);
  // No source direct-chat path: world-detail's handleChatAgent declaration
  // and onChatAgent prop binding drift is removed (T3 / D-EXPL-006).
  assert.doesNotMatch(worldDetailSource, /const handleChatAgent\b/);
  assert.doesNotMatch(worldDetailSource, /onChatAgent=\{/);
});

test('Explore exposes the canonical three-section discovery IA', () => {
  // D-EXPL-002: Worlds / Personas / Activity.
  assert.match(exploreViewSource, /data-testid="explore-worlds-section"/);
  assert.match(exploreViewSource, /data-testid="explore-personas-section"/);
  assert.match(exploreViewSource, /data-testid="explore-activity-section"/);
  assert.doesNotMatch(exploreViewSource, new RegExp(`ExploreCreate${'Agent'}Section`));
  assert.doesNotMatch(exploreViewSource, new RegExp(`explore-create-${'agent'}-section`));
  assert.match(exploreSectionNavSource, /EXPLORE_SECTION_IDS:\s*readonly ExploreSectionId\[\]\s*=\s*\[\s*'worlds',\s*'personas',\s*'activity'/);
  assert.match(mainLayoutViewSource, /<MainLayoutTitlebarContent/);
  assert.match(mainLayoutTitlebarContentSource, /<ExploreSectionNav[\s\S]*active=\{props\.exploreActiveSection\}[\s\S]*variant="topbar"/);
  // Personas section is a full discovery grid, not a truncated carousel.
  assert.doesNotMatch(explorePanelSource, /TOP_AGENTS_COUNT/);
});

test('World Detail exposes no Desktop Realm source creation entry point after core hard cut', () => {
  assert.doesNotMatch(worldDetailSource, new RegExp(`worldAdmitsUserCreated${['Realm', 'Agents'].join('')}`));
  assert.doesNotMatch(worldDetailSource, /createAgentMutation/);
  assert.doesNotMatch(worldDetailSource, /onCreateAgent=\{/);
  assert.doesNotMatch(worldDetailTemplateSource, /CreateAgentDrawer/);
  assert.equal(
    fs.existsSync(path.join(import.meta.dirname, '../src/shell/renderer/features/world', `world-create-${'agent'}-admission.ts`)),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(import.meta.dirname, '../src/shell/renderer/features/world', `create-${'agent'}-drawer.tsx`)),
    false,
  );
});

test('World Tour is not a registered ordinary E2E journey', () => {
  assert.doesNotMatch(e2eRegistrySource, /world-tour/);
});
