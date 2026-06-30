import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const worldFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/data/realm-world-data.ts'),
  'utf8',
);
const worldDetailQueriesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-queries.ts'),
  'utf8',
);
const worldDetailSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail.tsx'),
  'utf8',
);
const worldListSelectedPanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-list-selected-panel.tsx'),
  'utf8',
);
const worldDetailTemplateSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-template.tsx'),
  'utf8',
);
const explorePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/explore/explore-panel.tsx'),
  'utf8',
);
const authStateWatcherSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/auth-state-watcher.ts'),
  'utf8',
);

test('world semantic bundle projects public world detail without raw core fallback', () => {
  const semanticStart = worldFlowSource.indexOf('export async function loadWorldSemanticBundle');
  const semanticEnd = worldFlowSource.indexOf('\nexport const realmWorldData', semanticStart);
  const semanticBundleSection = worldFlowSource.slice(semanticStart, semanticEnd);
  assert.match(semanticBundleSection, /getWorldCore\(realm, worldId\)/);
  assert.match(semanticBundleSection, /buildWorldPublicSemanticBundle\(asRecord\(world\)\)/);
  assert.doesNotMatch(semanticBundleSection, /semanticBundle\s*\?\?/);
  assert.doesNotMatch(semanticBundleSection, /loadWorldDetailById/);
  assert.doesNotMatch(semanticBundleSection, /catch\s*\{\s*return null;\s*\}/);
});

test('world entry no longer exposes eager world detail history prefetch', () => {
  assert.doesNotMatch(worldDetailQueriesSource, /export function prefetchWorldDetailAndHistory/);
});

test('world detail primary query adopts SDK public world DTO through a bounded adapter', () => {
  const oldRootSingletonPattern = new RegExp('get' + 'PlatformClient');
  assert.match(worldDetailQueriesSource, /toWorldListItem\(asRecord\(detailValue\)\)/);
  assert.doesNotMatch(worldDetailQueriesSource, oldRootSingletonPattern);
  assert.match(worldDetailQueriesSource, /realmWorldData\.loadWorldSemanticBundle/);
  assert.match(worldDetailQueriesSource, /realmWorldData\.loadWorldDetailWithCharacters/);
  assert.doesNotMatch(worldDetailQueriesSource, /mergeNimiRealmWorldPrimaryDetailTruth/);
  assert.doesNotMatch(worldDetailQueriesSource, /WORLD_DETAIL_WORLD_TRUTH_INVALID/);
});

test('world atlas selected panel shares the display-detail query shape with world detail', () => {
  assert.match(worldListSelectedPanelSource, /worldDisplayDetailQueryKey\(world\.id\)/);
  assert.match(worldListSelectedPanelSource, /fetchWorldDisplayDetail\(world\.id\)/);
  assert.doesNotMatch(worldListSelectedPanelSource, /fetchWorldDetailWithCharacters/);
});

test('world detail only treats the primary query as a page-level error and defers non-critical sections', () => {
  assert.match(worldDetailSource, /const initialError = !initialLoading/);
  assert.doesNotMatch(worldDetailSource, /const supplementalError =/);
  assert.doesNotMatch(worldDetailSource, /Object\.values\(display\.sections\)\.some\(\(status\) => status === 'error'\)/);
  assert.match(worldDetailSource, /const pageError = initialError/);
  assert.match(worldDetailSource, /message: 'detail:primary-ready'/);
  assert.match(worldDetailSource, /message: 'detail:history-semantic-settled'/);
  assert.match(worldDetailSource, /message: 'detail:assets-audits-settled'/);
});

test('world detail error state keeps a back escape hatch', () => {
  assert.match(worldDetailTemplateSource, /function WorldDetailErrorState\(\{ onBack \}: \{ onBack\?: \(\) => void \}\)/);
  assert.match(worldDetailTemplateSource, /onClick=\{onBack\}/);
  assert.match(worldDetailTemplateSource, /return <WorldDetailErrorState onBack=\{props\.onBack\} \/>;/);
});

test('explore shares the world list cache key and does not refetch characters when world metadata changes', () => {
  assert.match(explorePanelSource, /fetchWorldListItems\(\)/);
  assert.match(explorePanelSource, /queryKey: worldListQueryKey\(\)/);
  assert.match(explorePanelSource, /queryKey: \['explore-personas', authStatus, selectedCategory, props\.searchText\]/);
  assert.match(explorePanelSource, /const personaSources = useMemo\(/);
  assert.doesNotMatch(explorePanelSource, /dataSync\.loadWorlds\(/);
  assert.doesNotMatch(explorePanelSource, /worldsDataVersion/);
});

test('auth-state-watcher does not duplicate contacts loading (handled by bootstrap-auth + React Query)', () => {
  assert.doesNotMatch(authStateWatcherSource, /loadContacts/);
  assert.doesNotMatch(authStateWatcherSource, /loadSocialSnapshot/);
});
