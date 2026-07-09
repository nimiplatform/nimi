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
const e2eIdsSource = readRendererFile('testability/e2e-ids.ts');
const mainLayoutViewSource = readRendererFile('app-shell/layouts/main-layout-view.tsx');
const mainLayoutTitlebarContentSource = readRendererFile('app-shell/layouts/main-layout-titlebar-content.tsx');
const worldListSource = [
  'features/world/world-list.tsx',
  'features/world/world-list-catalog-controls.tsx',
  'features/world/world-list-featured-strip.tsx',
  'features/world/world-list-compact-card.tsx',
  'features/world/world-list-selected-panel.tsx',
].map(readRendererFile).join('\n');
const worldDataSource = readRendererFile('features/world/data/realm-world-data.ts');
const worldDetailSource = readRendererFile('features/world/world-detail.tsx');
const worldDetailTemplateSource = [
  'features/world/world-detail-template.tsx',
  'features/world/world-detail-glass-sections.tsx',
  'features/world/world-detail-glass-primitives.tsx',
  'features/world/world-detail-template-model.ts',
].map(readRendererFile).join('\n');
const personaSourceCardSource = readRendererFile('features/explore/explore-persona-source-card.tsx');
const e2eRegistrySource = readDesktopFile('e2e/helpers/registry.mjs');
const worldLocaleEnSource = readRendererFile('locales/en/15-World.json');
const worldLocaleZhSource = readRendererFile('locales/zh/15-World.json');
const worldDetailLocaleEnSource = readRendererFile('locales/en/41-WorldDetail.json');
const worldDetailLocaleZhSource = readRendererFile('locales/zh/41-WorldDetail.json');

test('Explore fold mounts complete Worlds catalog under Explore', () => {
  assert.match(worldListSource, /export function WorldCatalogContent/);
  assert.match(exploreViewSource, /WorldCatalogContent/);
  assert.match(exploreViewSource, /data-testid=\{E2E_IDS\.exploreSection\('worlds'\)\}/);
  assert.match(e2eIdsSource, /exploreSection:\s*\(sectionId: string\) => `explore-\$\{sectionId\}-section`/);
  assert.match(worldListSource, /data-testid="world-atlas-glass-layout"/);
  assert.match(worldListSource, /data-testid="world-atlas-world-grid"/);
  assert.match(worldListSource, /data-testid="world-atlas-selected-panel"/);
  assert.doesNotMatch(worldListSource, /World\.toolbar\.heading/);
  assert.doesNotMatch(worldListSource, /AtlasSearch/);
  assert.match(worldListSource, /<AtlasCategoryTabs[\s\S]*view=\{view\}[\s\S]*sort=\{sort\}/);
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
  assert.match(exploreViewSource, /data-testid=\{E2E_IDS\.exploreSection\('personas'\)\}/);
  assert.match(exploreViewSource, /<PersonaSourceCard/);
  assert.match(personaSourceCardSource, /worldName/);
  // RealmPersona cards render source materialization handoff state, never an
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
  assert.match(exploreViewSource, /data-testid=\{E2E_IDS\.exploreSection\('worlds'\)\}/);
  assert.match(exploreViewSource, /data-testid=\{E2E_IDS\.exploreSection\('personas'\)\}/);
  assert.match(exploreViewSource, /data-testid=\{E2E_IDS\.exploreSection\('activity'\)\}/);
  assert.match(e2eIdsSource, /exploreSectionTab:\s*\(sectionId: string\) => `explore-section-tab-\$\{sectionId\}`/);
  assert.match(e2eIdsSource, /exploreSection:\s*\(sectionId: string\) => `explore-\$\{sectionId\}-section`/);
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

test('Worlds and World Detail use source discovery semantics instead of runtime entry or authoring', () => {
  const worldSurfaceSources = [
    worldListSource,
    worldDetailSource,
    worldDetailTemplateSource,
    worldLocaleEnSource,
    worldLocaleZhSource,
    worldDetailLocaleEnSource,
    worldDetailLocaleZhSource,
  ].join('\n');

  assert.equal(
    fs.existsSync(path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-list-cards.tsx')),
    false,
  );
  assert.doesNotMatch(worldDetailSource, /onEnterEdit|onCreateSubWorld|handleEnterEdit|handleCreateSubWorld/);
  assert.doesNotMatch(worldDetailTemplateSource, /onEnterEdit|onCreateSubWorld/);
  assert.doesNotMatch(worldSurfaceSources, /Enter world|Enter Editor|Create Sub World/);
  assert.doesNotMatch(worldSurfaceSources, /Active Now|Online Scenes|World Flow|Transit In|Sub World/);
  assert.match(worldSurfaceSources, /Explore Sources|Become my partner|View World/);
  assert.doesNotMatch(worldSurfaceSources, /Create Local Agent|Create local agent|创建本地 Agent/);
});

test('World Detail materializes sources through the packet-backed Runtime handoff only', () => {
  assert.match(worldDetailSource, /materializeSourceContactLaunchTarget/);
  assert.match(worldDetailSource, /ensureRuntimeAgentExists/);
  assert.match(worldDetailTemplateSource, /onMaterializeSource/);
  assert.doesNotMatch(worldDetailSource, new RegExp(`connect${['Realm', 'Public', 'Source'].join('')}`));
  assert.doesNotMatch(worldDetailSource, new RegExp(`connect${['Realm', 'Persona', 'Source'].join('')}`));
  assert.doesNotMatch(worldDetailTemplateSource, new RegExp(`on${['Connect', 'Source'].join('')}`));
  assert.doesNotMatch(worldDetailSource, new RegExp(`createRealm${'Runtime'}${'Source'}${'Snapshot'}|worldCoreControllerCreate${'Runtime'}${'Source'}${'Snapshot'}|transitController`));
  assert.doesNotMatch(worldDetailTemplateSource, new RegExp(`createRealm${'Runtime'}${'Source'}${'Snapshot'}|worldCoreControllerCreate${'Runtime'}${'Source'}${'Snapshot'}|transitController`));
  assert.doesNotMatch(worldDetailLocaleEnSource, /Connect one|Connect Source|connected local source|Connection creates/i);
  assert.doesNotMatch(worldDetailLocaleZhSource, /连接 Source|连接后|已连接本地 Source/);
});

test('World product data adapters do not keep raw WorldCore or transit-era fallback paths', () => {
  const productDataSources = [
    worldDataSource,
    worldListSource,
    worldDetailSource,
    worldDetailTemplateSource,
    worldDetailLocaleEnSource,
    worldDetailLocaleZhSource,
  ].join('\n');

  assert.doesNotMatch(productDataSources, /requireWorldCoreDto|requireWorldCharacterCoreDto|projectWorldCore|projectWorldCharacter/);
  assert.doesNotMatch(productDataSources, /WorldCore payload|WorldCharacterCore payload|WorldCoreV1 hash|WorldCoreV1 origin/);
  assert.doesNotMatch(productDataSources, /\btransitInLimit\b/);
});

test('World Tour is not a registered ordinary E2E journey', () => {
  assert.doesNotMatch(e2eRegistrySource, /world-tour/);
});
